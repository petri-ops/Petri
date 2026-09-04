#!/usr/bin/env node

/**
 * Loop Repository integration tests — uses an isolated SQLite database
 * via BIOF3_DB_PATH. Tests:
 *  - persist LoopRun with idempotency
 *  - update LoopRun status with FSM enforcement
 *  - persist Iteration + Action + Decision atomically
 *  - actionKey dedupe throws on duplicate with different actionId
 *  - list iterations in correct order
 *  - cross-project isolation
 *  - snapshot persistence
 *
 * Run via: node --test test/loop-repository.test.mjs
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import loopContract from '../core/shared-backend/loop-contract.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-loop-'));
process.env.BIOF3_DB_PATH = path.join(TMP_DIR, 'test.db');

// 新鲜 DB 必须先应用 src/migrations 全量（projects 等用户数据表由迁移管理，
// db.js 模块加载即预编译 projects 语句）；否则 import db.js 即抛
// no such table: projects，整组用例连带失败。与 loop-api-route.test.mjs 同一自举手法。
{
  const Database = require('../core/biof3-server/node_modules/better-sqlite3');
  const migrationsDir = path.resolve(__dirname, '..', 'src', 'migrations');
  const boot = new Database(process.env.BIOF3_DB_PATH);
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
}

let db;
let lc;
let cleanupDir;

before(async () => {
  db = (await import('../core/biof3-server/db.js')).default || (await import('../core/biof3-server/db.js'));
  lc = loopContract;
  cleanupDir = TMP_DIR;
});

after(() => {
  try {
    if (db && db.db && db.db.open) db.db.close();
  } catch {}
  if (cleanupDir) {
    try { fs.rmSync(cleanupDir, { recursive: true, force: true }); } catch {}
  }
});

function nowIso() {
  return new Date().toISOString();
}

function buildRun(opts = {}) {
  return lc.buildLoopRun({
    projectId: 'project_test',
    conversationId: 'conv_test',
    taskSpecRef: 'spt1-bulk-rnaseq',
    loopStatus: 'planned',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...opts,
  });
}

test('LR-1 persist LoopRun then re-fetch', () => {
  const run = buildRun();
  const persisted = db.persistLoopRun(run);
  assert.ok(persisted.loopRunId);
  assert.strictEqual(persisted.loopStatus, 'planned');
  assert.strictEqual(persisted.projectId, 'project_test');
  const fetched = db.getLoopRun(run.loopRunId);
  assert.ok(fetched);
  assert.strictEqual(fetched.hash, run.hash);
});

test('LR-2 update LoopRun status enforces FSM', () => {
  const run = buildRun();
  db.persistLoopRun(run);
  const updated = db.updateLoopRunStatus(run.loopRunId, {
    loopStatus: 'running',
    hash: 'x'.repeat(64),
    json: JSON.stringify({ ...run, loopStatus: 'running' }),
    updatedAt: nowIso(),
  });
  assert.strictEqual(updated.loopStatus, 'running');
});

test('LR-3 update LoopRun to invalid status throws', () => {
  const run = buildRun();
  db.persistLoopRun(run);
  assert.throws(
    () =>
      db.updateLoopRunStatus(run.loopRunId, {
        loopStatus: 'completed',
        hash: 'x'.repeat(64),
        json: '{}',
        updatedAt: nowIso(),
      }),
    /Invalid status transition/,
  );
});

test('LR-4 persist Iteration with Action, idempotent actionKey', () => {
  const run = buildRun();
  db.persistLoopRun(run);
  const iteration = lc.buildIteration({
    loopRunId: run.loopRunId,
    sequence: 1,
    observedStateDigest: 'plan_generated',
    goalGapIds: ['no_workflow_plan'],
    proposedAction: {
      loopRunId: run.loopRunId,
      sequence: 1,
      actionType: 'plan',
      params: { toolId: 'spt1-wf-v1' },
    },
    decision: 'continue',
    decisionReasonCode: 'NORMAL_PLAN_GENERATED',
    publicConclusion: '已生成包含 7 个节点的 DAG。',
  });
  const persisted = db.persistLoopIteration(iteration);
  assert.ok(persisted.iterationId);
  assert.strictEqual(persisted.sequence, 1);
  assert.strictEqual(persisted.hash, iteration.hash);

  const action = db.getLoopActionByKey(iteration.proposedAction.actionKey);
  assert.ok(action);
  assert.strictEqual(action.actionId, iteration.proposedAction.actionId);
});

test('LR-5 duplicate actionKey with different actionId throws', () => {
  const run = buildRun();
  db.persistLoopRun(run);
  const first = lc.buildIteration({
    loopRunId: run.loopRunId,
    sequence: 1,
    observedStateDigest: 'x',
    decision: 'continue',
    decisionReasonCode: 'NORMAL_PLAN_GENERATED',
    proposedAction: {
      loopRunId: run.loopRunId,
      sequence: 1,
      actionType: 'run_tool',
      toolId: 'deseq2',
      inputs: { counts: 'counts.csv' },
    },
    publicConclusion: 'first',
  });
  db.persistLoopIteration(first);

  const second = lc.buildIteration({
    loopRunId: run.loopRunId,
    sequence: 2,
    observedStateDigest: 'x',
    decision: 'continue',
    decisionReasonCode: 'NORMAL_PLAN_GENERATED',
    proposedAction: {
      actionKey: first.proposedAction.actionKey,
      actionId: 'action_duplicate_id',
      loopRunId: run.loopRunId,
      sequence: 2,
      actionType: 'run_tool',
      toolId: 'deseq2',
      inputs: { counts: 'counts.csv' },
    },
    publicConclusion: 'second',
  });
  assert.throws(
    () => db.persistLoopIteration(second),
    /loop_action_duplicate_action_key/,
  );
});

test('LR-6 list iterations in sequence DESC order', () => {
  const run = buildRun();
  db.persistLoopRun(run);
  for (let seq = 1; seq <= 3; seq += 1) {
    const it = lc.buildIteration({
      loopRunId: run.loopRunId,
      sequence: seq,
      observedStateDigest: `state_${seq}`,
      decision: 'continue',
      decisionReasonCode: 'NORMAL_PLAN_GENERATED',
      publicConclusion: `conclusion ${seq}`,
    });
    db.persistLoopIteration(it);
  }
  const list = db.listLoopIterations(run.loopRunId);
  assert.strictEqual(list.length, 3);
  assert.strictEqual(list[0].sequence, 3);
  assert.strictEqual(list[2].sequence, 1);
});

test('LR-7 cross-project isolation: cannot read other project run', () => {
  const run = buildRun({ projectId: 'project_a', conversationId: 'conv_a' });
  db.persistLoopRun(run);
  const fetched = db.getLoopRun(run.loopRunId);
  assert.strictEqual(fetched.projectId, 'project_a');

  const listed = db.listLoopRunsForConversation('project_b', 'conv_a');
  assert.strictEqual(listed.length, 0);
});

test('LR-8 persist and list evidence', () => {
  const run = buildRun();
  db.persistLoopRun(run);
  for (let i = 0; i < 3; i += 1) {
    const ev = lc.buildEvidence({
      loopRunId: run.loopRunId,
      kind: 'tool_output',
      ref: `ref_${i}`,
      summaryDigest: `summary_${i}`,
    });
    db.persistLoopEvidence(ev);
  }
  const listed = db.listLoopEvidence(run.loopRunId);
  assert.strictEqual(listed.length, 3);
  assert.ok(listed.every((e) => e.kind === 'tool_output'));
});

test('LR-9 snapshot persists and returns latest', () => {
  const run = buildRun();
  db.persistLoopRun(run);
  db.persistLoopSnapshot({
    snapshotId: 'snap_1',
    loopRunId: run.loopRunId,
    sequenceAt: 1,
    payload: { goalGapIds: ['no_workflow_plan'] },
    sourceHash: 'a'.repeat(64),
  });
  db.persistLoopSnapshot({
    snapshotId: 'snap_2',
    loopRunId: run.loopRunId,
    sequenceAt: 2,
    payload: { goalGapIds: [] },
    sourceHash: 'b'.repeat(64),
  });
  const latest = db.getLatestLoopSnapshot(run.loopRunId);
  assert.strictEqual(latest.snapshotId, 'snap_2');
  assert.strictEqual(latest.sequenceAt, 2);
});

test('LR-10 iteration with UNIQUE sequence conflict throws on duplicate', () => {
  const run = buildRun();
  db.persistLoopRun(run);
  const it = lc.buildIteration({
    loopRunId: run.loopRunId,
    sequence: 5,
    observedStateDigest: 'x',
    decision: 'continue',
    decisionReasonCode: 'NORMAL_PLAN_GENERATED',
    publicConclusion: 'first',
  });
  db.persistLoopIteration(it);
  const dup = lc.buildIteration({
    loopRunId: run.loopRunId,
    sequence: 5,
    observedStateDigest: 'y',
    decision: 'continue',
    decisionReasonCode: 'NORMAL_PLAN_GENERATED',
    publicConclusion: 'second',
  });
  assert.throws(() => db.persistLoopIteration(dup));
});

test('LR-11 immutable loopRun hash mismatch throws', () => {
  const run = buildRun();
  db.persistLoopRun(run);
  const tampered = { ...run, loopStatus: 'cancelled', hash: 'f'.repeat(64) };
  assert.throws(() => db.persistLoopRun(tampered), /loop_run_immutable/);
});

test('LR-12 immutable iteration hash mismatch throws', () => {
  const run = buildRun();
  db.persistLoopRun(run);
  const it = lc.buildIteration({
    loopRunId: run.loopRunId,
    sequence: 1,
    observedStateDigest: 'x',
    decision: 'continue',
    decisionReasonCode: 'NORMAL_PLAN_GENERATED',
    publicConclusion: 'safe text',
  });
  db.persistLoopIteration(it);
  const tampered = { ...it, publicConclusion: 'tampered', hash: 'f'.repeat(64) };
  assert.throws(() => db.persistLoopIteration(tampered), /loop_iteration_immutable/);
});

test('LR-13 persistLoopRun tolerates repeated identical insert', () => {
  const run = buildRun();
  db.persistLoopRun(run);
  assert.doesNotThrow(() => db.persistLoopRun(run));
});