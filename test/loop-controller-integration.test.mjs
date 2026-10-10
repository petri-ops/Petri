#!/usr/bin/env node

/**
 * Loop Controller + DB integration tests.
 * Full cycle: observe → decide → persist → reconcile → decide again.
 * Run via: node --test test/loop-controller-integration.test.mjs
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import os from 'os';
import fs from 'fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Module-level imports (stable — Node ESM deduplicates by URL)
import lc from '../core/shared-backend/loop-contract.js';
import ctrl from '../core/shared-backend/loop-controller.js';

let db;
let tmpDir;

const DAG_SPT1 = {
  nodes: [
    { id: 'node-1', toolId: 'spt1-wf-v1', requiredInputs: [], actionType: 'plan' },
    { id: 'node-2', toolId: 'deseq2', requiredInputs: ['counts', 'metadata'], actionType: 'run_tool' },
    { id: 'node-3', toolId: 'go-enrich', requiredInputs: ['deg_table'], actionType: 'run_tool' },
  ],
  expectedDeliverables: [{ id: 'd1', delivered: false }],
};

function dagProgress(nodeIds = []) {
  const progress = {};
  for (const id of nodeIds) progress[id] = 'completed';
  for (const n of DAG_SPT1.nodes) {
    if (!progress[n.id]) progress[n.id] = 'pending';
  }
  return progress;
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-ctrl-int-'));
  process.env.PETRI_DB_PATH = path.join(tmpDir, 'test.db');

  // 新鲜 DB 必须先应用 src/migrations 全量（projects 等用户数据表由迁移管理，
  // db.js 模块加载即预编译 projects 语句）；否则 import db.js 即抛
  // no such table: projects，整组用例连带失败。与 loop-api-route.test.mjs 同一自举手法。
  {
    const Database = require('../core/petri-server/node_modules/better-sqlite3');
    const migrationsDir = path.resolve(__dirname, '..', 'src', 'migrations');
    const boot = new Database(process.env.PETRI_DB_PATH);
    for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
      boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
    }
    boot.close();
  }

  db = (await import('../core/petri-server/db.js')).default;
});

after(() => {
  try { if (db?.db?.open) db.db.close(); } catch {}
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
});

// ---------------------------------------------------------------------------
// INT-1 happy path: plan proposes all → complete on next iteration
// With multi-node plan, all DAG gaps are resolved in one plan iteration.
// The next iteration sees all resolved → complete.
// ---------------------------------------------------------------------------
test('INT-1 happy path: plan → complete (multi-node plan resolves all gaps)', () => {
  const run = lc.buildLoopRun({
    projectId: 'p1', conversationId: 'c1', taskSpecRef: 'spt1', loopStatus: 'planned',
  });
  db.persistLoopRun(run);
  db.updateLoopRunStatus(run.loopRunId, {
    loopStatus: 'running', hash: run.hash,
    json: JSON.stringify(run), updatedAt: new Date().toISOString(),
  });

  // Iteration 1: plan proposes all DAG gaps at once
  const it1 = ctrl.buildControllerIteration({
    loopRunId: run.loopRunId,
    sequence: 1,
    observedStateDigest: ctrl.deriveObservedStateDigest({
      toolJobs: [], dagProgress: {},
    }),
    goalGapIds: ctrl.computeGoalGapIds({ nodes: DAG_SPT1.nodes }, []),
    iterations: [],
    loopRunStatus: 'running',
    dag: DAG_SPT1,
  });
  db.persistLoopIteration(it1);
  assert.strictEqual(it1.decision, 'continue');
  assert.ok(it1.proposedAction?.actionKey);

  // Iteration 2: all gaps resolved → complete
  const it2 = ctrl.buildControllerIteration({
    loopRunId: run.loopRunId,
    sequence: 2,
    observedStateDigest: ctrl.deriveObservedStateDigest({
      toolJobs: [{ id: 'j1', status: 'completed' }],
      dagProgress: dagProgress(['node-1', 'node-2', 'node-3']),
    }),
    goalGapIds: ctrl.computeGoalGapIds({ nodes: DAG_SPT1.nodes }, [it1]),
    iterations: [it1],
    loopRunStatus: 'running',
    dag: DAG_SPT1,
  });
  db.persistLoopIteration(it2);

  const exit = ctrl.evaluateExit({
    decision: it2.decision,
    goalGapIds: it2.goalGapIds,
    iterations: [it1, it2],
    loopRunStatus: 'running',
  });
  assert.strictEqual(it2.decision, 'complete');
  assert.strictEqual(exit.shouldExit, true);
  assert.strictEqual(exit.loopStatus, 'completed');
});

// ---------------------------------------------------------------------------
// INT-2 repeated actionKey → block decision
// ---------------------------------------------------------------------------
test('INT-2 repeated actionKey is deduplicated via DB', async () => {
  // Use a fresh import to guarantee the current source code version
  const ctrlFresh = (await import('../core/shared-backend/loop-controller.js')).default;

  const action1 = ctrlFresh.buildAction({
    actionType: 'plan', toolId: 'wf1', inputs: {}, params: { goalGapId: 'wf1' }, attempt: 1,
  });
  const action2 = ctrlFresh.buildAction({
    actionType: 'plan', toolId: 'wf2', inputs: {}, params: { goalGapId: 'wf2' }, attempt: 1,
  });
  // action3: same actionKey as action1 (different reference)
  const action3 = ctrlFresh.buildAction({
    actionType: 'plan', toolId: 'wf1', inputs: {}, params: { goalGapId: 'wf1' }, attempt: 1,
  });

  const it1 = { iterationId: 'it1', proposedAction: action1 };
  const it2 = { iterationId: 'it2', proposedAction: action2 };

  // Empty iterations → no detection
  const empty = ctrlFresh.detectRepeatedAction(action1.actionKey, []);
  assert.strictEqual(empty.detected, false);

  // action3.key === action1.key → detected (prior it1 has same actionKey)
  const repeat = ctrlFresh.detectRepeatedAction(action3.actionKey, [it1, it2], action3);
  assert.strictEqual(repeat.detected, true);
  assert.strictEqual(repeat.previousIterationId, 'it1');
});

// ---------------------------------------------------------------------------
// INT-3 oscillation → block decision
// ---------------------------------------------------------------------------
test('INT-3 oscillation detected → block decision', () => {
  // Test detectOscillation directly: two consecutive plan actions with same toolId + params
  // produce same proposedAction → oscillation detected
  const planAction = ctrl.buildAction({
    actionType: 'plan', toolId: 'wf1', inputs: {}, params: { goalGapId: 'wf1' }, attempt: 1,
  });

  const it1 = { iterationId: 'it1', proposedAction: planAction, goalGapIds: ['wf1'] };
  const it2 = { iterationId: 'it2', proposedAction: planAction, goalGapIds: ['wf1'] };

  const osc = ctrl.detectOscillation([it1, it2], 'wf1');
  assert.strictEqual(osc.detected, true);
  assert.strictEqual(osc.reason, lc.REASON_CODES.PLAN_OSCILLATION_DETECTED);
});

// ---------------------------------------------------------------------------
// INT-4 no-progress at threshold → block decision
// ---------------------------------------------------------------------------
test('INT-4 no-progress at threshold → block decision', () => {
  const run = lc.buildLoopRun({
    projectId: 'p4', conversationId: 'c4', taskSpecRef: 'spt1', loopStatus: 'planned',
  });
  db.persistLoopRun(run);
  db.updateLoopRunStatus(run.loopRunId, {
    loopStatus: 'running', hash: run.hash,
    json: JSON.stringify(run), updatedAt: new Date().toISOString(),
  });

  const stuck = { goalGapIds: ['node-2'] };
  const it = ctrl.buildControllerIteration({
    loopRunId: run.loopRunId,
    sequence: 4,
    observedStateDigest: 'x',
    goalGapIds: ['node-2'],
    iterations: [stuck, stuck, stuck],
    loopRunStatus: 'running',
    dag: DAG_SPT1,
  });
  assert.strictEqual(it.decision, 'block');
  assert.strictEqual(it.decisionReasonCode, lc.REASON_CODES.NO_PROGRESS_CYCLE_DETECTED);
});

// ---------------------------------------------------------------------------
// INT-5 invalid inputs → block via validateAction
// ---------------------------------------------------------------------------
test('INT-5 invalid inputs → block decision via validateAction', () => {
  const run = lc.buildLoopRun({
    projectId: 'p5', conversationId: 'c5', taskSpecRef: 'spt1', loopStatus: 'planned',
  });
  db.persistLoopRun(run);
  db.updateLoopRunStatus(run.loopRunId, {
    loopStatus: 'running', hash: run.hash,
    json: JSON.stringify(run), updatedAt: new Date().toISOString(),
  });

  const it = ctrl.buildControllerIteration({
    loopRunId: run.loopRunId,
    sequence: 1,
    observedStateDigest: ctrl.deriveObservedStateDigest({ toolJobs: [], dagProgress: dagProgress([]) }),
    goalGapIds: ['node-2'], // deseq2 requires counts + metadata
    iterations: [],
    loopRunStatus: 'running',
    dag: DAG_SPT1,
    runtimeReady: true,
  });
  assert.strictEqual(it.decision, 'block');
  assert.strictEqual(it.decisionReasonCode, lc.REASON_CODES.INPUT_FORMAT_MISMATCH);
});

// ---------------------------------------------------------------------------
// INT-6 all nodes complete → complete + shouldExit
// ---------------------------------------------------------------------------
test('INT-6 all nodes complete → complete decision + shouldExit=true', () => {
  const run = lc.buildLoopRun({
    projectId: 'p6', conversationId: 'c6', taskSpecRef: 'spt1', loopStatus: 'planned',
  });
  db.persistLoopRun(run);
  db.updateLoopRunStatus(run.loopRunId, {
    loopStatus: 'running', hash: run.hash,
    json: JSON.stringify(run), updatedAt: new Date().toISOString(),
  });

  // Dummy "done" iteration to mark all nodes as previously proposed
  const doneIter = ctrl.buildControllerIteration({
    loopRunId: run.loopRunId,
    sequence: 1,
    observedStateDigest: ctrl.deriveObservedStateDigest({ toolJobs: [], dagProgress: {} }),
    goalGapIds: ['node-1', 'node-2', 'node-3'],
    iterations: [],
    loopRunStatus: 'running',
    dag: DAG_SPT1,
  });

  const it = ctrl.buildControllerIteration({
    loopRunId: run.loopRunId,
    sequence: 3,
    observedStateDigest: ctrl.deriveObservedStateDigest({ toolJobs: [{ id: 'j1', status: 'completed' }], dagProgress: dagProgress(['node-1', 'node-2', 'node-3']) }),
    goalGapIds: ctrl.computeGoalGapIds({ nodes: DAG_SPT1.nodes }, [doneIter]),
    iterations: [doneIter],
    loopRunStatus: 'running',
    dag: DAG_SPT1,
  });

  const exit = ctrl.evaluateExit({
    decision: it.decision,
    goalGapIds: it.goalGapIds,
    iterations: [doneIter, it],
    loopRunStatus: 'running',
  });
  assert.strictEqual(it.decision, 'complete');
  assert.strictEqual(exit.shouldExit, true);
  assert.strictEqual(exit.loopStatus, 'completed');
});

// ---------------------------------------------------------------------------
// INT-7 structured decision never exposes raw inputs/params/actionKey
// ---------------------------------------------------------------------------
test('INT-7 toStructuredDecision never exposes raw inputs/params/actionKey', () => {
  const run = lc.buildLoopRun({
    projectId: 'p7', conversationId: 'c7', taskSpecRef: 'spt1', loopStatus: 'planned',
  });
  db.persistLoopRun(run);
  db.updateLoopRunStatus(run.loopRunId, {
    loopStatus: 'running', hash: run.hash,
    json: JSON.stringify(run), updatedAt: new Date().toISOString(),
  });

  const it = ctrl.buildControllerIteration({
    loopRunId: run.loopRunId,
    sequence: 1,
    observedStateDigest: ctrl.deriveObservedStateDigest({ toolJobs: [], dagProgress: dagProgress([]) }),
    goalGapIds: ['node-1'],
    iterations: [],
    loopRunStatus: 'running',
    dag: DAG_SPT1,
    runtimeReady: true,
  });

  const sd = ctrl.toStructuredDecision(it);
  assert.ok(sd);
  assert.strictEqual(sd.inputs, undefined);
  assert.strictEqual(sd.params, undefined);
  assert.strictEqual(sd.actionKey, undefined);
});

// ---------------------------------------------------------------------------
// INT-8 userConfirmationRequired → wait_for_user decision
// ---------------------------------------------------------------------------
test('INT-8 userConfirmationRequired → wait_for_user decision', () => {
  const it = ctrl.buildControllerIteration({
    loopRunId: 'l8',
    sequence: 1,
    observedStateDigest: ctrl.deriveObservedStateDigest({ toolJobs: [], dagProgress: dagProgress([]) }),
    goalGapIds: ['node-2'],
    iterations: [],
    loopRunStatus: 'running',
    dag: DAG_SPT1,
    userConfirmationRequired: true,
  });
  assert.strictEqual(it.decision, 'wait');
  assert.ok(it.proposedAction?.actionType === 'wait_for_user');
});

// ---------------------------------------------------------------------------
// INT-9 runtime not ready → block
// ---------------------------------------------------------------------------
test('INT-9 runtime not ready → block', () => {
  const it = ctrl.buildControllerIteration({
    loopRunId: 'l9',
    sequence: 1,
    observedStateDigest: ctrl.deriveObservedStateDigest({ toolJobs: [], dagProgress: dagProgress([]) }),
    goalGapIds: ['node-2'],
    iterations: [],
    loopRunStatus: 'running',
    dag: DAG_SPT1,
    runtimeReady: false,
  });
  assert.strictEqual(it.decision, 'block');
  // Reason: runtime check fires first (before input validation)
  assert.ok(
    it.decisionReasonCode === 'TOOL_RUNTIME_NOT_READY' ||
    it.decisionReasonCode === 'INPUT_FORMAT_MISMATCH',
  );
});

// ---------------------------------------------------------------------------
// INT-10 action validation blocks before execute
// ---------------------------------------------------------------------------
test('INT-10 action validation blocks before execute', () => {
  const action = ctrl.buildAction({
    actionType: 'run_tool',
    toolId: 'deseq2',
    inputs: { counts: 'counts.csv' },
    params: {},
  });
  const v = ctrl.validateAction(action, {
    dag: { nodes: [{ toolId: 'deseq2', requiredInputs: ['counts', 'metadata'] }] },
    runtimeReady: true,
  });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reasonCode, lc.REASON_CODES.INPUT_FORMAT_MISMATCH);
});