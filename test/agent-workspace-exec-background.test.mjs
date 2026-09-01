import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// BLOCK-33 P4 — 后台进程：workspace_exec_background / process_status / process_stop。
// 覆盖：启动即返回 + 日志重定向、状态查询（存活/日志尾部/退出码）、信号链
// （SIGTERM → 宽限 → 收敛 stopped）、黑名单先行、只读拦截、会话隔离。
// 环境自举同 agent-workspace-exec-cwd-shell.test.mjs。
const require = createRequire(import.meta.url);
{
  const Database = require('better-sqlite3');
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'biof3-exec-bg-db-'));
  const db = new Database(path.join(tempDbDir, 'biof3.db'));
  const migrationsDir = path.resolve('src/migrations');
  for (const file of fssync.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fssync.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.BIOF3_DB_PATH = path.join(tempDbDir, 'biof3.db');
  process.on('exit', () => {
    try {
      fssync.rmSync(tempDbDir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响测试结果
    }
  });
}
const { createWorkspaceTools } = require('../core/biof3-server/agent-tools/workspace-tools.js');
const { getToolDefs } = require('../core/biof3-server/agent-tools/tool-defs.js');

const isWindows = process.platform === 'win32';
const maybeSkipShell = isWindows ? test.skip : test;

let sandboxRoot;
let workspaceRoot;
let tools;
const spawnedProcessIds = [];

const ctx = {
  projectId: 'p_exec_bg',
  userId: 'u_owner',
  accessMode: 'full',
  conversationId: 'conv_bg_test',
};

async function waitFor(predicate, timeoutMs = 8000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return predicate();
}

before(async () => {
  sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'biof3-exec-bg-'));
  workspaceRoot = path.join(sandboxRoot, 'workspace');
  await fs.mkdir(workspaceRoot, { recursive: true });

  const fakeDb = {
    getProject(projectId) {
      if (projectId !== 'p_exec_bg') return null;
      return {
        id: projectId,
        user_id: 'u_owner',
        status: 'active',
        workspace_path: workspaceRoot,
      };
    },
    getUserById(userId) {
      return { id: userId, role: 'user' };
    },
  };
  tools = createWorkspaceTools({ dbProvider: () => fakeDb });
});

after(async () => {
  for (const processId of spawnedProcessIds) {
    try {
      await tools.processStop({ processId }, ctx);
    } catch {
      // 清理失败不影响测试结果
    }
  }
  await fs.rm(sandboxRoot, { recursive: true, force: true });
});

test('工具定义暴露后台进程三件套', () => {
  const defs = getToolDefs().map((item) => item.function.name);
  assert.ok(defs.includes('workspace_exec_background'));
  assert.ok(defs.includes('process_status'));
  assert.ok(defs.includes('process_stop'));
  const backgroundDef = getToolDefs().find((item) => item.function.name === 'workspace_exec_background');
  assert.equal(backgroundDef.function.parameters.required[0], 'command');
  assert.deepEqual(backgroundDef.function.parameters.properties.shell.enum, ['auto', 'posix', 'powershell', 'cmd']);
  const stopDef = getToolDefs().find((item) => item.function.name === 'process_stop');
  assert.deepEqual(stopDef.function.parameters.required, ['processId']);
});

maybeSkipShell('后台启动长任务：立即返回 processId + 日志路径，状态为 running', async () => {
  const start = await tools.execBackground(
    { command: 'sleep 30', cwd: '.' },
    ctx
  );
  assert.equal(start.ok, true);
  assert.ok(start.processId.startsWith('bg-'));
  assert.equal(typeof start.pid, 'number');
  assert.equal(start.status, 'running');
  assert.ok(start.logPath.startsWith('.biof3-agent-tmp/'));
  spawnedProcessIds.push(start.processId);

  const status = await tools.processStatus({ processId: start.processId }, ctx);
  assert.equal(status.ok, true);
  assert.equal(status.process.status, 'running');
  assert.equal(status.process.processId, start.processId);
  assert.equal(status.process.command, 'sleep 30');
});

maybeSkipShell('stdout/stderr 合并写入工作区日志文件，process_status 返回日志尾部', async () => {
  const start = await tools.execBackground(
    { command: 'printf hello-bg; printf err-bg 1>&2; sleep 30' },
    ctx
  );
  assert.equal(start.ok, true);
  spawnedProcessIds.push(start.processId);

  const sawOutput = await waitFor(async () => {
    const status = await tools.processStatus({ processId: start.processId }, ctx);
    return status.ok && typeof status.process.logTail === 'string'
      && status.process.logTail.includes('hello-bg')
      && status.process.logTail.includes('err-bg');
  });
  assert.ok(sawOutput, '日志尾部应包含 stdout 与 stderr 内容');

  const logFile = path.join(workspaceRoot, start.logPath);
  const logContent = await fs.readFile(logFile, 'utf8');
  assert.ok(logContent.includes('hello-bg'));
  assert.ok(logContent.includes('err-bg'));
});

maybeSkipShell('短命令自然退出：状态收敛为 exited + exitCode 0', async () => {
  const start = await tools.execBackground({ command: 'printf quick-done' }, ctx);
  assert.equal(start.ok, true);
  spawnedProcessIds.push(start.processId);

  const converged = await waitFor(async () => {
    const status = await tools.processStatus({ processId: start.processId }, ctx);
    return status.ok && status.process.status === 'exited';
  });
  assert.ok(converged, '进程应自然退出');
  const status = await tools.processStatus({ processId: start.processId }, ctx);
  assert.equal(status.process.exitCode, 0);
  assert.ok(status.process.logTail.includes('quick-done'));
});

maybeSkipShell('process_stop 信号链：SIGTERM 后收敛为 stopped，signal=SIGTERM', async () => {
  const start = await tools.execBackground({ command: 'sleep 30' }, ctx);
  assert.equal(start.ok, true);
  spawnedProcessIds.push(start.processId);

  const stop = await tools.processStop({ processId: start.processId }, ctx);
  assert.equal(stop.ok, true);
  assert.equal(stop.status, 'stopping');
  assert.equal(stop.stopSignal, 'SIGTERM');

  const converged = await waitFor(async () => {
    const status = await tools.processStatus({ processId: start.processId }, ctx);
    return status.ok && status.process.status === 'stopped';
  });
  assert.ok(converged, '进程应被 SIGTERM 终止');
  const status = await tools.processStatus({ processId: start.processId }, ctx);
  assert.equal(status.process.signal, 'SIGTERM');
  assert.equal(status.process.exitCode, null);

  // 重复停止：alreadyStopped
  const repeat = await tools.processStop({ processId: start.processId }, ctx);
  assert.equal(repeat.ok, true);
  assert.equal(repeat.alreadyStopped, true);
});

test('黑名单对后台启动同样先行拦截', async () => {
  for (const command of ['sudo ls', 'rm workspace', 'git push origin main']) {
    const result = await tools.execBackground({ command }, ctx);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'command_blocked');
  }
});

test('只读模式拦截后台启动与停止', async () => {
  const readOnlyCtx = { ...ctx, accessMode: 'read' };
  const start = await tools.execBackground({ command: 'sleep 30' }, readOnlyCtx);
  assert.equal(start.ok, false);
  assert.equal(start.error, 'access_mode_read_only');

  const stop = await tools.processStop({ processId: 'bg-whatever' }, readOnlyCtx);
  assert.equal(stop.ok, false);
  assert.equal(stop.error, 'access_mode_read_only');
});

test('进程表会话隔离：其他会话不可见不可停', async () => {
  const start = await tools.execBackground({ command: 'sleep 30' }, ctx);
  assert.equal(start.ok, true);
  spawnedProcessIds.push(start.processId);

  const otherConvCtx = { ...ctx, conversationId: 'conv_other' };
  const status = await tools.processStatus({ processId: start.processId }, otherConvCtx);
  assert.equal(status.ok, false);
  assert.equal(status.error, 'not_found');

  const stop = await tools.processStop({ processId: start.processId }, otherConvCtx);
  assert.equal(stop.ok, false);
  assert.equal(stop.error, 'not_found');

  // 不带 processId：只列出本会话记录
  const list = await tools.processStatus({}, otherConvCtx);
  assert.equal(list.ok, true);
  assert.equal(list.count, 0);
});

test('process_status 未知进程返回 not_found', async () => {
  const status = await tools.processStatus({ processId: 'bg-no-such' }, ctx);
  assert.equal(status.ok, false);
  assert.equal(status.error, 'not_found');
});

test('cwd 沙箱对后台启动同样生效', async () => {
  const result = await tools.execBackground({ command: 'sleep 30', cwd: '../outside' }, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'path_escape');
});
