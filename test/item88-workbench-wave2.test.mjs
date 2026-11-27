/**
 * item88 第二波 HK-01：三档交互路由 / 双通道回写幂等 / 变更单 schema+链 /
 * 总览只读 / 调度队列 / flag-off 零事件。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'item88-w2-'));
const dbPath = path.join(temp, 'petri.db');
process.env.PETRI_DB_PATH = dbPath;
process.env.PETRI_DECISION_CONFIG_PATH = path.join(temp, 'decision.json');
const { runMigrations } = require_(path.join(ROOT, 'src', 'migration-runner.js'));
await runMigrations(dbPath, path.join(ROOT, 'src', 'migrations'));
process.on('exit', () => { try { fs.rmSync(temp, { recursive: true, force: true }); } catch {} });
const Database = require_(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
const db = new Database(dbPath);
// task_events 由 core schema 建（不在 src/migrations），测试自举最小同形表。
db.exec(`CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, seq INTEGER NOT NULL,
  event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
)`);

test('HK-01 三档交互路由：自主/审批/咨询各走正确 store，flag-off 零事件', () => {
  const { resolveInteractionMode, routeInteraction } = require_(path.join(ROOT, 'core', 'petri-server', 'helpers', 'workbench-interaction.js'));
  assert.equal(resolveInteractionMode({ flagEnabled: false, automationMode: 'approval' }), 'autonomous');
  assert.equal(routeInteraction('autonomous').store, 'none');
  assert.equal(routeInteraction('approval').store, 'approval');
  assert.equal(routeInteraction('consult').store, 'question');
});

test('HK-01 双通道回写：同一 outcome 只落一条事件，二次调用幂等', () => {
  const { writebackOutcome } = require_(path.join(ROOT, 'core', 'petri-server', 'helpers', 'workbench-writeback.js'));
  const first = writebackOutcome({ db, taskId: 't1', outcome: 'accepted', channel: 'pm', eventKey: 'e1' });
  const second = writebackOutcome({ db, taskId: 't1', outcome: 'accepted', channel: 'side', eventKey: 'e1' });
  assert.equal(first.ok, true);
  assert.equal(second.deduped, true);
  const rows = db.prepare("SELECT * FROM task_events WHERE task_id='t1' AND event_type='workbench.writeback'").all();
  assert.equal(rows.length, 1);
});

test('HK-01 变更单 schema 缺字段红，合法入库且文档链通过', () => {
  const { validateChangeOrder, createChangeOrder } = require_(path.join(ROOT, 'core', 'petri-server', 'helpers', 'workbench-change-order.js'));
  const base = { taskRef: 't1', impact: ['budget'], decision: 'approved-by-user', effectiveVersion: 2 };
  const bad = { ...base };
  delete bad.impact;
  const result = validateChangeOrder(bad);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.code === 'change_impact_required'));
  const created = createChangeOrder(db, base);
  assert.equal(created.ok, true);
  const { verifyWorkbenchDocChain } = require_(path.join(ROOT, 'core', 'petri-server', 'helpers', 'workbench-docs.js'));
  assert.equal(verifyWorkbenchDocChain([created.doc]).ok, true);
});

test('HK-01 总览只读：新模块无 bridge/IPC/写事件', () => {
  const src = read('frontend/src/components/work-surface/WorkbenchOverviewSurface.tsx');
  assert.doesNotMatch(src, /getBridge|desktopBridge|dispatchPetriEvent|\.post\(/);
  assert.match(src, /projectOrchestration/);
  assert.match(src, /ReactFlow|nodesDraggable={false}/);
});

test('HK-01 队列：priority 稳定序 + 固定 rng 退避 + 超限转 failed', () => {
  const { rankQueueTasks, computeRetryDecision } = require_(path.join(ROOT, 'core', 'petri-server', 'helpers', 'workbench-queue.js'));
  const ranked = rankQueueTasks([
    { id: 'a', priority: 1, created_at: '2026-11-27T00:00:00Z' },
    { id: 'b', priority: 5, created_at: '2026-11-27T00:01:00Z' },
    { id: 'c', priority: 5, created_at: '2026-11-27T00:00:00Z' },
  ]);
  assert.deepEqual(ranked.map((t) => t.id), ['c', 'b', 'a']);
  const retry = computeRetryDecision({ retryCount: 0, errorType: 'network_timeout', rng: () => 0 });
  assert.equal(retry.action, 'retry');
  assert.ok(retry.delayMs > 0 && retry.delayMs < 2000);
  const exhausted = computeRetryDecision({ retryCount: 99, errorType: 'network_timeout', rng: () => 0 });
  assert.equal(exhausted.action, 'failed');
});
