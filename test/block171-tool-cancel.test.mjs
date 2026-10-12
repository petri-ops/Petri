// BLOCK-171 CP-1 — 工具协作取消契约（registry / 契约位 / searchText 信号检查 /
// executeToolCall 取消归类）。红绿锚点：总纲 §2-D6 + plan §1-CP-1。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// 统一临时 DB 自举（harness-workspace-tools 同款修法：PETRI_DB_PATH 先于 db.js）
{
  const pth = require('node:path');
  const urlx = require('node:url');
  const hereDir = pth.dirname(urlx.fileURLToPath(import.meta.url));
  const Database = require(pth.resolve(hereDir, '..', 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'petri-b171-db-'));
  const boot = new Database(pth.join(tempDbDir, 'petri.db'));
  const migrationsDir = pth.resolve(hereDir, '..', 'src', 'migrations');
  for (const f of fssync.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fssync.readFileSync(pth.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = pth.join(tempDbDir, 'petri.db');
  process.on('exit', () => { try { fssync.rmSync(tempDbDir, { recursive: true, force: true }); } catch {} });
}

const {
  createToolCancellation,
  getToolCancellation,
  releaseToolCancellation,
} = require('../core/petri-server/helpers/tool-cancel-registry.js');
const { getToolContract } = require('../core/petri-server/agent-tools/registry.js');
const { createWorkspaceTools } = require('../core/petri-server/agent-tools/workspace-tools.js');

test('注册表：register→cancel 精确命中单 callId，未命中 callId 零误伤', () => {
  const reg = createToolCancellation('task_b171_a');
  const sigA = reg.register('call_a', 'workspace_search');
  const sigB = reg.register('call_b', 'wait_agent');
  assert.equal(sigA.aborted, false);
  assert.equal(sigB.aborted, false);

  const result = reg.cancel({ callId: 'call_a' });
  assert.deepEqual(result.cancelled, ['call_a']);
  assert.equal(sigA.aborted, true);
  assert.equal(sigB.aborted, false, '未点名的 call 不受影响');
  assert.deepEqual(reg.list(), ['call_b']);
  releaseToolCancellation('task_b171_a');
});

test('注册表：cancel 无 callId = 全量取消；release 后路由侧查不到', () => {
  const reg = createToolCancellation('task_b171_b');
  reg.register('c1', 'workspace_search');
  reg.register('c2', 'wait_agent');
  const result = reg.cancel({});
  assert.equal(result.cancelled.length, 2);
  releaseToolCancellation('task_b171_b');
  assert.equal(getToolCancellation('task_b171_b'), null);
  // release 后重复 cancel 安全（幂等空操作）
  assert.deepEqual(reg.cancel({}).cancelled, []);
});

test('契约位：workspace_search/wait_agent cancellable=true，未声明仍 false', () => {
  assert.equal(getToolContract('workspace_search').cancellable, true);
  assert.equal(getToolContract('wait_agent').cancellable, true);
  assert.equal(getToolContract('workspace_read').cancellable, false, '未声明零行为变化');
  assert.equal(getToolContract('run_tool').cancellable, false, 'run_tool 在途取消=job 级既有通道，契约维持 false');
});

test('searchText：aborted signal 在文件检查点抛 AbortError（协作取消贯通）', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'petri-b171-ws-'));
  try {
    await fs.writeFile(path.join(root, 'a.txt'), 'hello petri\nsecond line\n', 'utf8');
    const db = require('../core/petri-server/db.js').getDatabase();
    db.prepare(
      "INSERT INTO projects (id, name, status, created_at, updated_at, workspace_path) VALUES ('p_b171', 'B171 取消夹具', 'active', ?, ?, ?)"
    ).run(new Date().toISOString(), new Date().toISOString(), root);
    const tools = createWorkspaceTools();
    const controller = new AbortController();
    controller.abort(new Error('tool_cancel_requested'));
    await assert.rejects(
      tools.searchText(
        { query: 'hello', path: '.' },
        { projectId: 'p_b171', userId: 'u_owner', accessMode: 'full', toolCancelSignal: controller.signal }
      ),
      (error) => error.name === 'AbortError' && /tool_cancel_requested/.test(error.message)
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('searchText：未取消时行为不变（回归零破坏）', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'petri-b171-ws2-'));
  try {
    await fs.writeFile(path.join(root, 'a.txt'), 'hello petri\n', 'utf8');
    const db = require('../core/petri-server/db.js').getDatabase();
    db.prepare(
      "INSERT INTO projects (id, name, status, created_at, updated_at, workspace_path) VALUES ('p_b171b', 'B171 回归夹具', 'active', ?, ?, ?)"
    ).run(new Date().toISOString(), new Date().toISOString(), root);
    const tools = createWorkspaceTools();
    const result = await tools.searchText(
      { query: 'hello', path: '.' },
      { projectId: 'p_b171b', userId: 'u_owner', accessMode: 'full' }
    );
    assert.equal(result.ok, true);
    assert.equal(result.matches.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
