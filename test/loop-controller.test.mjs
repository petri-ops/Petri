#!/usr/bin/env node

/**
 * Loop Controller v1 — pure unit tests (no DB, no network).
 * Run via: node --test test/loop-controller.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import lc from '../core/shared-backend/loop-contract.js';
import ctrl from '../core/shared-backend/loop-controller.js';

const {
  deriveObservedStateDigest,
  deriveJobsDigest,
  deriveProgressDigest,
  computeGoalGapIds,
  detectNoProgress,
  detectRepeatedAction,
  detectOscillation,
  validateAction,
  decideNextAction,
  buildControllerIteration,
  evaluateExit,
  reconcileJobResult,
  toStructuredDecision,
} = ctrl;

const REASON = lc.REASON_CODES;

// ---------------------------------------------------------------------------
// digest determinism
// ---------------------------------------------------------------------------

describe('CTRL-1 digest determinism', () => {
  it('deriveObservedStateDigest is stable across calls', () => {
    const ctx = {
      toolJobs: [
        { id: 'job1', status: 'completed', finished_at: '2026-01-01T00:00:00Z' },
      ],
      conversationSummary: 'bulk RNA-seq analysis',
      dagProgress: { 'node-1': 'completed', 'node-2': 'pending' },
    };
    const a = deriveObservedStateDigest(ctx);
    const b = deriveObservedStateDigest(ctx);
    assert.strictEqual(a, b);
    assert.strictEqual(a.length, 64);
  });

  it('deriveJobsDigest ignores non-essential fields', () => {
    const a = deriveJobsDigest([{ id: 'j1', status: 'running', error: null }]);
    const b = deriveJobsDigest([{ id: 'j1', status: 'running', error: null, internal: 'secret' }]);
    assert.strictEqual(a, b);
  });

  it('deriveProgressDigest key order does not affect digest', () => {
    const a = deriveProgressDigest({ 'z-node': 'complete', 'a-node': 'complete' });
    const b = deriveProgressDigest({ 'a-node': 'complete', 'z-node': 'complete' });
    assert.strictEqual(a, b);
  });

  it('empty jobs and progress produce valid digest', () => {
    const d = deriveObservedStateDigest({ toolJobs: [], conversationSummary: '', dagProgress: {} });
    assert.strictEqual(typeof d, 'string');
    assert.strictEqual(d.length, 64);
  });
});

// ---------------------------------------------------------------------------
// goal gap analysis
// ---------------------------------------------------------------------------

describe('CTRL-2 computeGoalGapIds', () => {
  it('returns all nodes when no iterations', () => {
    const dag = {
      nodes: [
        { id: 'n1', status: 'completed' },
        { id: 'n2', status: 'pending' },
        { id: 'n3', status: 'running' },
      ],
    };
    // New semantic: reads goalGapIds from iterations, not dag.nodes[].status
    // Without iterations, all nodes are unresolved → returns all IDs
    const gaps = computeGoalGapIds(dag, []);
    assert.deepStrictEqual(gaps.sort(), ['n1', 'n2', 'n3'].sort());
  });

  it('resolves nodes from prior iterations goalGapIds', () => {
    // New semantic: subtracts nodes that appear in any prior iteration's goalGapIds
    const dag = { nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }] };
    const iters = [{ goalGapIds: ['n1', 'n2'] }];
    const gaps = computeGoalGapIds(dag, iters);
    assert.deepStrictEqual(gaps, ['n3']);
  });

  it('accumulates resolved nodes across multiple iterations', () => {
    const dag = { nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }, { id: 'n4' }] };
    const iters = [
      { goalGapIds: ['n1', 'n2'] },
      { goalGapIds: ['n3'] },
    ];
    const gaps = computeGoalGapIds(dag, iters);
    assert.deepStrictEqual(gaps, ['n4']);
  });

  it('returns pending_deliverables when all nodes resolved but deliverables missing', () => {
    const dag = {
      nodes: [{ id: 'n1' }],
      expectedDeliverables: [{ id: 'd1', delivered: false }],
    };
    const iters = [{ goalGapIds: ['n1'] }];
    const gaps = computeGoalGapIds(dag, iters);
    assert.deepStrictEqual(gaps, ['pending_deliverables']);
  });

  it('empty gap when all nodes resolved and deliverables delivered', () => {
    const dag = {
      nodes: [{ id: 'n1' }],
      expectedDeliverables: [{ id: 'd1', delivered: true }],
    };
    const iters = [{ goalGapIds: ['n1'] }];
    assert.deepStrictEqual(computeGoalGapIds(dag, iters), []);
  });

  it('empty dag returns empty gaps', () => {
    assert.deepStrictEqual(computeGoalGapIds(null, []), []);
    assert.deepStrictEqual(computeGoalGapIds({}, []), []);
  });
});

// ---------------------------------------------------------------------------
// detection: no-progress
// ---------------------------------------------------------------------------

describe('CTRL-3 detectNoProgress', () => {
  it('no detection when threshold not reached', () => {
    const iters = [
      { goalGapIds: ['n1'] },
      { goalGapIds: ['n1'] },
    ];
    const r = detectNoProgress(['n1'], iters, 3);
    assert.strictEqual(r.detected, false);
    assert.strictEqual(r.cycleCount, 2);
  });

  it('detects at threshold', () => {
    const iters = [
      { goalGapIds: ['n1'] },
      { goalGapIds: ['n1'] },
      { goalGapIds: ['n1'] },
    ];
    const r = detectNoProgress(['n1'], iters, 3);
    assert.strictEqual(r.detected, true);
    assert.strictEqual(r.reason, REASON.NO_PROGRESS_CYCLE_DETECTED);
    assert.strictEqual(r.cycleCount, 3);
  });

  it('breaks on gap change', () => {
    const iters = [
      { goalGapIds: ['n1'] },
      { goalGapIds: ['n2'] }, // break
      { goalGapIds: ['n1'] },
    ];
    const r = detectNoProgress(['n1'], iters, 3);
    assert.strictEqual(r.detected, false);
  });

  it('no detection when gaps resolved', () => {
    const r = detectNoProgress([], [], 3);
    assert.strictEqual(r.detected, false);
  });

  it('respects custom threshold', () => {
    const iters = [{ goalGapIds: ['n1'] }, { goalGapIds: ['n1'] }];
    const r = detectNoProgress(['n1'], iters, 2);
    assert.strictEqual(r.detected, true);
  });
});

// ---------------------------------------------------------------------------
// detection: repeated-action
// ---------------------------------------------------------------------------

describe('CTRL-4 detectRepeatedAction', () => {
  it('no detection on first action', () => {
    const r = detectRepeatedAction('ak123', []);
    assert.strictEqual(r.detected, false);
  });

  it('detects same actionKey in previous iteration', () => {
    const iters = [
      {
        iterationId: 'i1',
        proposedAction: { actionKey: 'ak_repeat', actionType: 'run_tool' },
      },
    ];
    const r = detectRepeatedAction('ak_repeat', iters);
    assert.strictEqual(r.detected, true);
    assert.strictEqual(r.previousIterationId, 'i1');
  });

  it('no false positive on different actionKey', () => {
    const iters = [
      {
        iterationId: 'i1',
        proposedAction: { actionKey: 'ak_old', actionType: 'run_tool' },
      },
    ];
    const r = detectRepeatedAction('ak_new', iters);
    assert.strictEqual(r.detected, false);
  });

  it('skips iterations without proposedAction', () => {
    const iters = [
      { iterationId: 'i1' }, // no action
      {
        iterationId: 'i2',
        proposedAction: { actionKey: 'ak_target', actionType: 'plan' },
      },
    ];
    const r = detectRepeatedAction('ak_target', iters);
    assert.strictEqual(r.detected, true);
    assert.strictEqual(r.previousIterationId, 'i2');
  });
});

// ---------------------------------------------------------------------------
// detection: oscillation
// ---------------------------------------------------------------------------

describe('CTRL-5 detectOscillation', () => {
  it('no detection with fewer than 2 iterations', () => {
    const iters = [{ proposedAction: { actionType: 'plan', toolId: 'wf1' } }];
    assert.strictEqual(detectOscillation(iters, 'wf1').detected, false);
    assert.strictEqual(detectOscillation([], 'wf1').detected, false);
  });

  it('detects same plan toolId ping-pong', () => {
    const iters = [
      {
        proposedAction: { actionType: 'plan', toolId: 'deseq2', params: { toolId: 'deseq2' } },
      },
      {
        proposedAction: { actionType: 'plan', toolId: 'deseq2', params: { toolId: 'deseq2' } },
      },
    ];
    const r = detectOscillation(iters, 'deseq2');
    assert.strictEqual(r.detected, true);
    assert.strictEqual(r.reason, REASON.PLAN_OSCILLATION_DETECTED);
  });

  it('no false positive on different toolIds', () => {
    const iters = [
      { proposedAction: { actionType: 'plan', toolId: 'deseq2' } },
      { proposedAction: { actionType: 'plan', toolId: 'edger' } },
    ];
    assert.strictEqual(detectOscillation(iters, 'deseq2').detected, false);
  });
});

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

describe('CTRL-6 validateAction', () => {
  it('run_tool without toolId is invalid', () => {
    const r = validateAction({ actionType: 'run_tool' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reasonCode, REASON.INVALID_ARGUMENTS);
  });

  it('run_tool missing required inputs is invalid', () => {
    const dag = { nodes: [{ toolId: 'deseq2', requiredInputs: ['counts', 'metadata'] }] };
    const r = validateAction(
      { actionType: 'run_tool', toolId: 'deseq2', inputs: { counts: 'c.csv' } },
      { dag },
    );
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reasonCode, REASON.INPUT_FORMAT_MISMATCH);
  });

  it('run_tool with all required inputs is valid', () => {
    const dag = { nodes: [{ toolId: 'deseq2', requiredInputs: ['counts'] }] };
    const r = validateAction(
      { actionType: 'run_tool', toolId: 'deseq2', inputs: { counts: 'c.csv' } },
      { dag },
    );
    assert.strictEqual(r.ok, true);
  });

  it('run_tool when runtime not ready is invalid', () => {
    const r = validateAction(
      { actionType: 'run_tool', toolId: 'deseq2', inputs: { counts: 'c.csv' } },
      { runtimeReady: false },
    );
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reasonCode, REASON.TOOL_RUNTIME_NOT_READY);
  });

  it('wait_for_user is always valid', () => {
    const r = validateAction({ actionType: 'wait_for_user' });
    assert.strictEqual(r.ok, true);
  });

  it('cancel without reason is invalid', () => {
    const r = validateAction({ actionType: 'cancel' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reasonCode, REASON.INVALID_ARGUMENTS);
  });

  it('cancel with reason is valid', () => {
    const r = validateAction({ actionType: 'cancel', reason: 'user requested' });
    assert.strictEqual(r.ok, true);
  });
});

// ---------------------------------------------------------------------------
// decideNextAction
// ---------------------------------------------------------------------------

describe('CTRL-7 decideNextAction', () => {
  it('oscillation: returns block decision', () => {
    // Use goalGapIds='wf1' so buildProposedAction matches the plan toolId
    const ctx = {
      observedStateDigest: 'x',
      goalGapIds: ['wf1'],
      iterations: [
        { proposedAction: { actionType: 'plan', toolId: 'wf1', params: { toolId: 'wf1' } } },
        { proposedAction: { actionType: 'plan', toolId: 'wf1', params: { toolId: 'wf1' } } },
      ],
      loopRunStatus: 'running',
      dag: { nodes: [{ id: 'wf1', toolId: 'wf1', actionType: 'plan' }] },
    };
    const d = decideNextAction(ctx);
    assert.strictEqual(d.decision, 'block');
    assert.strictEqual(d.decisionReasonCode, REASON.PLAN_OSCILLATION_DETECTED);
    assert.strictEqual(d.proposedAction, null);
  });

  it('all gaps resolved: complete decision', () => {
    const ctx = {
      observedStateDigest: 'x',
      goalGapIds: [],
      iterations: [],
      loopRunStatus: 'running',
    };
    const d = decideNextAction(ctx);
    assert.strictEqual(d.decision, 'complete');
    assert.strictEqual(d.decisionReasonCode, REASON.ALL_NODES_VERIFIED);
  });

  it('no-progress at threshold: block decision', () => {
    const gap = { goalGapIds: ['n1'] };
    const ctx = {
      observedStateDigest: 'x',
      goalGapIds: ['n1'],
      iterations: [gap, gap, gap],
      loopRunStatus: 'running',
    };
    const d = decideNextAction(ctx);
    assert.strictEqual(d.decision, 'block');
    assert.strictEqual(d.decisionReasonCode, REASON.NO_PROGRESS_CYCLE_DETECTED);
  });

  it('userConfirmationRequired: wait_for_user decision', () => {
    const ctx = {
      observedStateDigest: 'x',
      goalGapIds: ['n1'],
      iterations: [],
      loopRunStatus: 'running',
      userConfirmationRequired: true,
    };
    const d = decideNextAction(ctx);
    assert.strictEqual(d.decision, 'wait');
    assert.ok(d.proposedAction && d.proposedAction.actionType === 'wait_for_user');
  });

  it('active jobs: continue decision without proposing action', () => {
    const ctx = {
      observedStateDigest: 'x',
      goalGapIds: ['n1'],
      iterations: [],
      loopRunStatus: 'running',
      activeJobs: [{ id: 'j1', status: 'running' }],
    };
    const d = decideNextAction(ctx);
    assert.strictEqual(d.decision, 'continue');
    assert.strictEqual(d.proposedAction, null);
  });

  it('next gap: proposes action', () => {
    const ctx = {
      observedStateDigest: 'x',
      goalGapIds: ['n1'],
      iterations: [],
      loopRunStatus: 'running',
      dag: { nodes: [{ id: 'n1', toolId: 'deseq2', requiredInputs: [] }] },
      runtimeReady: true,
    };
    const d = decideNextAction(ctx);
    assert.strictEqual(d.decision, 'continue');
    assert.ok(d.proposedAction);
    assert.strictEqual(d.proposedAction.actionType, 'run_tool');
    assert.strictEqual(d.proposedAction.toolId, 'deseq2');
    assert.ok(d.proposedAction.actionKey);
  });

  it('repeated actionKey: block decision', () => {
    // Use same gap and toolId so actionKey generation matches
    const gapId = 'n1';
    const toolId = 'deseq2';
    const actionKey = ctrl.buildProposedAction(gapId, { nodes: [{ id: gapId, toolId }] }, []).actionKey;
    const iters = [
      {
        proposedAction: {
          actionKey,
          actionType: 'run_tool',
          toolId,
          inputs: { counts: 'c.csv' },
        },
      },
    ];
    const ctx = {
      observedStateDigest: 'x',
      goalGapIds: [gapId],
      iterations: iters,
      loopRunStatus: 'running',
      dag: { nodes: [{ id: gapId, toolId, requiredInputs: [] }] },
      runtimeReady: true,
    };
    const d = decideNextAction(ctx);
    assert.strictEqual(d.decision, 'block');
    assert.strictEqual(d.decisionReasonCode, REASON.TRANSIENT_RUNTIME_RETRY);
    assert.strictEqual(d.proposedAction, null);
  });
});

// ---------------------------------------------------------------------------
// buildControllerIteration
// ---------------------------------------------------------------------------

describe('CTRL-8 buildControllerIteration', () => {
  it('produces a valid iteration record', () => {
    const ctx = {
      loopRunId: 'loop_x',
      sequence: 1,
      observedStateDigest: 'x',
      goalGapIds: ['n1'],
      iterations: [],
      loopRunStatus: 'running',
      dag: { nodes: [{ id: 'n1', toolId: 'deseq2', requiredInputs: [] }] },
      runtimeReady: true,
    };
    const it = buildControllerIteration(ctx);
    assert.ok(it.iterationId);
    assert.strictEqual(it.loopRunId, 'loop_x');
    assert.strictEqual(it.sequence, 1);
    assert.ok(it.hash);
    assert.strictEqual(it.hash.length, 64);
    assert.ok(it.proposedAction);
    assert.strictEqual(it.decision, 'continue');
  });

  it('same ctx produces same hash across calls', () => {
    const base = {
      loopRunId: 'loop_x',
      sequence: 1,
      observedStateDigest: 'x',
      goalGapIds: ['n1'],
      iterations: [],
      loopRunStatus: 'running',
      dag: { nodes: [{ id: 'n1', toolId: 'deseq2', requiredInputs: [] }] },
      runtimeReady: true,
    };
    const a = buildControllerIteration(base);
    const b = buildControllerIteration(base);
    assert.strictEqual(a.hash, b.hash);
    assert.notStrictEqual(a.iterationId, b.iterationId);
  });
});

// ---------------------------------------------------------------------------
// evaluateExit
// ---------------------------------------------------------------------------

describe('CTRL-9 evaluateExit', () => {
  it('complete decision exits', () => {
    const r = evaluateExit({ decision: 'complete', goalGapIds: [], iterations: [] });
    assert.strictEqual(r.shouldExit, true);
    assert.strictEqual(r.loopStatus, 'completed');
  });

  it('cancel decision exits', () => {
    const r = evaluateExit({ decision: 'cancel', loopRunStatus: 'running' });
    assert.strictEqual(r.shouldExit, true);
    assert.strictEqual(r.loopStatus, 'cancelled');
  });

  it('already-terminal loop exits immediately', () => {
    const r = evaluateExit({ decision: 'continue', loopRunStatus: 'completed' });
    assert.strictEqual(r.shouldExit, true);
    assert.strictEqual(r.loopStatus, 'completed');
  });

  it('no-progress block exits as blocked', () => {
    const iters = [
      { goalGapIds: ['n1'] },
      { goalGapIds: ['n1'] },
      { goalGapIds: ['n1'] },
    ];
    const r = evaluateExit({
      decision: 'block',
      goalGapIds: ['n1'],
      iterations: iters,
      loopRunStatus: 'running',
    });
    assert.strictEqual(r.shouldExit, true);
    assert.strictEqual(r.loopStatus, 'blocked');
  });

  it('oscillation block exits as blocked', () => {
    // iterations need plan toolId same as goalGapIds
    const r = evaluateExit({
      decision: 'block',
      goalGapIds: ['wf1'],
      iterations: [
        { proposedAction: { actionType: 'plan', toolId: 'wf1', params: { toolId: 'wf1' } } },
        { proposedAction: { actionType: 'plan', toolId: 'wf1', params: { toolId: 'wf1' } } },
      ],
      loopRunStatus: 'running',
    });
    assert.strictEqual(r.shouldExit, true);
    assert.strictEqual(r.loopStatus, 'blocked');
  });

  it('other block decision keeps loop alive', () => {
    const r = evaluateExit({
      decision: 'block',
      goalGapIds: ['n1'],
      iterations: [],
      loopRunStatus: 'running',
    });
    assert.strictEqual(r.shouldExit, false);
    assert.strictEqual(r.loopStatus, 'running');
  });

  it('continue decision keeps loop alive', () => {
    const r = evaluateExit({ decision: 'continue', loopRunStatus: 'running' });
    assert.strictEqual(r.shouldExit, false);
    assert.strictEqual(r.loopStatus, 'running');
  });
});

// ---------------------------------------------------------------------------
// reconcileJobResult
// ---------------------------------------------------------------------------

describe('CTRL-10 reconcileJobResult', () => {
  it('produces a new digest incorporating job summary', () => {
    const old = 'a'.repeat(64);
    const job = { id: 'j1', status: 'completed', finished_at: '2026-01-01T00:00:00Z' };
    const newD = reconcileJobResult(old, job);
    assert.strictEqual(typeof newD, 'string');
    assert.strictEqual(newD.length, 64);
    assert.notStrictEqual(newD, old);
  });

  it('null job returns old digest', () => {
    const old = 'b'.repeat(64);
    assert.strictEqual(reconcileJobResult(old, null), old);
  });
});

// ---------------------------------------------------------------------------
// toStructuredDecision
// ---------------------------------------------------------------------------

describe('CTRL-11 toStructuredDecision', () => {
  it('removes raw inputs/params from proposedAction', () => {
    const it = buildControllerIteration({
      loopRunId: 'l1',
      sequence: 1,
      observedStateDigest: 'x',
      goalGapIds: ['n1'],
      iterations: [],
      loopRunStatus: 'running',
      dag: { nodes: [{ id: 'n1', toolId: 'deseq2', requiredInputs: [] }] },
    });
    const sd = toStructuredDecision(it);
    assert.ok(sd);
    assert.strictEqual(sd.proposedAction.inputs, undefined);
    assert.strictEqual(sd.proposedAction.params, undefined);
    assert.strictEqual(sd.proposedAction.actionKey, undefined);
    assert.strictEqual(sd.proposedAction.toolId, 'deseq2');
  });

  it('redacts sensitive text in publicConclusion', () => {
    const it = buildControllerIteration({
      loopRunId: 'l1',
      sequence: 1,
      observedStateDigest: 'x',
      goalGapIds: [],
      iterations: [],
      loopRunStatus: 'running',
    });
    // Inject sensitive text
    it.publicConclusion = 'token sk-abcdefghijklmnopqrstuvwxyz1234';
    const sd = toStructuredDecision(it);
    assert.ok(!sd.publicConclusion.includes('sk-abcdefghijklmnopqrstuvwxyz1234'));
  });

  it('null iteration returns null', () => {
    assert.strictEqual(toStructuredDecision(null), null);
  });
});

// ---------------------------------------------------------------------------
// module purity: no db/fs/network
// ---------------------------------------------------------------------------

describe('CTRL-12 no I/O dependencies', () => {
  it('loop-controller has no better-sqlite3, express, or fetch', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const src = fs.readFileSync(
      path.join(repoRoot, 'core/shared-backend/loop-controller.js'),
      'utf8',
    );
    assert.ok(!/require\(['"]better-sqlite3\1\)/.test(src));
    assert.ok(!/require\(['"]express\1\)/.test(src));
    assert.ok(!/\bfetch\(/.test(src));
    assert.ok(!/\bfs\.writeFileSync\b/.test(src));
  });
});