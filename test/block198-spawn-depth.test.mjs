/**
 * BLOCK-198 — D5「递归多级派生（子生孙）」的机械锚。
 *
 * 缘起：该点位自 BLOCK-195 起无锚。实码核实**有界递归派生早已实现**
 * （`core/petri-server/agent-tools/spawn-agent-tools.js:50` `resolveSpawnMaxDepth` +
 * `:236-253` 沿 `parentTaskId` 上溯计 spawn 代数），但 `test/block173-w3-contracts.test.mjs`
 * 只断 env 解析与钳制，**派生代数判定本身零断言**（=有实现无断言）。
 *
 * 本测断判定链的四条真分支，全部在**派发之前**返回（不启动任何子 agent、零模型调用）：
 *  ① 缺省 maxDepth=1 → 子 agent 作父被 `parent_not_primary` 拒（维持保守现状）；
 *  ② 放开到 maxDepth=3 → 同一父**不再被 primary/depth 拒**，走到 `parent_not_running`
 *     （证明"子可再生孙"这条路真的打开了——这是 D5 的核心性质）；
 *  ③ maxDepth=2 时 1 代子 agent 作父 → `spawn_depth_exceeded`（有界，不会无限递归）；
 *  ④ 代数按父链实算：2 代链在 maxDepth=3 下也越界被拒。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 统一临时 DB 自举（沿用 block173 的既有模式：spawn 链 require 会触发 agent-task-store schema）
const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'petri-b198-db-'));
{
  const Database = require(path.resolve(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const boot = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.resolve(ROOT, 'src', 'migrations');
  for (const f of fssync.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    boot.exec(fssync.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.env.PETRI_DECISION_CONFIG_PATH = path.join(tempDbDir, 'decision-config.json');
}
const { spawn_agent } = require(path.resolve(ROOT, 'core/petri-server/agent-tools/spawn-agent-tools.js'));
const store = require(path.resolve(ROOT, 'core/petri-server/agent-task-store.js'));

const USER = 'u_b198';
let seq = 0;

function makeTask({ kind, parentTaskId, done = false }) {
  const taskId = `b198_${(seq += 1)}`;
  store.insertAgentTask({ taskId, userId: USER, params: { kind, parentTaskId, label: taskId } });
  if (done) store.markAgentTaskDone(taskId);
  return taskId;
}

async function withMaxDepth(value, fn) {
  const prev = process.env.PETRI_SPAWN_MAX_DEPTH;
  if (value === null) delete process.env.PETRI_SPAWN_MAX_DEPTH;
  else process.env.PETRI_SPAWN_MAX_DEPTH = String(value);
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.PETRI_SPAWN_MAX_DEPTH;
    else process.env.PETRI_SPAWN_MAX_DEPTH = prev;
  }
}

const spawnAs = (parentTaskId) => spawn_agent({ task: '把这段结果再切一层' }, { taskId: parentTaskId, userId: USER });

test.after(() => {
  try { fssync.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* 临时目录清理失败不影响结论 */ }
});

test('缺省 maxDepth=1：子 agent 作父被 parent_not_primary 拒（保守现状未被悄悄放开）', () => {
  const primary = makeTask({ kind: 'primary' });
  const child = makeTask({ kind: 'subagent', parentTaskId: primary });
  return withMaxDepth(null, async () => {
    const res = await spawnAs(child);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'parent_not_primary', `实际=${res.error}`);
  });
});

test('maxDepth=3 放开后：1 代子 agent 作父不再被深度/身份拒（子可再生孙这条路真的打开）', () => {
  const primary = makeTask({ kind: 'primary' });
  // 父设为已终态：深度闸放行后停在 parent_not_running，**绝不进入派发**（不启动 agent、零模型调用）
  const child = makeTask({ kind: 'subagent', parentTaskId: primary, done: true });
  return withMaxDepth(3, async () => {
    const res = await spawnAs(child);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'parent_not_running', `深度/身份闸未放行，实际=${res.error}`);
    assert.notEqual(res.error, 'spawn_depth_exceeded');
    assert.notEqual(res.error, 'parent_not_primary');
  });
});

test('maxDepth=2 时 1 代子 agent 作父越界被拒：派生深度有界，不会无限递归', () => {
  const primary = makeTask({ kind: 'primary' });
  const child = makeTask({ kind: 'subagent', parentTaskId: primary });
  return withMaxDepth(2, async () => {
    const res = await spawnAs(child);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'spawn_depth_exceeded', `实际=${res.error}`);
  });
});

test('代数按父链实算：2 代链在 maxDepth=3 下同样越界被拒', () => {
  const primary = makeTask({ kind: 'primary' });
  const child = makeTask({ kind: 'subagent', parentTaskId: primary, done: true });
  const grandchild = makeTask({ kind: 'subagent', parentTaskId: child, done: true });
  return withMaxDepth(3, async () => {
    const res = await spawnAs(grandchild);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'spawn_depth_exceeded', `实际=${res.error}`);
  });
});

test('缺省值仍是 1（放开必须由 env 显式发生，不得悄悄改默认拓扑）', () => {
  const prev = process.env.PETRI_SPAWN_MAX_DEPTH;
  delete process.env.PETRI_SPAWN_MAX_DEPTH;
  const mod = require(path.resolve(ROOT, 'core/petri-server/agent-tools/spawn-agent-tools.js'));
  assert.equal(mod.resolveSpawnMaxDepth(), 1);
  if (prev !== undefined) process.env.PETRI_SPAWN_MAX_DEPTH = prev;
});
