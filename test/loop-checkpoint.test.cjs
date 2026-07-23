#!/usr/bin/env node

/**
 * Loop Checkpoint / ContextEnvelope / Budget / SessionStageView — unit tests (CJS).
 * Run via: node --test test/loop-checkpoint.test.cjs
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  CHECKPOINT_VERSION,
  ENVELOPE_VERSION,
  buildIterationCheckpoint,
  deriveCheckpointId,
  buildLoopContextEnvelope,
  buildEmptyEnvelope,
  computeUnresolvedGaps,
  computeNextCandidateActions,
  collectFailureHistory,
  projectBudget,
  buildSessionStageView,
  buildExpandedSessionStageView,
  buildDefaultStageView,
  mergeCostSnapshot,
  DEFAULT_BUDGET_LIMITS,
} = require('../core/shared-backend/loop-checkpoint');

const { buildIteration } = require('../core/shared-backend/loop-contract');

// ---------------------------------------------------------------------------
// CHECKPOINT-1: buildIterationCheckpoint
// ---------------------------------------------------------------------------

describe('CHECKPOINT-1 buildIterationCheckpoint', () => {
  it('creates frozen checkpoint with correct schema version', () => {
    const cp = buildIterationCheckpoint({
      loopRunId: 'lr_test',
      loopRunHash: 'abc123',
      sequence: 1,
      observedStateDigest: 'digest1',
      goalGapIds: ['gap1'],
      decision: 'continue',
      decisionReasonCode: 'TOOL_SUCCEEDED',
      publicConclusion: 'Task completed.',
      status: 'succeeded',
    });
    assert.strictEqual(cp.schemaVersion, CHECKPOINT_VERSION);
    assert.ok(Object.isFrozen(cp));
    assert.ok(Object.isFrozen(cp.goalGapIds));
  });

  it('derives stable checkpoint ID', () => {
    const id1 = deriveCheckpointId({ loopRunId: 'lr_1', loopRunHash: 'h1', sequence: 1 });
    const id2 = deriveCheckpointId({ loopRunId: 'lr_1', loopRunHash: 'h1', sequence: 1 });
    const id3 = deriveCheckpointId({ loopRunId: 'lr_1', loopRunHash: 'h1', sequence: 2 });
    assert.strictEqual(id1, id2);
    assert.notStrictEqual(id1, id3);
    assert.ok(id1.startsWith('cp_'));
  });

  it('sanitizes validator results', () => {
    const cp = buildIterationCheckpoint({
      loopRunId: 'lr_1',
      loopRunHash: 'h1',
      sequence: 1,
      goalGapIds: [],
      decision: 'complete',
      decisionReasonCode: 'ALL_NODES_VERIFIED',
      publicConclusion: 'Done.',
      status: 'succeeded',
      validatorResults: [{
        validatorId: 'input-snapshot',
        status: 'blocked',
        version: '1.0.0',
        findings: [{ code: 'INPUT_FILE_EMPTY', message: 'File is empty', severity: 'error' }],
        detail: 'A'.repeat(300), // long → will be truncated to 200 chars
      }],
    });
    assert.strictEqual(cp.validatorResults[0].validatorId, 'input-snapshot');
    assert.strictEqual(cp.validatorResults[0].status, 'blocked');
    // long detail gets truncated to 200 chars
    assert.ok(cp.validatorResults[0].detail.endsWith('…'));
    assert.ok(cp.validatorResults[0].detail.length < 300);
  });

  it('includes cost snapshot when provided', () => {
    const cp = buildIterationCheckpoint({
      loopRunId: 'lr_1',
      loopRunHash: 'h1',
      sequence: 1,
      goalGapIds: [],
      decision: 'continue',
      decisionReasonCode: 'TOOL_SUCCEEDED',
      publicConclusion: 'Running.',
      status: 'succeeded',
      costSnapshot: { inputTokens: 1000, outputTokens: 500, costUsd: 0.05 },
    });
    assert.strictEqual(cp.costSnapshot.inputTokens, 1000);
    assert.ok(Object.isFrozen(cp.costSnapshot));
  });

  it('null cost snapshot omitted', () => {
    const cp = buildIterationCheckpoint({
      loopRunId: 'lr_1',
      loopRunHash: 'h1',
      sequence: 1,
      goalGapIds: [],
      decision: 'continue',
      decisionReasonCode: 'TOOL_SUCCEEDED',
      publicConclusion: 'Running.',
      status: 'succeeded',
    });
    assert.strictEqual(cp.costSnapshot, null);
  });
});

// ---------------------------------------------------------------------------
// CHECKPOINT-2: buildLoopContextEnvelope
// ---------------------------------------------------------------------------

describe('CHECKPOINT-2 buildLoopContextEnvelope', () => {
  it('empty checkpoints → planned status in currentStatus', () => {
    const env0 = buildLoopContextEnvelope({ loopRunId: 'lr_1' });
    assert.strictEqual(env0.schemaVersion, ENVELOPE_VERSION);
    assert.ok(env0.envelopeId.startsWith('env_'));
    assert.strictEqual(env0.loopState.currentStatus, 'planned');
    assert.deepStrictEqual(env0.unresolvedGaps, []);
    assert.deepStrictEqual(env0.nextActions, []);
    assert.deepStrictEqual(env0.failureHistory, []);
    assert.strictEqual(env0.recoveryHint.action, 'wait_for_first_iteration');
  });

  it('single checkpoint → correct state', () => {
    const cp = buildIterationCheckpoint({
      loopRunId: 'lr_1', loopRunHash: 'h1', sequence: 1,
      goalGapIds: ['gap1', 'gap2'], decision: 'continue',
      decisionReasonCode: 'TOOL_SUCCEEDED', publicConclusion: 'Step 1.', status: 'succeeded',
    });
    const env = buildLoopContextEnvelope({ loopRunId: 'lr_1', checkpoints: [cp] });
    assert.strictEqual(env.loopState.currentSequence, 1);
    assert.strictEqual(env.loopState.currentDecision, 'continue');
    assert.strictEqual(env.unresolvedGaps.length, 2);
    assert.ok(env.nextActions.length >= 1);
  });

  it('complete decision resolves gaps', () => {
    const cp1 = buildIterationCheckpoint({
      loopRunId: 'lr_1', loopRunHash: 'h1', sequence: 1,
      goalGapIds: ['gap1'], decision: 'continue',
      decisionReasonCode: 'TOOL_SUCCEEDED', publicConclusion: 'Step 1.', status: 'succeeded',
    });
    const cp2 = buildIterationCheckpoint({
      loopRunId: 'lr_1', loopRunHash: 'h1', sequence: 2,
      goalGapIds: [], decision: 'complete',
      decisionReasonCode: 'ALL_NODES_VERIFIED', publicConclusion: 'Done.', status: 'succeeded',
    });
    const env = buildLoopContextEnvelope({ loopRunId: 'lr_1', checkpoints: [cp1, cp2] });
    assert.deepStrictEqual(env.unresolvedGaps, []);
    assert.strictEqual(env.nextActions[0].action, 'none');
  });

  it('block decision on unresolved gap shows wait', () => {
    const cp = buildIterationCheckpoint({
      loopRunId: 'lr_1', loopRunHash: 'h1', sequence: 3,
      goalGapIds: ['gap1', 'gap2'], decision: 'block',
      decisionReasonCode: 'NO_PROGRESS_CYCLE_DETECTED', publicConclusion: 'No progress.', status: 'blocked',
    });
    const env = buildLoopContextEnvelope({ loopRunId: 'lr_1', checkpoints: [cp] });
    assert.deepStrictEqual(env.unresolvedGaps, ['gap1', 'gap2']);
    assert.strictEqual(env.nextActions[0].action, 'wait');
    assert.strictEqual(env.recoveryHint.action, 'wait_for_user');
  });

  it('retry decision triggers repair hint', () => {
    const cp = buildIterationCheckpoint({
      loopRunId: 'lr_1', loopRunHash: 'h1', sequence: 3,
      goalGapIds: ['gap1'], decision: 'retry',
      decisionReasonCode: 'TRANSIENT_RUNTIME_RETRY', publicConclusion: 'Retrying.', status: 'failed',
      repairAttempt: {
        strategyId: 'retry_with_reconcile',
        strategyVersion: '1.0.0',
        safetyLevel: 'safe',
        costMultiplier: 1.0,
        isActionable: true,
        requiresUserAuth: false,
        publicMessage: 'Re-running after reconciliation.',
        parentLineage: { parentJobId: 'job_123' },
        replacementJobId: 'job_124',
        repaired: true,
        invalidatedArtifactIds: [],
        preservedArtifactIds: [],
      },
    });
    const env = buildLoopContextEnvelope({ loopRunId: 'lr_1', checkpoints: [cp] });
    assert.strictEqual(env.recoveryHint.action, 'auto_repair');
    assert.strictEqual(env.recoveryHint.strategyId, 'retry_with_reconcile');
    assert.strictEqual(cp.repairAttempt.parentLineage.parentJobId, 'job_123');
    assert.strictEqual(cp.repairAttempt.replacementJobId, 'job_124');
    assert.strictEqual(cp.repairAttempt.repaired, true);
  });

  it('failure history collected', () => {
    const cp1 = buildIterationCheckpoint({
      loopRunId: 'lr_1', loopRunHash: 'h1', sequence: 1,
      goalGapIds: ['gap1'], decision: 'block',
      decisionReasonCode: 'ARTIFACT_VALIDATION_FAILED', publicConclusion: 'Validation failed.', status: 'blocked',
    });
    const cp2 = buildIterationCheckpoint({
      loopRunId: 'lr_1', loopRunHash: 'h1', sequence: 2,
      goalGapIds: ['gap1'], decision: 'retry',
      decisionReasonCode: 'TRANSIENT_RUNTIME_RETRY', publicConclusion: 'Retrying.', status: 'failed',
    });
    const env = buildLoopContextEnvelope({ loopRunId: 'lr_1', checkpoints: [cp1, cp2] });
    assert.strictEqual(env.failureHistory.length, 2);
    assert.strictEqual(env.failureHistory[0].decision, 'block');
    assert.strictEqual(env.failureHistory[1].decision, 'retry');
  });
});

// ---------------------------------------------------------------------------
// CHECKPOINT-3: projectBudget
// ---------------------------------------------------------------------------

describe('CHECKPOINT-3 projectBudget', () => {
  it('empty snapshots → null', () => {
    const proj = projectBudget([]);
    assert.strictEqual(proj, null);
  });

  it('ok status when under limits', () => {
    const snapshots = [
      { inputTokens: 100, outputTokens: 50, costUsd: 0.01, elapsedMs: 1000, iterationCount: 1 },
    ];
    const proj = projectBudget(snapshots, { maxCostUsd: 10 });
    assert.strictEqual(proj.status, 'ok');
    assert.strictEqual(proj.advice.action, 'continue');
  });

  it('warning status at 80% utilization', () => {
    // 80% of 10 = 8, so costUsd must be 8
    const snapshots = [
      { inputTokens: 8000, outputTokens: 4000, costUsd: 8, elapsedMs: 80000, iterationCount: 1 },
    ];
    const proj = projectBudget(snapshots, { maxCostUsd: 10 });
    assert.strictEqual(proj.status, 'warning');
    assert.strictEqual(proj.advice.action, 'warn');
    assert.strictEqual(proj.exhaustedResource, 'costUsd');
    assert.strictEqual(proj.usagePct, 80);
  });

  it('exceeded status when over limit', () => {
    const snapshots = [
      { inputTokens: 10000, outputTokens: 5000, costUsd: 5, elapsedMs: 50000, iterationCount: 1 },
    ];
    const proj = projectBudget(snapshots, { maxCostUsd: 1, whenExceed: 'pause' });
    assert.strictEqual(proj.status, 'exceeded');
    assert.strictEqual(proj.advice.action, 'pause');
    assert.strictEqual(proj.exhaustedResource, 'costUsd');
    assert.strictEqual(proj.usagePct, 100);
  });

  it('exhaustedResource is first exceeded resource', () => {
    const snapshots = [
      { inputTokens: 10000, outputTokens: 10000, costUsd: 100, elapsedMs: 100000, iterationCount: 1 },
    ];
    const proj = projectBudget(snapshots, { maxCostUsd: 10, maxInputTokens: 5 });
    assert.strictEqual(proj.status, 'exceeded');
    assert.strictEqual(proj.exhaustedResource, 'inputTokens');
  });

  it('null limits → ok with null usagePct', () => {
    const snapshots = [
      { inputTokens: 1000, outputTokens: 500, costUsd: 0.5, elapsedMs: 5000, iterationCount: 1 },
    ];
    const proj = projectBudget(snapshots, { maxCostUsd: null, maxIterations: null });
    assert.strictEqual(proj.status, 'ok');
    assert.strictEqual(proj.usagePct, null);
  });

  it('require_user when whenExceed is require_user', () => {
    const snapshots = [
      { inputTokens: 100, outputTokens: 50, costUsd: 100, elapsedMs: 1000, iterationCount: 1 },
    ];
    const proj = projectBudget(snapshots, { maxCostUsd: 1, whenExceed: 'require_user' });
    assert.strictEqual(proj.status, 'exceeded');
    assert.strictEqual(proj.advice.action, 'require_user');
  });
});

// ---------------------------------------------------------------------------
// CHECKPOINT-4: buildSessionStageView (compact)
// ---------------------------------------------------------------------------

describe('CHECKPOINT-4 buildSessionStageView', () => {
  it('default view for null inputs', () => {
    const view = buildSessionStageView({});
    assert.strictEqual(view.viewType, 'compact');
    assert.strictEqual(view.stage.label, '初始化');
    assert.strictEqual(view.budgetStatus, 'ok');
    assert.strictEqual(view.unresolvedCount, 0);
  });

  it('shows stage label from decision', () => {
    const cp = buildIterationCheckpoint({
      loopRunId: 'lr_1', loopRunHash: 'h1', sequence: 5,
      goalGapIds: ['gap1'], decision: 'retry',
      decisionReasonCode: 'TRANSIENT_RUNTIME_RETRY', publicConclusion: 'Retrying.', status: 'failed',
    });
    const view = buildSessionStageView({ loopRun: null, latestCheckpoint: cp });
    assert.strictEqual(view.stage.label, '自动修复');
    assert.strictEqual(view.stage.icon, 'refresh');
    assert.strictEqual(view.stage.sequence, '5次迭代');
  });

  it('shows completed stage', () => {
    const cp = buildIterationCheckpoint({
      loopRunId: 'lr_1', loopRunHash: 'h1', sequence: 10,
      goalGapIds: [], decision: 'complete',
      decisionReasonCode: 'ALL_NODES_VERIFIED', publicConclusion: 'Done!', status: 'succeeded',
    });
    const view = buildSessionStageView({ loopRun: null, latestCheckpoint: cp });
    assert.strictEqual(view.stage.label, '已完成');
    assert.strictEqual(view.stage.icon, 'check_circle');
    assert.strictEqual(view.stage.status, 'completed');
  });

  it('shows budget exceeded in nextHint (uses budget advice action)', () => {
    const cp = buildIterationCheckpoint({
      loopRunId: 'lr_1', loopRunHash: 'h1', sequence: 3,
      goalGapIds: ['gap1'], decision: 'continue',
      decisionReasonCode: 'TOOL_SUCCEEDED', publicConclusion: 'Running.', status: 'succeeded',
    });
    const budgetProj = projectBudget([{ costUsd: 100, iterationCount: 1 }], { maxCostUsd: 1, whenExceed: 'pause' });
    const view = buildSessionStageView({ latestCheckpoint: cp, budgetProjection: budgetProj });
    assert.strictEqual(view.nextHint.action, 'pause');
    assert.ok(view.nextHint.message.includes('超限'));
  });

  it('truncates long conclusions', () => {
    const cp = buildIterationCheckpoint({
      loopRunId: 'lr_1', loopRunHash: 'h1', sequence: 1,
      goalGapIds: [], decision: 'continue',
      decisionReasonCode: 'TOOL_SUCCEEDED',
      publicConclusion: 'A'.repeat(200),
      status: 'succeeded',
    });
    const view = buildSessionStageView({ latestCheckpoint: cp });
    assert.ok(view.conclusion.length < 200);
    assert.ok(view.conclusion.endsWith('…'));
  });
});

// ---------------------------------------------------------------------------
// CHECKPOINT-5: buildExpandedSessionStageView
// ---------------------------------------------------------------------------

describe('CHECKPOINT-5 buildExpandedSessionStageView', () => {
  it('empty checkpoints → null loopState', () => {
    const view = buildExpandedSessionStageView({ loopRun: { loopRunId: 'lr_1' }, checkpoints: [] });
    assert.strictEqual(view.viewType, 'expanded');
    assert.strictEqual(view.loopState, null);
    assert.strictEqual(view.iterationCount, 0);
  });

  it('includes loopState from latest checkpoint', () => {
    const cp = buildIterationCheckpoint({
      loopRunId: 'lr_1', loopRunHash: 'h1', sequence: 3,
      goalGapIds: ['gap1', 'gap2'], decision: 'continue',
      decisionReasonCode: 'TOOL_SUCCEEDED', publicConclusion: 'Step 3.', status: 'succeeded',
    });
    const view = buildExpandedSessionStageView({ loopRun: { loopRunId: 'lr_1' }, checkpoints: [cp] });
    assert.strictEqual(view.loopState.sequence, 3);
    assert.strictEqual(view.loopState.goalGapIds.length, 2);
    assert.strictEqual(view.iterationCount, 1);
  });
});

// ---------------------------------------------------------------------------
// CHECKPOINT-6: mergeCostSnapshot
// ---------------------------------------------------------------------------

describe('CHECKPOINT-6 mergeCostSnapshot', () => {
  it('merges tokens cumulatively', () => {
    const acc = { inputTokens: 100, outputTokens: 50, costUsd: 0.01, iterationCount: 1 };
    const next = { inputTokens: 200, outputTokens: 100, costUsd: 0.02 };
    const merged = mergeCostSnapshot(acc, next);
    assert.strictEqual(merged.inputTokens, 300);
    assert.strictEqual(merged.outputTokens, 150);
    assert.strictEqual(merged.costUsd, 0.03);
    assert.strictEqual(merged.iterationCount, 2);
  });

  it('takes max of memory', () => {
    const acc = { memoryMbPeak: 512, iterationCount: 1 };
    const next = { memoryMbPeak: 1024 };
    const merged = mergeCostSnapshot(acc, next);
    assert.strictEqual(merged.memoryMbPeak, 1024);
  });

  it('handles null fields', () => {
    const merged = mergeCostSnapshot({ inputTokens: 100, iterationCount: 1 }, { outputTokens: 50 });
    assert.strictEqual(merged.inputTokens, 100);
    assert.strictEqual(merged.outputTokens, 50);
  });
});

// ---------------------------------------------------------------------------
// CHECKPOINT-7: computeUnresolvedGaps
// ---------------------------------------------------------------------------

describe('CHECKPOINT-7 computeUnresolvedGaps', () => {
  it('no checkpoints → empty', () => {
    assert.deepStrictEqual(computeUnresolvedGaps([]), []);
    assert.deepStrictEqual(computeUnresolvedGaps(null), []);
  });

  it('gaps resolved by complete decision', () => {
    const checkpoints = [
      { sequence: 1, decision: 'continue', goalGapIds: ['g1', 'g2'] },
      { sequence: 2, decision: 'complete', goalGapIds: [] },
    ];
    const unresolved = computeUnresolvedGaps(checkpoints);
    assert.deepStrictEqual(unresolved, []);
  });

  it('all gaps resolved when final checkpoint has decision=complete with empty goalGapIds', () => {
    const checkpoints = [
      { sequence: 1, decision: 'continue', goalGapIds: ['g1', 'g2'] },
      { sequence: 2, decision: 'complete', goalGapIds: [] },
    ];
    const unresolved = computeUnresolvedGaps(checkpoints);
    assert.deepStrictEqual(unresolved, []); // complete with [] = all done
  });

  it('partial resolution keeps remaining gaps', () => {
    // Only g2 was resolved in seq 2 (complete with goalGapIds=[g2])
    // g1 still in latest checkpoint → still unresolved
    const checkpoints = [
      { sequence: 1, decision: 'continue', goalGapIds: ['g1', 'g2'] },
      { sequence: 2, decision: 'continue', goalGapIds: ['g1'] },
    ];
    const unresolved = computeUnresolvedGaps(checkpoints);
    assert.deepStrictEqual(unresolved, ['g1']);
  });
});

// ---------------------------------------------------------------------------
// CHECKPOINT-8: computeNextCandidateActions
// ---------------------------------------------------------------------------

describe('CHECKPOINT-8 computeNextCandidateActions', () => {
  it('complete → none', () => {
    const actions = computeNextCandidateActions({ decision: 'complete', goalGapIds: [] }, []);
    assert.strictEqual(actions[0].action, 'none');
  });

  it('block → wait', () => {
    const actions = computeNextCandidateActions(
      { decision: 'block', publicConclusion: 'Blocked.', goalGapIds: ['g1'] },
      ['g1'],
    );
    assert.strictEqual(actions[0].action, 'wait');
  });

  it('retry with repair → repair action', () => {
    const actions = computeNextCandidateActions(
      { decision: 'retry', publicConclusion: 'Retrying.', goalGapIds: ['g1'], repairAttempt: { strategyId: 'retry_with_reconcile', publicMessage: 'Re-running.', parentLineage: { parentJobId: 'j1' } } },
      ['g1'],
    );
    assert.strictEqual(actions[0].action, 'repair');
    assert.strictEqual(actions[0].strategyId, 'retry_with_reconcile');
  });

  it('wait → wait action', () => {
    const actions = computeNextCandidateActions(
      { decision: 'wait', publicConclusion: 'Awaiting confirmation.', goalGapIds: [] },
      [],
    );
    assert.strictEqual(actions[0].action, 'wait');
  });
});

// ---------------------------------------------------------------------------
// CHECKPOINT-9: deterministic envelope ID
// ---------------------------------------------------------------------------

describe('CHECKPOINT-9 deterministic envelope ID', () => {
  it('same checkpoints → same envelope ID', () => {
    const cp = buildIterationCheckpoint({
      loopRunId: 'lr_dup', loopRunHash: 'h_dup', sequence: 1,
      goalGapIds: ['g1'], decision: 'continue',
      decisionReasonCode: 'TOOL_SUCCEEDED', publicConclusion: 'Step 1.', status: 'succeeded',
    });
    const env1 = buildLoopContextEnvelope({ loopRunId: 'lr_dup', checkpoints: [cp] });
    const env2 = buildLoopContextEnvelope({ loopRunId: 'lr_dup', checkpoints: [cp] });
    assert.strictEqual(env1.envelopeId, env2.envelopeId);
  });

  it('different sequence → different envelope ID', () => {
    const cp1 = buildIterationCheckpoint({
      loopRunId: 'lr_dup', loopRunHash: 'h_dup', sequence: 1,
      goalGapIds: [], decision: 'complete',
      decisionReasonCode: 'ALL_NODES_VERIFIED', publicConclusion: 'Done.', status: 'succeeded',
    });
    const cp2 = buildIterationCheckpoint({
      loopRunId: 'lr_dup', loopRunHash: 'h_dup', sequence: 2,
      goalGapIds: [], decision: 'complete',
      decisionReasonCode: 'ALL_NODES_VERIFIED', publicConclusion: 'Done.', status: 'succeeded',
    });
    const env1 = buildLoopContextEnvelope({ loopRunId: 'lr_dup', checkpoints: [cp1] });
    const env2 = buildLoopContextEnvelope({ loopRunId: 'lr_dup', checkpoints: [cp2] });
    assert.notStrictEqual(env1.envelopeId, env2.envelopeId);
  });
});
