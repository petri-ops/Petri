/**
 * BLOCK-186 P1 — 本地漏斗事件台账契约（funnel-log.js）。
 *
 * 红线（plan docs/block-186-funnel-ledger-plan.md）：
 *  - 白名单门：仅 FUNNEL_EVENTS 6 事件记账，非白名单静默跳过；
 *  - best-effort：DB 抛错静默跳过，永不 throw；
 *  - 独立于远程 telemetry_enabled（本机常开）；
 *  - computeTTFS：app_started→first_job_succeeded 时间差；缺任一则 null（不编造）。
 * 仿 block116 内存 DB 自举（全量应用 src/migrations，014 建 funnel_events）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b186-'));
const dbPath = path.join(tempDbDir, 'petri.db');
{
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  const migrationsDir = path.join(root, 'src', 'migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.PETRI_DB_PATH = dbPath;
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* 句柄延迟释放 */ }
  });
}

const funnelLog = require(path.join(root, 'core', 'petri-server', 'helpers', 'funnel-log.js'));

function readEvents() {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('SELECT event, at, user_id FROM funnel_events ORDER BY id ASC').all();
  db.close();
  return rows;
}
function clearEvents() {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  db.prepare('DELETE FROM funnel_events').run();
  db.close();
}

test('白名单事件记账落库', async () => {
  clearEvents();
  await funnelLog.recordFunnelEvent('project_created', { userId: 'u1' });
  const rows = readEvents();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event, 'project_created');
  assert.equal(rows[0].user_id, 'u1');
});

test('非白名单事件静默跳过（不入库）', async () => {
  clearEvents();
  await funnelLog.recordFunnelEvent('some_random_metric');
  await funnelLog.recordFunnelEvent('');
  assert.equal(readEvents().length, 0);
});

test('best-effort：DB 不可用 recordFunnelEvent 不抛错', async () => {
  funnelLog._setFunnelDb(Promise.reject(new Error('db down')));
  try {
    await funnelLog.recordFunnelEvent('app_started'); // 不应抛
  } finally {
    funnelLog._setFunnelDb(null);
  }
});

test('computeTTFS：app_started→first_job_succeeded 时间差', async () => {
  clearEvents();
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  const t0 = new Date('2026-10-16T10:00:00.000Z').toISOString();
  const t1 = new Date('2026-10-16T10:00:05.000Z').toISOString();
  db.prepare('INSERT INTO funnel_events (at, event, user_id) VALUES (?, ?, ?)').run(t0, 'app_started', 'u1');
  db.prepare('INSERT INTO funnel_events (at, event, user_id) VALUES (?, ?, ?)').run(t1, 'first_job_succeeded', 'u1');
  db.close();
  const r = await funnelLog.computeTTFS({ userId: 'u1' });
  assert.equal(r.ttfsMs, 5000);
  assert.equal(r.appStartedAt, t0);
  assert.equal(r.firstSuccessAt, t1);
});

test('computeTTFS：无 first_job_succeeded → null（不编造）', async () => {
  clearEvents();
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  db.prepare('INSERT INTO funnel_events (at, event, user_id) VALUES (?, ?, ?)').run('2026-10-16T10:00:00.000Z', 'app_started', 'u2');
  db.close();
  const r = await funnelLog.computeTTFS({ userId: 'u2' });
  assert.equal(r.ttfsMs, null);
  assert.ok(r.appStartedAt);
  assert.equal(r.firstSuccessAt, null);
});

test('computeTTFS：无 app_started → 全 null', async () => {
  clearEvents();
  const r = await funnelLog.computeTTFS({ userId: 'nobody' });
  assert.deepEqual(r, { ttfsMs: null, appStartedAt: null, firstSuccessAt: null });
});
