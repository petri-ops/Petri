/**
 * agent-workspace-exec-yield.test.mjs — BLOCK-54 P1
 *
 * workspace_exec yield 中间档：等到产出或超时交还控制权。
 * 覆盖：短命令完整返回（无 yielded）/ 长命令超时 yielded+processId 转入后台表 /
 * process_status 可收尾 / 超范围钳制不报错 / token 预算截断标记 / 不带 yield_ms 同步语义回归。
 * 环境自举同 agent-workspace-exec-background.test.mjs。
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
{
  const Database = require('better-sqlite3');
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'biof3-exec-yield-db-'));
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
    } catch {}
  });
}
const { createWorkspaceTools } = require('../core/biof3-server/agent-tools/workspace-tools.js');
const { getToolDefs } = require('../core/biof3-server/agent-tools/tool-defs.js');

const isWindows = process.platform === 'win32';
const maybeSkipShell = isWindows ? test.skip : test;

let workspaceRoot;
let tools;
const spawnedProcessIds = [];

const ctx = {
  projectId: 'p_exec_yield',
  userId: 'u_owner',
  accessMode: 'full',
  conversationId: 'conv_yield_test',
};

before(async () => {
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'biof3-exec-yield-'));
  workspaceRoot = path.join(sandboxRoot, 'workspace');
  await fs.mkdir(workspaceRoot, { recursive: true });

  const fakeDb = {
    getProject(projectId) {
      if (projectId !== 'p_exec_yield') return null;
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
    } catch {}
  }
  await fs.rm(path.dirname(workspaceRoot), { recursive: true, force: true }).catch(() => {});
});

maybeSkipShell('yield: 短命令在预算内完成 → 完整结果、无 yielded 标记', async () => {
  const res = await tools.executeCommand(
    { command: 'echo yield-short-ok', yield_ms: 5000 },
    ctx
  );
  assert.equal(res.ok, true);
  assert.equal(res.yielded, undefined);
  assert.equal(res.exitCode, 0);
  assert.match(res.stdout, /yield-short-ok/);
});

maybeSkipShell('yield: 长命令超时 → yielded + processId 转后台表，process_status 可收尾', async () => {
  const res = await tools.executeCommand(
    { command: 'echo started && sleep 8 && echo done-long', yield_ms: 400 },
    ctx
  );
  assert.equal(res.ok, true);
  assert.equal(res.yielded, true);
  assert.ok(res.processId, 'processId present');
  spawnedProcessIds.push(res.processId);
  assert.ok(res.logPath.includes('.biof3-agent-tmp/'));
  assert.match(res.note, /process_status/);

  // 进程表里查得到（running 或刚退出均可——轮询语义）
  const status = await tools.processStatus({ processId: res.processId }, ctx);
  assert.equal(status.ok, true);
  const entry = status.process;
  assert.ok(entry, 'process entry visible via process_status');
  assert.equal(entry.processId, res.processId);

  // 等命令真正退出，日志应含完整输出
  const final = await (async function poll() {
    for (let i = 0; i < 20; i++) {
      const s = await tools.processStatus({ processId: res.processId, logTailBytes: 4096 }, ctx);
      const e = JSON.stringify(s);
      if (e.includes('done-long')) return e;
      await new Promise((r) => setTimeout(r, 500));
    }
    return '';
  })();
  assert.ok(final.includes('done-long'), 'log tail eventually contains full output');
});

maybeSkipShell('yield: 超范围 yield_ms 被钳制不报错（99999999 → 30000 上限，短命令仍走完成路径）', async () => {
  const res = await tools.executeCommand(
    { command: 'echo clamped', yield_ms: 99999999 },
    ctx
  );
  assert.equal(res.ok, true);
  assert.equal(res.yielded, undefined);
  assert.match(res.stdout, /clamped/);
});

maybeSkipShell('yield: token 预算截断标记（max_output_tokens=200）', async () => {
  // ~4000+ 字符输出（tiktoken 下 >200 tokens）
  const res = await tools.executeCommand(
    { command: 'seq 1 800', yield_ms: 5000, max_output_tokens: 200 },
    ctx
  );
  assert.equal(res.ok, true);
  assert.equal(res.outputTruncatedByTokenBudget, true);
  assert.ok(res.note.includes('max_output_tokens'));
  assert.ok(res.stdout.length < 4000, 'stdout actually truncated');
});

test('回归：不带 yield_ms 保持既有同步语义（无 yielded/processId 字段）', async () => {
  const res = await tools.executeCommand({ command: isWindows ? 'echo sync-ok' : 'echo sync-ok' }, ctx);
  assert.equal(res.ok, true);
  assert.equal(res.yielded, undefined);
  assert.equal(res.processId, undefined);
  assert.match(res.stdout, /sync-ok/);
});

test('tool-defs：workspace_exec schema 含 yield_ms / max_output_tokens 且描述更新', () => {
  const def = getToolDefs().find((d) => d.function.name === 'workspace_exec');
  assert.ok(def, 'workspace_exec def present');
  assert.ok(def.function.parameters.properties.yield_ms, 'yield_ms param present');
  assert.ok(def.function.parameters.properties.max_output_tokens, 'max_output_tokens param present');
  assert.match(def.function.description, /yield_ms/);
  assert.match(def.function.description, /process_status 轮询收尾/);
});
