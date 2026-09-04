#!/usr/bin/env node

/**
 * HLE-C3R: Durable resume + context checkpoint integration tests.
 *
 * Uses an isolated SQLite database via BIOF3_DB_PATH. Verifies the durable
 * recovery primitives that the production agent-runner now relies on:
 *
 *  - getActiveLoopRunForConversation resolves the latest NON-TERMINAL run for a
 *    (project, conversation) so a multi-turn task resumes one run instead of
 *    minting a new run every turn.
 *  - A run that a server restart marked failed(recovery_required) is EXCLUDED
 *    from active resolution (recovery is surfaced via the recovery API, not
 *    silently resumed).
 *  - automationMode and executionIntent remain separate, with legacy rows
 *    projected compatibly.
 *  - listLoopActions returns persisted actions (fixes the previously-dead
 *    /api/loop/actions endpoint).
 *  - Context checkpoints persist per iteration so the chat summary is NOT the
 *    only copy of loop state (buildIterationCheckpoint -> saveContextCheckpoint
 *    -> getLatestContextCheckpoint round-trips).
 *
 * Run via: node --test test/loop-durable-resume.test.mjs
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import loopContract from '../core/shared-backend/loop-contract.js';
import * as loopCheckpoint from '../core/shared-backend/loop-checkpoint.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-c3r-'));
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
const cp = loopCheckpoint.default || loopCheckpoint;

before(async () => {
  db = (await import('../core/biof3-server/db.js')).default || (await import('../core/biof3-server/db.js'));
  lc = loopContract;
});

after(() => {
  try {
    if (db && db.db && db.db.open) db.db.close();
  } catch {}
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

function nowIso() {
  return new Date().toISOString();
}

let seq = 0;
function uniqueConv() {
  seq += 1;
  return `conv_c3r_${Date.now()}_${seq}`;
}

let runSeq = 0;
function persistRun({
  projectId,
  conversationId,
  automationMode = 'trusted',
  executionIntent = 'task_execute',
  loopStatus = 'running',
}) {
  runSeq += 1;
  return db.persistLoopRun(lc.buildLoopRun({
    loopRunId: `loop_c3r_${Date.now()}_${runSeq}`,
    projectId,
    conversationId,
    taskSpecRef: lc.stableHash({ projectId, conversationId, executionIntent }),
    automationMode,
    executionIntent,
    loopStatus,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }));
}

function runningRun(opts) {
  return persistRun({ ...opts, loopStatus: 'running' });
}

// ---------------------------------------------------------------------------
// getActiveLoopRunForConversation
// ---------------------------------------------------------------------------

test('C3R-1 resolves a running run for the conversation', () => {
  const conversationId = uniqueConv();
  const persisted = runningRun({ projectId: 'proj_c3r', conversationId });
  const active = db.getActiveLoopRunForConversation('proj_c3r', conversationId);
  assert.ok(active, 'expected an active run');
  assert.strictEqual(active.loopRunId, persisted.loopRunId);
  assert.strictEqual(active.loopStatus, 'running');
});

test('C3R-2 excludes terminal runs (failed/recovery_required is NOT resumed)', () => {
  const conversationId = uniqueConv();
  const persisted = runningRun({ projectId: 'proj_c3r', conversationId });
  // Simulate the server-restart reconcile: running -> failed(recovery_required)
  db.updateLoopRunStatus(persisted.loopRunId, {
    loopStatus: 'failed',
    hash: persisted.hash,
    json: JSON.stringify({ recovery_required: true, recovery_reason: 'server_restart_during_active_loop' }),
    updatedAt: nowIso(),
  });
  const active = db.getActiveLoopRunForConversation('proj_c3r', conversationId);
  assert.strictEqual(active, null, 'a failed(recovery_required) run must not be resolved as active');
});

test('C3R-3 returns the latest non-terminal run when several exist', () => {
  const conversationId = uniqueConv();
  const older = runningRun({ projectId: 'proj_c3r', conversationId });
  // Force a strictly later updated_at on the second run
  const newer = runningRun({ projectId: 'proj_c3r', conversationId });
  db.updateLoopRunStatus(newer.loopRunId, {
    loopStatus: 'running',
    hash: newer.hash,
    json: JSON.stringify(newer.record || {}),
    updatedAt: new Date(Date.now() + 5000).toISOString(),
  });
  const active = db.getActiveLoopRunForConversation('proj_c3r', conversationId);
  assert.ok(active);
  assert.strictEqual(active.loopRunId, newer.loopRunId);
  assert.notStrictEqual(active.loopRunId, older.loopRunId);
});

test('C3R-4 resolves a planned run and ignores executionIntent (draft->execute is one run)', () => {
  // A task_draft turn may create a `planned` run; a later task_execute turn must
  // resume THAT run (planned -> running), not mint a second run. The resolver
  // therefore matches on (project, conversation) regardless of automationMode.
  const conversationId = uniqueConv();
  const planned = persistRun({
    projectId: 'proj_c3r',
    conversationId,
    automationMode: 'guided',
    executionIntent: 'task_draft',
    loopStatus: 'planned',
  });
  const active = db.getActiveLoopRunForConversation('proj_c3r', conversationId);
  assert.ok(active, 'a planned run must be resolvable as active for resume');
  assert.strictEqual(active.loopRunId, planned.loopRunId);
  assert.strictEqual(active.loopStatus, 'planned');
  assert.strictEqual(active.automationMode, 'guided');
  assert.strictEqual(active.executionIntent, 'task_draft');
});

test('C3R-5 cross-conversation isolation', () => {
  const convA = uniqueConv();
  const convB = uniqueConv();
  const runA = runningRun({ projectId: 'proj_c3r', conversationId: convA });
  runningRun({ projectId: 'proj_c3r', conversationId: convB });
  const active = db.getActiveLoopRunForConversation('proj_c3r', convA);
  assert.strictEqual(active.loopRunId, runA.loopRunId);
});

test('C3R-6 returns null for missing project/conversation', () => {
  assert.strictEqual(db.getActiveLoopRunForConversation(null, 'x'), null);
  assert.strictEqual(db.getActiveLoopRunForConversation('x', null), null);
  assert.strictEqual(db.getActiveLoopRunForConversation('nope', 'nope'), null);
});

test('C3R-6b list projection supports project-only and conversation-only filters', () => {
  const conversationId = uniqueConv();
  const run = runningRun({ projectId: 'proj_filter', conversationId });
  assert.ok(db.listLoopRunsForConversation('proj_filter', null).some((item) => item.loopRunId === run.loopRunId));
  assert.ok(db.listLoopRunsForConversation(null, conversationId).some((item) => item.loopRunId === run.loopRunId));
});

test('C3R-6c legacy task_execute automationMode projects as trusted execution intent', () => {
  runSeq += 1;
  const loopRunId = `legacy_${runSeq}`;
  db.persistLoopRun({
    loopRunId,
    projectId: 'proj_legacy',
    conversationId: uniqueConv(),
    taskSpecRef: 'legacy-spec',
    automationMode: 'task_execute',
    loopStatus: 'running',
    hash: lc.stableHash({ loopRunId }),
  });
  const run = db.getLoopRun(loopRunId);
  assert.strictEqual(run.automationMode, 'trusted');
  assert.strictEqual(run.executionIntent, 'task_execute');
});

// ---------------------------------------------------------------------------
// listLoopActions (fixes previously-dead /actions endpoint)
// ---------------------------------------------------------------------------

test('C3R-7 listLoopActions returns persisted actions in sequence DESC', () => {
  const conversationId = uniqueConv();
  const run = runningRun({ projectId: 'proj_c3r', conversationId });
  for (let s = 1; s <= 3; s += 1) {
    const it = lc.buildIteration({
      loopRunId: run.loopRunId,
      sequence: s,
      observedStateDigest: `state_${s}`,
      decision: 'continue',
      decisionReasonCode: 'NORMAL_PLAN_GENERATED',
      proposedAction: {
        loopRunId: run.loopRunId,
        sequence: s,
        actionType: 'run_tool',
        toolId: 'deseq2',
        params: { step: s },
      },
      publicConclusion: `step ${s}`,
    });
    db.persistLoopIteration(it);
  }
  const actions = db.listLoopActions(run.loopRunId);
  assert.strictEqual(actions.length, 3);
  assert.strictEqual(actions[0].sequence, 3);
  assert.strictEqual(actions[2].sequence, 1);
  assert.ok(actions.every((a) => a.toolId === 'deseq2'));
  assert.ok(actions.every((a) => typeof a.actionKey === 'string' && a.actionKey.length > 0));
});

test('C3R-8 listLoopActions empty for unknown run', () => {
  assert.deepStrictEqual(db.listLoopActions('no_such_run'), []);
  assert.deepStrictEqual(db.listLoopActions(null), []);
});

// ---------------------------------------------------------------------------
// Context checkpoint durability (summary is not the only copy)
// ---------------------------------------------------------------------------

test('C3R-9 iteration checkpoint persists and is the latest for the conversation', () => {
  const conversationId = uniqueConv();
  const projectId = 'proj_c3r';
  const run = runningRun({ projectId, conversationId });

  const checkpoint = cp.buildIterationCheckpoint({
    loopRunId: run.loopRunId,
    loopRunHash: 'h'.repeat(64),
    sequence: 1,
    observedStateDigest: 'digest_seq_1',
    goalGapIds: ['degs'],
    decision: 'continue',
    decisionReasonCode: 'TOOL_SUCCEEDED',
    publicConclusion: 'DESeq2 完成',
    status: 'succeeded',
  });

  const saved = db.saveContextCheckpoint({
    ...checkpoint,
    projectId,
    conversationId,
    sourceDigest: checkpoint.observedStateDigest,
  });
  assert.ok(saved, 'checkpoint should persist');

  const latest = db.getLatestContextCheckpoint(projectId, conversationId);
  assert.ok(latest);
  assert.strictEqual(latest.checkpointId, checkpoint.checkpointId);
  assert.strictEqual(latest.sequence, 1);
  assert.strictEqual(latest.observedStateDigest, 'digest_seq_1');
  // publicConclusion is redacted-safe but preserved for the durable copy
  assert.ok(typeof latest.publicConclusion === 'string');
});

test('C3R-10 checkpoint is immutable on sourceDigest mismatch', () => {
  const conversationId = uniqueConv();
  const projectId = 'proj_c3r';
  const run = runningRun({ projectId, conversationId });
  const checkpoint = cp.buildIterationCheckpoint({
    loopRunId: run.loopRunId,
    loopRunHash: 'a'.repeat(64),
    sequence: 1,
    observedStateDigest: 'digest_a',
    goalGapIds: [],
    decision: 'continue',
    decisionReasonCode: 'TOOL_SUCCEEDED',
    publicConclusion: 'x',
    status: 'succeeded',
  });
  db.saveContextCheckpoint({ ...checkpoint, projectId, conversationId, sourceDigest: 'digest_a' });
  assert.throws(
    () => db.saveContextCheckpoint({ ...checkpoint, projectId, conversationId, sourceDigest: 'digest_b' }),
    /context_checkpoint_immutable/,
  );
});

test('C3R-11 ContextEnvelope rebuilds from persisted checkpoints', () => {
  const conversationId = uniqueConv();
  const projectId = 'proj_c3r';
  const run = runningRun({ projectId, conversationId });
  const loopRunHash = 'e'.repeat(64);
  for (let s = 1; s <= 2; s += 1) {
    const checkpoint = cp.buildIterationCheckpoint({
      loopRunId: run.loopRunId,
      loopRunHash,
      sequence: s,
      observedStateDigest: `digest_${s}`,
      goalGapIds: s === 2 ? [] : ['degs'],
      decision: s === 2 ? 'complete' : 'continue',
      decisionReasonCode: s === 2 ? 'GOAL_ACHIEVED' : 'TOOL_SUCCEEDED',
      publicConclusion: `seq ${s}`,
      status: 'succeeded',
    });
    db.saveContextCheckpoint({ ...checkpoint, projectId, conversationId, sourceDigest: checkpoint.observedStateDigest });
  }
  const checkpoints = db.listContextCheckpoints(projectId, conversationId)
    .slice()
    .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  assert.strictEqual(checkpoints.length, 2);

  const envelope = cp.buildLoopContextEnvelope({
    loopRunId: run.loopRunId,
    checkpoints,
    currentModelProfileId: 'switched-model',
    currentModelProfileLabel: 'Switched Model',
  });
  assert.ok(envelope);
  assert.strictEqual(envelope.loopRunId, run.loopRunId);
  assert.strictEqual(envelope.loopState.currentSequence, 2);
  assert.strictEqual(envelope.loopState.currentDecision, 'complete');
  // Model switch changes only the decision provider, not the reconstructed state
  assert.strictEqual(envelope.modelContext.currentModelProfileId, 'switched-model');
});
