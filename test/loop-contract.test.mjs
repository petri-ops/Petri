#!/usr/bin/env node

/**
 * Loop Contract v1 — pure unit tests (no DB, no network).
 * Run via: node --test test/loop-contract.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import lc from '../core/shared-backend/loop-contract.js';

const {
  LOOP_CONTRACT_VERSION,
  LOOP_RUN_STATUSES,
  ITERATION_STATUSES,
  ACTION_TYPES,
  DECISION_OUTCOMES,
  EVIDENCE_KINDS,
  REASON_CODES,
  TERMINAL_LOOP_STATUSES,
  canonicalStringify,
  sha256Hex,
  stableHash,
  generateId,
  generateActionKey,
  validateLoopRun,
  validateIteration,
  validateAction,
  validateEvidence,
  validateDecision,
  checkLoopStatusTransition,
  checkIterationStatusTransition,
  isTerminalLoopStatus,
  buildLoopRun,
  buildIteration,
  buildAction,
  buildEvidence,
  buildDecision,
  projectLoopRunPartial,
} = lc;

describe('LC schema and enums', () => {
  it('LC-1 schemaVersion is fixed at 1', () => {
    assert.strictEqual(LOOP_CONTRACT_VERSION, 1);
  });

  it('LC-2 status enums are frozen and non-empty', () => {
    for (const [name, list] of [
      ['LOOP_RUN_STATUSES', LOOP_RUN_STATUSES],
      ['ITERATION_STATUSES', ITERATION_STATUSES],
      ['ACTION_TYPES', ACTION_TYPES],
      ['DECISION_OUTCOMES', DECISION_OUTCOMES],
      ['EVIDENCE_KINDS', EVIDENCE_KINDS],
    ]) {
      assert.ok(Array.isArray(list) && list.length > 0, `${name} non-empty`);
      assert.ok(Object.isFrozen(list), `${name} frozen`);
    }
  });

  it('LC-3 reason codes are stable SCREAMING_SNAKE identifiers', () => {
    for (const [k, v] of Object.entries(REASON_CODES)) {
      assert.strictEqual(typeof v, 'string');
      assert.ok(/^[A-Z][A-Z0-9_]+$/.test(v), `${k}=${v}`);
    }
  });

  it('LC-4 terminal statuses set contains completed/failed/cancelled', () => {
    assert.ok(TERMINAL_LOOP_STATUSES.has('completed'));
    assert.ok(TERMINAL_LOOP_STATUSES.has('failed'));
    assert.ok(TERMINAL_LOOP_STATUSES.has('cancelled'));
    assert.ok(!TERMINAL_LOOP_STATUSES.has('running'));
  });

  it('LC-5 isTerminalLoopStatus reflects TERMINAL_LOOP_STATUSES', () => {
    assert.ok(isTerminalLoopStatus('completed'));
    assert.ok(!isTerminalLoopStatus('running'));
    assert.ok(!isTerminalLoopStatus('blocked'));
  });

  it('LC-45 LOOP_STATUS_TRANSITIONS is exhaustive', () => {
    for (const status of LOOP_RUN_STATUSES) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(lc.LOOP_STATUS_TRANSITIONS, status),
        `missing transition entry for ${status}`,
      );
    }
  });

  it('LC-46 ITERATION_STATUS_TRANSITIONS is exhaustive', () => {
    for (const status of ITERATION_STATUSES) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(lc.ITERATION_STATUS_TRANSITIONS, status),
        `missing transition entry for ${status}`,
      );
    }
  });

  it('LC-48 loop-contract has no DB, fs, or network dependencies', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const moduleSource = fs.readFileSync(
      path.join(repoRoot, 'core/shared-backend/loop-contract.js'),
      'utf8',
    );
    assert.ok(!/require\((['"])better-sqlite3\1\)/.test(moduleSource));
    assert.ok(!/require\((['"])express\1\)/.test(moduleSource));
    assert.ok(!/\bfs\.writeFileSync\b/.test(moduleSource));
    assert.ok(!/\bfetch\(/.test(moduleSource));
  });
});

describe('LC hashing and serialization', () => {
  it('LC-6 canonicalStringify produces stable output regardless of key order', () => {
    const a = { b: 1, a: 2, c: { z: 3, y: 4 } };
    const b = { c: { y: 4, z: 3 }, a: 2, b: 1 };
    assert.strictEqual(canonicalStringify(a), canonicalStringify(b));
  });

  it('LC-7 canonicalStringify arrays are order-sensitive', () => {
    const a = { items: [1, 2, 3] };
    const b = { items: [3, 2, 1] };
    assert.notStrictEqual(canonicalStringify(a), canonicalStringify(b));
  });

  it('LC-8 sha256Hex is 64-char lowercase hex', () => {
    const h = sha256Hex('hello');
    assert.strictEqual(h.length, 64);
    assert.ok(/^[0-9a-f]{64}$/.test(h));
  });

  it('LC-9 sha256Hex is deterministic', () => {
    assert.strictEqual(sha256Hex('x'), sha256Hex('x'));
    assert.notStrictEqual(sha256Hex('x'), sha256Hex('y'));
  });

  it('LC-10 stableHash on identical semantic fields is identical', () => {
    const a = stableHash({ a: 1, b: 2 });
    const b = stableHash({ b: 2, a: 1 });
    assert.strictEqual(a, b);
  });

  it('LC-11 generateId returns prefixed unique strings', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i += 1) ids.add(generateId('iter'));
    assert.strictEqual(ids.size, 50);
    for (const id of ids) {
      assert.ok(id.startsWith('iter_'));
      assert.ok(id.length > 10);
    }
  });

  it('LC-41 generateActionKey is sha256 hex 64 chars', () => {
    const k = generateActionKey({
      loopRunId: 'l1',
      sequence: 1,
      actionType: 'plan',
    });
    assert.strictEqual(k.length, 64);
    assert.ok(/^[0-9a-f]{64}$/.test(k));
  });
});

describe('LC actionKey dedupe semantics', () => {
  it('LC-12 generateActionKey stable for same semantic input', () => {
    const opts = {
      loopRunId: 'loop_x',
      sequence: 3,
      actionType: 'run_tool',
      toolId: 'deseq2',
      inputs: { counts: 'counts.csv' },
      params: { design: '~condition' },
      expectedArtifactKinds: ['deg_table'],
      attempt: 1,
    };
    assert.strictEqual(generateActionKey(opts), generateActionKey({ ...opts }));
  });

  it('LC-13 generateActionKey differs when inputs differ', () => {
    const base = { loopRunId: 'l', sequence: 1, actionType: 'run_tool', toolId: 't' };
    const a = generateActionKey({ ...base, inputs: { x: 1 } });
    const b = generateActionKey({ ...base, inputs: { x: 2 } });
    assert.notStrictEqual(a, b);
  });

  it('LC-14 generateActionKey differs when attempt differs', () => {
    const base = { loopRunId: 'l', sequence: 1, actionType: 'run_tool', toolId: 't' };
    const a = generateActionKey({ ...base, attempt: 1 });
    const b = generateActionKey({ ...base, attempt: 2 });
    assert.notStrictEqual(a, b);
  });

  it('LC-49 identical action dedupes across iterations', () => {
    const a = buildAction({
      loopRunId: 'l1',
      sequence: 1,
      actionType: 'run_tool',
      toolId: 'deseq2',
      inputs: { counts: 'counts.csv' },
    });
    const b = buildAction({
      loopRunId: 'l1',
      sequence: 1,
      actionType: 'run_tool',
      toolId: 'deseq2',
      inputs: { counts: 'counts.csv' },
    });
    assert.strictEqual(a.actionKey, b.actionKey);
  });

  it('LC-50 cross-loop-run actionKey isolation', () => {
    const a = buildAction({
      loopRunId: 'l1',
      sequence: 1,
      actionType: 'run_tool',
      toolId: 'foo',
    });
    const b = buildAction({
      loopRunId: 'l2',
      sequence: 1,
      actionType: 'run_tool',
      toolId: 'foo',
    });
    assert.notStrictEqual(a.actionKey, b.actionKey);
  });
});

describe('LC validators', () => {
  it('LC-15 validateLoopRun rejects unknown status', () => {
    assert.throws(
      () =>
        validateLoopRun({
          loopRunId: 'l',
          projectId: 'p',
          conversationId: 'c',
          loopStatus: 'imaginary',
        }),
      /loopRun\.loopStatus/,
    );
  });

  it('LC-16 validateLoopRun rejects empty loopRunId', () => {
    assert.throws(
      () =>
        validateLoopRun({
          loopRunId: '',
          projectId: 'p',
          conversationId: 'c',
          loopStatus: 'planned',
        }),
      /loopRunId/,
    );
  });

  it('LC-17 validateLoopRun requires taskSpecRef unless allowPartial', () => {
    assert.throws(
      () =>
        validateLoopRun({
          loopRunId: 'l',
          projectId: 'p',
          conversationId: 'c',
          loopStatus: 'planned',
        }),
      /taskSpecRef/,
    );
    assert.doesNotThrow(() =>
      validateLoopRun(
        {
          loopRunId: 'l',
          projectId: 'p',
          conversationId: 'c',
          loopStatus: 'planned',
        },
        { allowPartial: true },
      ),
    );
  });

  it('LC-18 validateIteration requires positive integer sequence', () => {
    assert.throws(
      () =>
        validateIteration({
          loopRunId: 'l',
          sequence: 0,
          observedStateDigest: 'x',
          decision: 'continue',
          decisionReasonCode: 'X',
          status: 'pending',
        }),
      /sequence/,
    );
  });

  it('LC-19 validateIteration requires non-empty publicConclusion unless allowPartial', () => {
    assert.throws(
      () =>
        validateIteration({
          loopRunId: 'l',
          sequence: 1,
          observedStateDigest: 'x',
          decision: 'continue',
          decisionReasonCode: 'X',
          status: 'pending',
          publicConclusion: '',
        }),
      /publicConclusion/,
    );
    assert.doesNotThrow(() =>
      validateIteration(
        {
          loopRunId: 'l',
          sequence: 1,
          observedStateDigest: 'x',
          decision: 'continue',
          decisionReasonCode: 'X',
          status: 'pending',
        },
        { allowPartial: true },
      ),
    );
  });

  it('LC-20 validateIteration rejects unknown decision', () => {
    assert.throws(
      () =>
        validateIteration({
          loopRunId: 'l',
          sequence: 1,
          observedStateDigest: 'x',
          decision: 'teleport',
          decisionReasonCode: 'X',
          status: 'pending',
        }),
      /decision/,
    );
  });

  it('LC-21 validateAction run_tool requires toolId', () => {
    assert.throws(() => validateAction({ actionType: 'run_tool' }), /toolId/);
    assert.doesNotThrow(() => validateAction({ actionType: 'wait_for_user' }));
  });

  it('LC-22 validateAction rejects unknown actionType', () => {
    assert.throws(() => validateAction({ actionType: 'fly' }), /actionType/);
  });

  it('LC-23 validateEvidence rejects unknown kind', () => {
    assert.throws(
      () =>
        validateEvidence({
          evidenceId: 'e',
          kind: 'alien_signal',
          ref: 'r',
        }),
      /kind/,
    );
  });

  it('LC-42 validateDecision rejects unknown decision', () => {
    assert.throws(
      () => validateDecision({ decision: 'fly', decisionReasonCode: 'X' }),
      /decision/,
    );
  });

  it('LC-43 buildLoopRun throws on missing required fields', () => {
    assert.throws(() => buildLoopRun({}), /projectId/);
  });

  it('LC-44 buildIteration throws when proposedAction has invalid type', () => {
    assert.throws(
      () =>
        buildIteration({
          loopRunId: 'l1',
          sequence: 1,
          observedStateDigest: 'x',
          decision: 'continue',
          decisionReasonCode: 'X',
          status: 'pending',
          proposedAction: { actionType: 'teleport' },
        }),
      /actionType/,
    );
  });
});

describe('LC status transitions', () => {
  it('LC-24 planned -> running is valid', () => {
    assert.doesNotThrow(() => checkLoopStatusTransition('planned', 'running'));
  });

  it('LC-25 completed -> running is invalid', () => {
    assert.throws(
      () => checkLoopStatusTransition('completed', 'running'),
      /Invalid status transition/,
    );
  });

  it('LC-26 same status transition is a no-op', () => {
    assert.doesNotThrow(() => checkLoopStatusTransition('running', 'running'));
  });

  it('LC-27 iteration pending -> running', () => {
    assert.doesNotThrow(() => checkIterationStatusTransition('pending', 'running'));
  });

  it('LC-28 iteration succeeded -> running is invalid', () => {
    assert.throws(
      () => checkIterationStatusTransition('succeeded', 'running'),
      /Invalid status transition/,
    );
  });
});

describe('LC builders and redaction', () => {
  it('LC-29 buildLoopRun produces a hash and is stable across calls', () => {
    const a = buildLoopRun({
      projectId: 'p1',
      conversationId: 'c1',
      taskSpecRef: 'spt1-bulk-rnaseq',
      loopStatus: 'planned',
    });
    assert.ok(a.hash);
    assert.strictEqual(a.hash.length, 64);

    const b = buildLoopRun({
      loopRunId: a.loopRunId,
      projectId: 'p1',
      conversationId: 'c1',
      taskSpecRef: 'spt1-bulk-rnaseq',
      loopStatus: 'planned',
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    });
    assert.strictEqual(a.hash, b.hash);
  });

  it('LC-30 buildLoopRun redacts sensitive metadata fields', () => {
    const loopRun = buildLoopRun({
      projectId: 'p1',
      conversationId: 'c1',
      taskSpecRef: 'spt1',
      loopStatus: 'planned',
      metadata: {
        apiKey: 'sk-abcdefghijklmnopqrstuvwxyz1234',
        note: 'public',
      },
    });
    assert.strictEqual(loopRun.metadata.apiKey, '[REDACTED]');
    assert.strictEqual(loopRun.metadata.note, 'public');
  });

  it('LC-31 buildIteration produces hash and action hash', () => {
    const it = buildIteration({
      loopRunId: 'l1',
      sequence: 1,
      observedStateDigest: 'plan_generated',
      goalGapIds: ['no_workflow_plan'],
      proposedAction: { actionType: 'plan', params: { toolId: 'spt1-wf-v1' } },
      decision: 'continue',
      decisionReasonCode: 'NORMAL_PLAN_GENERATED',
      publicConclusion: '已生成包含 7 个节点的 DAG。',
    });
    assert.ok(it.hash);
    assert.strictEqual(it.hash.length, 64);
    assert.ok(it.proposedAction && it.proposedAction.hash);
    assert.ok(it.proposedAction.actionKey);
  });

  it('LC-32 same semantic fields yield same iteration hash', () => {
    const opts = {
      loopRunId: 'l1',
      sequence: 5,
      observedStateDigest: 'node_done',
      goalGapIds: [],
      decision: 'continue',
      decisionReasonCode: 'ALL_NODES_VERIFIED',
      publicConclusion: 'ok',
      status: 'pending',
    };
    const a = buildIteration({ ...opts, iterationId: 'iter_a' });
    const b = buildIteration({ ...opts, iterationId: 'iter_b' });
    assert.strictEqual(a.hash, b.hash);
    assert.notStrictEqual(a.iterationId, b.iterationId);
  });

  it('LC-33 buildAction run_tool deterministic actionKey', () => {
    const a = buildAction({
      loopRunId: 'l1',
      sequence: 2,
      actionType: 'run_tool',
      toolId: 'deseq2',
      inputs: { counts: 'counts.csv' },
      params: { design: '~condition' },
    });
    const b = buildAction({
      loopRunId: 'l1',
      sequence: 2,
      actionType: 'run_tool',
      toolId: 'deseq2',
      inputs: { counts: 'counts.csv' },
      params: { design: '~condition' },
    });
    assert.strictEqual(a.actionKey, b.actionKey);
    assert.strictEqual(a.hash, b.hash);
  });

  it('LC-34 buildAction redacts inputs and params', () => {
    const action = buildAction({
      actionType: 'run_tool',
      toolId: 'foo',
      inputs: { token: 'sk-abcdefghijklmnopqrstuvwxyz1234', normal: 'x' },
      params: { apiKey: 'k', other: 1 },
    });
    assert.strictEqual(action.inputs.token, '[REDACTED]');
    assert.strictEqual(action.inputs.normal, 'x');
    assert.strictEqual(action.params.apiKey, '[REDACTED]');
  });

  it('LC-35 buildEvidence produces hash for all kinds', () => {
    for (const kind of EVIDENCE_KINDS) {
      const ev = buildEvidence({ kind, ref: 'r1', summaryDigest: 'd' });
      assert.ok(ev.hash);
      assert.strictEqual(ev.kind, kind);
    }
  });

  it('LC-36 buildDecision requires decision + reasonCode', () => {
    assert.throws(() => buildDecision({ decision: 'continue' }), /decision/);
    const d = buildDecision({
      decision: 'continue',
      decisionReasonCode: 'ALL_NODES_VERIFIED',
      confidence: 0.9,
      notes: 'all good',
    });
    assert.ok(d.hash);
  });

  it('LC-37 projectLoopRunPartial marks legacy data as partial', () => {
    const projected = projectLoopRunPartial({
      loopRunId: 'legacy-1',
      projectId: 'p1',
      conversationId: 'c1',
      taskSpecRef: null,
    });
    assert.strictEqual(projected.isPartial, true);
    assert.strictEqual(projected.partialReason, 'legacy_no_loop_data');
    assert.strictEqual(projected.loopRunId, 'legacy-1');
  });

  it('LC-38 buildIteration redacts sensitive text in publicConclusion', () => {
    const it = buildIteration({
      loopRunId: 'l1',
      sequence: 1,
      observedStateDigest: 'x',
      decision: 'continue',
      decisionReasonCode: 'NORMAL_PLAN_GENERATED',
      publicConclusion: 'see token: sk-abcdefghijklmnopqrstuvwxyz1234',
    });
    assert.ok(!it.publicConclusion.includes('sk-abcdefghijklmnopqrstuvwxyz1234'));
  });

  it('LC-40 iteration hash is stable for safe text', () => {
    const it1 = buildIteration({
      loopRunId: 'l1',
      sequence: 1,
      observedStateDigest: 'x',
      decision: 'continue',
      decisionReasonCode: 'NORMAL_PLAN_GENERATED',
      publicConclusion: 'safe text',
    });
    const it2 = buildIteration({
      loopRunId: 'l1',
      sequence: 1,
      observedStateDigest: 'x',
      decision: 'continue',
      decisionReasonCode: 'NORMAL_PLAN_GENERATED',
      publicConclusion: 'safe text',
    });
    assert.strictEqual(it1.hash, it2.hash);
  });

  it('LC-47 buildIteration accepts allowPartial-shaped input', () => {
    const it = buildIteration({
      loopRunId: 'l1',
      sequence: 1,
      observedStateDigest: 'x',
      decision: 'continue',
      decisionReasonCode: 'NORMAL_PLAN_GENERATED',
      status: 'pending',
    });
    assert.strictEqual(it.publicConclusion, '');
  });
});