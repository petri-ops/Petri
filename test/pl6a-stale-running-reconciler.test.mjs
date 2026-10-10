// PL-6a — stale-running 兜底对账器契约测试：
// 无主+心跳超时 → failed 可观测；有 owner → 绝不动（防误杀）；无心跳用启动宽限；
// 幂等（终态后不再动）；调度通知在收口时触发。
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const Database = nodeRequire('../core/petri-server/node_modules/better-sqlite3');
const registry = nodeRequire('../core/petri-server/helpers/tool-job-lifecycle-registry');
const {
  reconcileStaleRunningToolJobs,
  DEFAULT_STALE_AFTER_MS,
  DEFAULT_STARTUP_GRACE_MS,
} = nodeRequire('../core/petri-server/helpers/stale-running-reconciler.js');

function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), 'stale-reconciler-'));
  const db = new Database(join(dir, 't.db'));
  db.exec(`CREATE TABLE tool_jobs (
    id TEXT PRIMARY KEY, user_id TEXT, tool_id TEXT, params_json TEXT,
    status TEXT, created_at INTEGER, name TEXT, is_test_run INTEGER DEFAULT 0,
    is_public INTEGER DEFAULT 0, result_json TEXT, completed_at INTEGER,
    error TEXT, conversation_id TEXT, ack_status TEXT, ack_error TEXT,
    ack_decided_by TEXT, ack_decided_at TEXT, project_id TEXT,
    process_pid INTEGER, heartbeat_at INTEGER, execution_target_id TEXT
  )`);
  return { db, dir };
}

function insertJob(db, { id, status = 'running', heartbeatAt = null, createdAt = Date.now() }) {
  db.prepare('INSERT INTO tool_jobs (id, status, created_at, heartbeat_at) VALUES (?,?,?,?)')
    .run(id, status, createdAt, heartbeatAt);
}

test('无主 + 心跳超时 → 收口 failed 且幂等', () => {
  const { db, dir } = makeDb();
  const now = Date.now();
  insertJob(db, { id: 'tj_stale', heartbeatAt: now - DEFAULT_STALE_AFTER_MS - 1000 });
  const r1 = reconcileStaleRunningToolJobs({ db, now: () => now });
  assert.deepEqual(r1.reconciled, ['tj_stale']);
  const row = db.prepare('SELECT status, error FROM tool_jobs WHERE id=?').get('tj_stale');
  assert.equal(row.status, 'failed');
  assert.match(row.error, /terminal_persistence_lost/);
  // 幂等：已终态不再动
  const r2 = reconcileStaleRunningToolJobs({ db, now: () => now });
  assert.deepEqual(r2.reconciled, []);
  db.close(); rmSync(dir, { recursive: true, force: true });
});

test('有 owner（activeToolJobs 在场）→ 绝不动（防误杀长跑，心跳停更也不收）', () => {
  const { db, dir } = makeDb();
  const now = Date.now();
  insertJob(db, { id: 'tj_owned', heartbeatAt: now - DEFAULT_STALE_AFTER_MS * 10 });
  registry.activeToolJobs.set('tj_owned', { startedAt: now });
  const r = reconcileStaleRunningToolJobs({ db, now: () => now });
  assert.deepEqual(r.reconciled, []);
  assert.equal(db.prepare('SELECT status FROM tool_jobs WHERE id=?').get('tj_owned').status, 'running');
  registry.activeToolJobs.delete('tj_owned');
  // owner 释放后下一轮才收
  const r2 = reconcileStaleRunningToolJobs({ db, now: () => now });
  assert.deepEqual(r2.reconciled, ['tj_owned']);
  db.close(); rmSync(dir, { recursive: true, force: true });
});

test('无心跳行用启动宽限：宽限内不动，超宽限无主则收', () => {
  const { db, dir } = makeDb();
  const now = Date.now();
  insertJob(db, { id: 'tj_fresh', createdAt: now - DEFAULT_STARTUP_GRACE_MS + 60_000, heartbeatAt: null });
  insertJob(db, { id: 'tj_orphan', createdAt: now - DEFAULT_STARTUP_GRACE_MS - 60_000, heartbeatAt: null });
  const r = reconcileStaleRunningToolJobs({ db, now: () => now });
  assert.deepEqual(r.reconciled, ['tj_orphan']);
  db.close(); rmSync(dir, { recursive: true, force: true });
});

test('pending 不在扫描范围（调度泵自治域）', () => {
  const { db, dir } = makeDb();
  const now = Date.now();
  insertJob(db, { id: 'tj_pending', status: 'pending', createdAt: now - DEFAULT_STALE_AFTER_MS * 10 });
  const r = reconcileStaleRunningToolJobs({ db, now: () => now });
  assert.deepEqual(r.reconciled, []);
  db.close(); rmSync(dir, { recursive: true, force: true });
});
