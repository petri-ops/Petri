import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// BLOCK-33 P2 — workspace_exec 命令策略化：cwd 沙箱校验 / shell 选择 / 结果增强。
// 测试约定同 harness-workspace-tools.test.mjs：fake dbProvider + 临时工作区。
// tool-defs → registry 导入链会拉起 db.js，与 agent-system-info 测试同款环境自举。
const require = createRequire(import.meta.url);
{
  const Database = require('better-sqlite3');
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'biof3-exec-cwd-shell-db-'));
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

function symlinksSupported() {
  try {
    const probe = fssync.mkdtempSync(path.join(os.tmpdir(), 'biof3-symlink-probe-'));
    try {
      fssync.symlinkSync(path.join(probe, 'target'), path.join(probe, 'link'));
      return true;
    } catch {
      return false;
    } finally {
      fssync.rmSync(probe, { recursive: true, force: true });
    }
  } catch {
    return false;
  }
}

let sandboxRoot;
let workspaceRoot;
let outsideRoot;
let tools;

const ctx = { projectId: 'p_exec_cwd', userId: 'u_owner', accessMode: 'full' };

before(async () => {
  sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'biof3-exec-cwd-shell-'));
  workspaceRoot = path.join(sandboxRoot, 'workspace');
  outsideRoot = path.join(sandboxRoot, 'outside');
  await fs.mkdir(path.join(workspaceRoot, 'data'), { recursive: true });
  await fs.mkdir(outsideRoot, { recursive: true });
  await fs.writeFile(path.join(workspaceRoot, 'notes.md'), '# Project\n');
  await fs.writeFile(path.join(workspaceRoot, 'data', 'genes.csv'), 'gene\nTP53\n');
  await fs.writeFile(path.join(outsideRoot, 'secret.txt'), 'outside');
  if (symlinksSupported()) {
    await fs.symlink(outsideRoot, path.join(workspaceRoot, 'escape'));
  }

  const fakeDb = {
    getProject(projectId) {
      if (projectId !== 'p_exec_cwd') return null;
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
  await fs.rm(sandboxRoot, { recursive: true, force: true });
});

test('workspace_exec 定义暴露 cwd 与 shell 参数', () => {
  const definition = getToolDefs().find((item) => item.function.name === 'workspace_exec');
  assert.ok(definition, 'workspace_exec 已注册');
  const properties = definition.function.parameters.properties;
  assert.equal(properties.cwd.type, 'string');
  assert.deepEqual(properties.shell.enum, ['auto', 'posix', 'powershell', 'cmd']);
});

maybeSkipShell('结果增强：exitCode/durationMs/shell 字段随成功结果返回', async () => {
  const result = await tools.executeCommand({ command: 'pwd', timeoutMs: 3000 }, ctx);
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.signal, null);
  assert.equal(typeof result.durationMs, 'number');
  assert.ok(result.durationMs >= 0);
  assert.equal(typeof result.shell, 'string');
  assert.ok(result.shell.length > 0);
  assert.equal(result.cwd, '.');
});

maybeSkipShell('cwd 参数使命令在子目录中执行并回显相对标签', async () => {
  const result = await tools.executeCommand(
    { command: 'pwd', cwd: 'data', timeoutMs: 3000 },
    ctx
  );
  assert.equal(result.ok, true);
  assert.equal(result.stdout.trim(), await fs.realpath(path.join(workspaceRoot, 'data')));
  assert.equal(result.cwd, 'data');
});

maybeSkipShell('cwd 路径逃逸被拒绝', async () => {
  const result = await tools.executeCommand({ command: 'pwd', cwd: '../outside' }, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'path_escape');
});

maybeSkipShell('cwd 绝对路径被拒绝', async () => {
  const result = await tools.executeCommand(
    { command: 'pwd', cwd: path.join(outsideRoot) },
    ctx
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'absolute_path_not_allowed');
});

maybeSkipShell('cwd 符号链接逃逸被拒绝', async (t) => {
  if (!symlinksSupported()) return t.skip('平台不支持 symlink');
  const result = await tools.executeCommand({ command: 'pwd', cwd: 'escape' }, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'symlink_escape');
});

maybeSkipShell('cwd 不存在的目录与文件路径被拒绝', async () => {
  const absent = await tools.executeCommand({ command: 'pwd', cwd: 'no-such-dir' }, ctx);
  assert.equal(absent.ok, false);
  assert.equal(absent.error, 'invalid_arguments');

  const fileTarget = await tools.executeCommand({ command: 'pwd', cwd: 'notes.md' }, ctx);
  assert.equal(fileTarget.ok, false);
  assert.equal(fileTarget.error, 'invalid_arguments');
});

maybeSkipShell('shell=posix 显式选择生效', async () => {
  const result = await tools.executeCommand(
    { command: 'printf ok', shell: 'posix', timeoutMs: 3000 },
    ctx
  );
  assert.equal(result.ok, true);
  assert.equal(result.stdout.trim(), 'ok');
  const expectedShell = process.env.SHELL && path.isAbsolute(process.env.SHELL) ? process.env.SHELL : '/bin/sh';
  assert.equal(result.shell, expectedShell);
});

test('shell=cmd 在非 Windows 平台被拒绝', async () => {
  if (isWindows) return;
  const result = await tools.executeCommand({ command: 'echo ok', shell: 'cmd' }, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_arguments');
});

maybeSkipShell('黑名单对携带 cwd/shell 的命令同样生效', async () => {
  for (const command of ['sudo ls', 'rm notes.md', 'git push origin main']) {
    const result = await tools.executeCommand(
      { command, cwd: 'data', shell: 'posix' },
      ctx
    );
    assert.equal(result.ok, false);
    assert.equal(result.error, 'command_blocked');
  }
  assert.equal(await fs.readFile(path.join(workspaceRoot, 'notes.md'), 'utf8'), '# Project\n');
});

maybeSkipShell('只读访问模式对 cwd/shell 组合同样拦截', async () => {
  const result = await tools.executeCommand(
    { command: 'pwd', cwd: 'data', shell: 'posix' },
    { ...ctx, accessMode: 'read' }
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'access_mode_read_only');
});
