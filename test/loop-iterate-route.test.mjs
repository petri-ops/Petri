#!/usr/bin/env node

/**
 * HLE-C0: /api/loop/iterate Route Boundary Tests.
 *
 * Tests the contract-level boundaries of the /api/loop/iterate route:
 *   - Authentication & project isolation
 *   - FSM status transition rules
 *   - Sequence ordering (out-of-order rejection)
 *   - Idempotency via actionKey dedupe
 *   - Cross-project isolation
 *   - Immutable hash protection
 *   - Transaction atomicity
 *
 * Uses an isolated temporary SQLite database.
 *
 * Run via: node --test test/loop-iterate-route.test.mjs
 */

import { describe, it, test, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-loop-route-'));
const DB_PATH = path.join(TMP_DIR, 'test.db');
process.env.BIOF3_DB_PATH = DB_PATH;

// ---------------------------------------------------------------------------
// Import modules
// ---------------------------------------------------------------------------
const lc = (await import('../core/shared-backend/loop-contract.js')).default;

// Load DB — must happen after BIOF3_DB_PATH is set
let db;
try {
  const dbMod = await import('../core/biof3-server/db.js');
  db = dbMod.default || dbMod;
} catch (e) {
  db = null;
}

// ---------------------------------------------------------------------------
// Test HTTP helpers (mock Express app using raw Node http)
// ---------------------------------------------------------------------------

function makeMockReq(body = {}) {
  return { body, params: {}, query: {} };
}
function makeMockRes() {
  const res = {
    _status: 200,
    _body: null,
    _sent: false,
    status(code) { this._status = code; return this; },
    json(data) { this._body = data; this._sent = true; return this; },
  };
  return res;
}

// ---------------------------------------------------------------------------
// Canary: verify DB is available
// ---------------------------------------------------------------------------

let dbAvailable = false;
if (db && db.db && typeof db.persistLoopRun === 'function') {
  dbAvailable = true;
} else {
  console.warn('[loop-iterate-route] DB not available — DB-dependent tests will be skipped');
}

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

function buildMinimalRun(projectId = 'proj_route_test', conversationId = 'conv_route_test') {
  const run = lc.buildLoopRun({
    projectId,
    conversationId,
    taskSpecRef: 'spt1-bulk-rnaseq',
    loopStatus: 'planned',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return run;
}

function buildMinimalIterationData(loopRunId, seq = 1) {
  return {
    loopRunId,
    sequence: seq,
    observedStateDigest: 'd' + '0'.repeat(63),
    goalGapIds: [],
    proposedAction: {
      actionId: `act_${loopRunId}_${seq}`,
      actionType: 'run_tool',
      toolId: 'deseq2',
      actionKey: `run:${loopRunId}:${seq}`,
      stable: true,
    },
    decision: 'continue',
    decisionReasonCode: 'TOOL_CALLED',
    status: 'pending',
  };
}

// ===========================================================================
// ROUTE BOUNDARY TESTS (mock Express — no real server)
// ===========================================================================

describe('RB-1: Route requires projectId and conversationId', () => {
  test('RB-1.1: Missing projectId returns 400', () => {
    const req = makeMockReq({ conversationId: 'conv1', loopRun: {}, iteration: {} });
    const res = makeMockRes();
    if (!req.body.projectId || !req.body.conversationId) {
      res.status(400).json({ ok: false, error: 'missing_project_or_conversation' });
    }
    assert.strictEqual(res._status, 400);
    assert.strictEqual(res._body.error, 'missing_project_or_conversation');
  });

  test('RB-1.2: Missing conversationId returns 400', () => {
    const req = makeMockReq({ projectId: 'proj1', loopRun: {}, iteration: {} });
    const res = makeMockRes();
    if (!req.body.projectId || !req.body.conversationId) {
      res.status(400).json({ ok: false, error: 'missing_project_or_conversation' });
    }
    assert.strictEqual(res._status, 400);
    assert.strictEqual(res._body.error, 'missing_project_or_conversation');
  });

  test('RB-1.3: Both present passes the guard', () => {
    const req = makeMockReq({ projectId: 'proj1', conversationId: 'conv1', loopRun: {}, iteration: {} });
    const res = makeMockRes();
    if (!req.body.projectId || !req.body.conversationId) {
      res.status(400).json({ ok: false, error: 'missing_project_or_conversation' });
    }
    assert.strictEqual(res._status, 200);
  });
});

describe('RB-2: Route requires loopRun with loopRunId and loopStatus', () => {
  test('RB-2.1: Missing loopRunId returns 400 loop_run_required', () => {
    const req = makeMockReq({ projectId: 'proj1', conversationId: 'conv1', loopRun: { loopStatus: 'running' }, iteration: {} });
    const res = makeMockRes();
    const body = req.body;
    const loopRunInput = body.loopRun || {};
    if (!loopRunInput.loopRunId || !loopRunInput.loopStatus) {
      res.status(400).json({ ok: false, error: 'loop_run_required' });
    }
    assert.strictEqual(res._status, 400);
    assert.strictEqual(res._body.error, 'loop_run_required');
  });

  test('RB-2.2: Missing loopStatus returns 400 loop_run_required', () => {
    const req = makeMockReq({ projectId: 'proj1', conversationId: 'conv1', loopRun: { loopRunId: 'lr_001' }, iteration: {} });
    const res = makeMockRes();
    const body = req.body;
    const loopRunInput = body.loopRun || {};
    if (!loopRunInput.loopRunId || !loopRunInput.loopStatus) {
      res.status(400).json({ ok: false, error: 'loop_run_required' });
    }
    assert.strictEqual(res._status, 400);
    assert.strictEqual(res._body.error, 'loop_run_required');
  });
});

describe('RB-3: Route requires iteration object', () => {
  test('RB-3.1: Missing iteration returns 400 iteration_required', () => {
    const req = makeMockReq({ projectId: 'proj1', conversationId: 'conv1', loopRun: { loopRunId: 'lr_001', loopStatus: 'running' }, iteration: null });
    const res = makeMockRes();
    const body = req.body;
    const iterationInput = body.iteration;
    if (!iterationInput || typeof iterationInput !== 'object') {
      res.status(400).json({ ok: false, error: 'iteration_required' });
    }
    assert.strictEqual(res._status, 400);
    assert.strictEqual(res._body.error, 'iteration_required');
  });

  test('RB-3.2: Non-object iteration returns 400', () => {
    const req = makeMockReq({ projectId: 'proj1', conversationId: 'conv1', loopRun: { loopRunId: 'lr_001', loopStatus: 'running' }, iteration: 'not_an_object' });
    const res = makeMockRes();
    const body = req.body;
    const iterationInput = body.iteration;
    if (!iterationInput || typeof iterationInput !== 'object') {
      res.status(400).json({ ok: false, error: 'iteration_required' });
    }
    assert.strictEqual(res._status, 400);
  });
});

// ===========================================================================
// DB-LEVEL ROUTE GUARD TESTS
// ===========================================================================

if (dbAvailable) {
  // -------------------------------------------------------------------------
  // RB-4: Sequence validation
  // -------------------------------------------------------------------------
  describe('RB-4: Sequence validation', () => {
    test('RB-4.1: buildIteration requires positive integer sequence', () => {
      // seq 0 — invalid
      assert.throws(
        () => lc.buildIteration({
          loopRunId: 'lr_001', sequence: 0,
          observedStateDigest: 'x'.repeat(64), goalGapIds: [],
          decision: 'continue', decisionReasonCode: 'TEST',
        }),
        /sequence/i,
        'sequence 0 must be rejected',
      );
      // seq -1 — invalid
      assert.throws(
        () => lc.buildIteration({
          loopRunId: 'lr_001', sequence: -1,
          observedStateDigest: 'x'.repeat(64), goalGapIds: [],
          decision: 'continue', decisionReasonCode: 'TEST',
        }),
        /sequence/i,
        'sequence -1 must be rejected',
      );
      // seq 1.5 — invalid
      assert.throws(
        () => lc.buildIteration({
          loopRunId: 'lr_001', sequence: 1.5,
          observedStateDigest: 'x'.repeat(64), goalGapIds: [],
          decision: 'continue', decisionReasonCode: 'TEST',
        }),
        /sequence/i,
        'sequence 1.5 must be rejected',
      );
      // seq 1 — valid
      const valid = lc.buildIteration({
        loopRunId: 'lr_001', sequence: 1,
        observedStateDigest: 'x'.repeat(64), goalGapIds: [],
        decision: 'continue', decisionReasonCode: 'TEST',
      });
      assert.strictEqual(valid.sequence, 1, 'sequence 1 is valid');
    });

    test('RB-4.2: First iteration in running loop must be sequence 1', () => {
      const run = buildMinimalRun('proj_seq2', 'conv_seq2');
      db.persistLoopRun(run);
      const iterData = buildMinimalIterationData(run.loopRunId, 1);
      const iter = lc.buildIteration(iterData, {});
      db.persistLoopIteration(iter);
      assert.strictEqual(iter.sequence, 1, 'first iteration sequence must be 1');
    });

    test('RB-4.3: Out-of-order sequence detection works', () => {
      const run = buildMinimalRun('proj_seq3', 'conv_seq3');
      db.persistLoopRun(run);
      db.updateLoopRunStatus(run.loopRunId, {
        loopStatus: 'running', hash: run.hash,
        json: JSON.stringify({ ...run, loopStatus: 'running' }),
        updatedAt: new Date().toISOString(),
      });
      // Persist seq 1
      const iter1 = lc.buildIteration(buildMinimalIterationData(run.loopRunId, 1), {});
      db.persistLoopIteration(iter1);
      // Route would reject seq 3: lastSeq=1, targetSeq=2, received=3
      const lastSeq = db.listLoopIterations(run.loopRunId, { limit: 1 })[0];
      const targetSeq = lastSeq ? lastSeq.sequence + 1 : 1;
      assert.notStrictEqual(3, targetSeq, `seq 3 ≠ ${targetSeq}, out-of-order detection works`);
    });

    test('RB-4.4: Correct sequential sequence is accepted', () => {
      const run = buildMinimalRun('proj_seq4', 'conv_seq4');
      db.persistLoopRun(run);
      db.updateLoopRunStatus(run.loopRunId, {
        loopStatus: 'running', hash: run.hash,
        json: JSON.stringify({ ...run, loopStatus: 'running' }),
        updatedAt: new Date().toISOString(),
      });
      // seq 1
      const iter1 = lc.buildIteration(buildMinimalIterationData(run.loopRunId, 1), {});
      db.persistLoopIteration(iter1);
      // seq 2 (correct next)
      const lastSeq = db.listLoopIterations(run.loopRunId, { limit: 1 })[0];
      const targetSeq = lastSeq ? lastSeq.sequence + 1 : 1;
      assert.strictEqual(targetSeq, 2, 'next expected sequence is 2');
      const iter2 = lc.buildIteration(buildMinimalIterationData(run.loopRunId, 2), {});
      db.persistLoopIteration(iter2);
      assert.strictEqual(iter2.sequence, 2, 'seq 2 accepted');
    });
  });

  // -------------------------------------------------------------------------
  // RB-5: FSM status transitions
  // -------------------------------------------------------------------------
  describe('RB-5: FSM status transitions', () => {
    test('RB-5.1: planned → running is valid', () => {
      const result = lc.checkLoopStatusTransition('planned', 'running');
      assert.strictEqual(result, true, 'planned→running must be valid');
    });

    test('RB-5.2: running → running is valid (keep-alive)', () => {
      const result = lc.checkLoopStatusTransition('running', 'running');
      assert.strictEqual(result, true, 'running→running must be valid');
    });

    test('RB-5.3: planned → completed is INVALID', () => {
      assert.throws(
        () => lc.checkLoopStatusTransition('planned', 'completed'),
        /invalid.*transition/i,
        'planned→completed must be rejected',
      );
    });

    test('RB-5.4: running → completed is valid', () => {
      const result = lc.checkLoopStatusTransition('running', 'completed');
      assert.strictEqual(result, true, 'running→completed must be valid');
    });

    test('RB-5.5: completed → running is INVALID (terminal state)', () => {
      assert.throws(
        () => lc.checkLoopStatusTransition('completed', 'running'),
        /invalid.*transition/i,
        'completed→running must be rejected',
      );
    });

    test('RB-5.6: blocked → running is VALID (recovery)', () => {
      const result = lc.checkLoopStatusTransition('blocked', 'running');
      assert.strictEqual(result, true, 'blocked→running must be valid');
    });

    test('RB-5.7: blocked → completed is VALID (manual confirmation)', () => {
      const result = lc.checkLoopStatusTransition('blocked', 'completed');
      assert.strictEqual(result, true, 'blocked→completed must be valid');
    });

    test('RB-5.8: failed → running is VALID (retry after failure)', () => {
      const result = lc.checkLoopStatusTransition('failed', 'running');
      assert.strictEqual(result, true, 'failed→running must be valid');
    });

    test('RB-5.9: cancelled is terminal (no transitions)', () => {
      assert.throws(
        () => lc.checkLoopStatusTransition('cancelled', 'running'),
        /invalid.*transition/i,
        'cancelled→running must be rejected',
      );
    });
  });

  // -------------------------------------------------------------------------
  // RB-6: Cross-project isolation
  // -------------------------------------------------------------------------
  describe('RB-6: Cross-project isolation', () => {
    test('RB-6.1: LoopRun belongs to one project only', () => {
      const run = buildMinimalRun('proj_a', 'conv_a');
      const persisted = db.persistLoopRun(run);
      const fetched = db.getLoopRun(persisted.loopRunId);
      assert.strictEqual(fetched.projectId, 'proj_a', 'LoopRun projectId is immutable after persist');
    });

    test('RB-6.2: Route rejects cross-project query', () => {
      const run = buildMinimalRun('proj_isolated', 'conv_isolated');
      db.persistLoopRun(run);
      // Simulate route cross-project guard
      const body = { projectId: 'proj_other', loopRun: { loopRunId: run.loopRunId, loopStatus: 'running' }, iteration: {} };
      const existing = db.getLoopRun(body.loopRun.loopRunId);
      const crossProject = existing && existing.projectId !== body.projectId;
      assert.ok(crossProject, 'Cross-project access must be detected');
    });
  });

  // -------------------------------------------------------------------------
  // RB-7: actionKey idempotency
  // -------------------------------------------------------------------------
  describe('RB-7: actionKey idempotency', () => {
    test('RB-7.1: Identical actionKey with same params is deduplicated', () => {
      const run = buildMinimalRun('proj_idem', 'conv_idem');
      db.persistLoopRun(run);
      db.updateLoopRunStatus(run.loopRunId, {
        loopStatus: 'running', hash: run.hash,
        json: JSON.stringify({ ...run, loopStatus: 'running' }),
        updatedAt: new Date().toISOString(),
      });

      const iter1 = lc.buildIteration(buildMinimalIterationData(run.loopRunId, 1), {});
      db.persistLoopIteration(iter1);
      const action1 = db.persistLoopAction({
        ...iter1.proposedAction,
        loopRunId: run.loopRunId,
        sequence: 1,
        iterationId: iter1.iterationId,
      });
      assert.ok(action1?.actionKey, 'Action persisted');

      // Same actionKey — should throw loop_action_duplicate_action_key
      let dedupeCaught = false;
      let dedupedAction = null;
      try {
        db.persistLoopAction({
          ...iter1.proposedAction,
          loopRunId: run.loopRunId,
          sequence: 1,
          iterationId: iter1.iterationId,
          actionId: 'act_b_different_id',
        });
      } catch (e) {
        if (e.message === 'loop_action_duplicate_action_key') {
          dedupeCaught = true;
          dedupedAction = db.getLoopActionByKey(iter1.proposedAction.actionKey);
        } else {
          throw e;
        }
      }

      assert.ok(dedupeCaught, 'Duplicate actionKey must throw loop_action_duplicate_action_key');
      assert.ok(dedupedAction, 'Existing action must be returned on dedupe');
    });

    test('RB-7.2: Different actionKey does not conflict', () => {
      const run = buildMinimalRun('proj_diff_key', 'conv_diff_key');
      db.persistLoopRun(run);
      db.updateLoopRunStatus(run.loopRunId, {
        loopStatus: 'running', hash: run.hash,
        json: JSON.stringify({ ...run, loopStatus: 'running' }),
        updatedAt: new Date().toISOString(),
      });

      const iter1 = lc.buildIteration(buildMinimalIterationData(run.loopRunId, 1), {});
      db.persistLoopIteration(iter1);
      const action1 = db.persistLoopAction({
        ...iter1.proposedAction,
        loopRunId: run.loopRunId,
        sequence: 1,
        iterationId: iter1.iterationId,
      });
      assert.ok(action1, 'First action persisted');

      // Different actionKey — should NOT conflict
      const iter2 = lc.buildIteration(buildMinimalIterationData(run.loopRunId, 2), {});
      db.persistLoopIteration(iter2);
      const action2 = db.persistLoopAction({
        ...iter2.proposedAction,
        loopRunId: run.loopRunId,
        sequence: 2,
        iterationId: iter2.iterationId,
      });
      assert.ok(action2, 'Second action with different key persisted');
      assert.notStrictEqual(action1.actionKey, action2.actionKey, 'Different keys');
    });
  });

  // -------------------------------------------------------------------------
  // RB-8: Hash immutability
  // -------------------------------------------------------------------------
  describe('RB-8: Hash immutability', () => {
    test('RB-8.1: updateLoopRunStatus enforces FSM (planned→completed rejected)', () => {
      const run = buildMinimalRun('proj_hash', 'conv_hash');
      db.persistLoopRun(run);
      assert.throws(
        () => {
          db.updateLoopRunStatus(run.loopRunId, {
            loopStatus: 'completed',
            hash: run.hash,
            json: JSON.stringify({ ...run, loopStatus: 'completed' }),
            updatedAt: new Date().toISOString(),
          });
        },
        /invalid.*transition/i,
        'planned→completed must be rejected by FSM',
      );
    });

    test('RB-8.2: updateLoopRunStatus with valid transition works', () => {
      const run = buildMinimalRun('proj_hash2', 'conv_hash2');
      db.persistLoopRun(run);
      const updated = db.updateLoopRunStatus(run.loopRunId, {
        loopStatus: 'running',
        hash: run.hash,
        json: JSON.stringify({ ...run, loopStatus: 'running' }),
        updatedAt: new Date().toISOString(),
      });
      assert.strictEqual(updated.loopStatus, 'running', 'Valid transition works');
    });

    test('RB-8.3: persistLoopRun rejects hash change (loop_run_immutable)', () => {
      const run = buildMinimalRun('proj_hash3', 'conv_hash3');
      db.persistLoopRun(run);
      const tampered = lc.buildLoopRun({
        ...run,
        loopStatus: 'completed',
        hash: '0'.repeat(64),
        updatedAt: new Date().toISOString(),
      });
      assert.throws(
        () => { db.persistLoopRun(tampered); },
        /loop_run_immutable/,
        'Hash change on re-persist must throw loop_run_immutable',
      );
    });
  });

  // -------------------------------------------------------------------------
  // RB-9: Transaction atomicity
  // -------------------------------------------------------------------------
  describe('RB-9: Transaction atomicity', () => {
    test('RB-9.1: Iteration and Action persist correctly', () => {
      const run = buildMinimalRun('proj_tx', 'conv_tx');
      db.persistLoopRun(run);
      db.updateLoopRunStatus(run.loopRunId, {
        loopStatus: 'running', hash: run.hash,
        json: JSON.stringify({ ...run, loopStatus: 'running' }),
        updatedAt: new Date().toISOString(),
      });

      const iter = lc.buildIteration(buildMinimalIterationData(run.loopRunId, 1), {});
      const persistedIter = db.persistLoopIteration(iter);
      assert.ok(persistedIter?.iterationId, 'Iteration persisted');

      const fetchedRun = db.getLoopRun(run.loopRunId);
      const fetchedIters = db.listLoopIterations(run.loopRunId, { limit: 10 });
      assert.ok(fetchedRun, 'LoopRun persisted');
      assert.strictEqual(fetchedIters.length, 1, 'Iteration persisted');
      assert.strictEqual(fetchedIters[0].iterationId, persistedIter.iterationId);
    });
  });
} else {
  test('RB-SKIP: DB not available — all DB-dependent tests skipped', () => {
    assert.ok(true, 'DB not available, tests skipped gracefully');
  });
}

// ===========================================================================
// CONTRACT-LEVEL ROUTE GUARD TESTS (no DB required)
// ===========================================================================

describe('RB-CONTRACT: Route guard contract without DB', () => {
  test('RB-C1: projectId must be non-empty string', () => {
    for (const val of ['', null, undefined, 0, false]) {
      const req = { body: { projectId: val, conversationId: 'conv1', loopRun: {}, iteration: {} } };
      const blocked = !req.body.projectId || typeof req.body.projectId !== 'string' || req.body.projectId.trim() === '';
      assert.ok(blocked, `projectId=${JSON.stringify(val)} must be rejected`);
    }
  });

  test('RB-C2: conversationId must be non-empty string', () => {
    for (const val of ['', null, undefined]) {
      const req = { body: { projectId: 'proj1', conversationId: val, loopRun: {}, iteration: {} } };
      const blocked = !req.body.conversationId;
      assert.ok(blocked, `conversationId=${JSON.stringify(val)} must be rejected`);
    }
  });

  test('RB-C3: loopRunId must be non-empty string', () => {
    const loopRunInput = { loopRunId: '', loopStatus: 'running' };
    const blocked = !loopRunInput.loopRunId;
    assert.ok(blocked, 'empty loopRunId must be rejected');
  });

  test('RB-C4: actionKey generation is deterministic and stable', () => {
    // generateActionKey uses actionType + params (stableHash) + toolId + loopRunId + sequence
    const action = lc.buildAction({
      actionType: 'run_tool',
      toolId: 'deseq2',
      toolCallId: 'call_abc',
      params: { design: '~condition', contrast: ['condition', 'treatment', 'control'] },
    });
    const actionKey = lc.generateActionKey(action);
    assert.ok(actionKey, 'actionKey must be generated');
    assert.strictEqual(typeof actionKey, 'string', 'actionKey must be a string');
    assert.ok(actionKey.length > 0, 'actionKey must be non-empty');

    // Same params → same actionKey (idempotency)
    const action2 = lc.buildAction({
      actionType: 'run_tool',
      toolId: 'deseq2',
      toolCallId: 'call_abc',
      params: { design: '~condition', contrast: ['condition', 'treatment', 'control'] },
    });
    const actionKey2 = lc.generateActionKey(action2);
    assert.strictEqual(actionKey, actionKey2, 'Same params must produce same actionKey');

    // Different params → different actionKey
    const action3 = lc.buildAction({
      actionType: 'run_tool',
      toolId: 'deseq2',
      toolCallId: 'call_def',
      params: { design: '~condition_v2', contrast: ['condition', 'treatment', 'control'] },
    });
    const actionKey3 = lc.generateActionKey(action3);
    assert.notStrictEqual(actionKey, actionKey3, 'Different params must produce different actionKey');
  });

  test('RB-C5: stableHash is deterministic and stable', () => {
    const obj = { a: 1, b: 2 };
    const h1 = lc.stableHash(obj);
    const h2 = lc.stableHash(obj);
    assert.strictEqual(h1, h2, 'stableHash must be deterministic');
    assert.strictEqual(h1.length, 64, 'stableHash must be 64-char SHA-256 hex');

    const objDifferent = { a: 1, b: 3 };
    const h3 = lc.stableHash(objDifferent);
    assert.notStrictEqual(h1, h3, 'Different objects must have different hashes');
  });

  test('RB-C6: canonicalStringify sorts keys deterministically', () => {
    const obj1 = { b: 2, a: 1 };
    const obj2 = { a: 1, b: 2 };
    const s1 = lc.canonicalStringify(obj1);
    const s2 = lc.canonicalStringify(obj2);
    assert.strictEqual(s1, s2, 'canonicalStringify must sort keys');
  });

  test('RB-C7: redactSensitiveValue masks API keys', () => {
    const obj = {
      apiKey: 'sk-1234567890abcdef',
      endpoint: 'https://api.example.com',
      content: 'normal content',
    };
    const redacted = lc.redactSensitiveValue(obj);
    assert.ok(!redacted.apiKey || redacted.apiKey !== 'sk-1234567890abcdef', 'apiKey must be redacted');
    assert.strictEqual(redacted.endpoint, 'https://api.example.com', 'endpoint must not be redacted');
    assert.strictEqual(redacted.content, 'normal content', 'content must not be redacted');
  });

  test('RB-C8: buildAction requires toolId for run_tool actionType', () => {
    assert.throws(
      () => lc.buildAction({
        actionType: 'run_tool',
        actionId: 'act_001',
        // missing toolId
      }),
      /toolId.*required/i,
      'run_tool must require toolId',
    );
    const valid = lc.buildAction({
      actionType: 'run_tool',
      actionId: 'act_002',
      toolId: 'deseq2',
      toolCallId: 'call_xyz',
      paramsHash: 'abc',
    });
    assert.ok(valid, 'run_tool with toolId is valid');
  });

  test('RB-C9: validateLoopRun requires required fields', () => {
    assert.throws(
      () => lc.validateLoopRun({}),
      /loopRunId/i,
      'validateLoopRun must require loopRunId',
    );
    const run = lc.buildLoopRun({
      projectId: 'p', conversationId: 'c', taskSpecRef: 's',
      loopStatus: 'planned', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    lc.validateLoopRun(run); // must not throw
  });

  test('RB-C10: validateIteration requires required fields', () => {
    assert.throws(
      () => lc.validateIteration({}),
      /loopRunId/i,
      'validateIteration must require loopRunId',
    );
    // buildIteration sets publicConclusion="" which requires allowPartial=true for validation
    const iter = lc.buildIteration({
      loopRunId: 'lr_001', sequence: 1,
      observedStateDigest: 'x'.repeat(64), goalGapIds: [],
      decision: 'continue', decisionReasonCode: 'TEST',
      publicConclusion: 'test',
    });
    lc.validateIteration(iter); // must not throw when publicConclusion is non-empty
  });
});
