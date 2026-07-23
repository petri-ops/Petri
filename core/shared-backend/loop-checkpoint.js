'use strict';

/**
 * Loop Checkpoint, ContextEnvelope, BudgetPolicy, and SessionStageView — HLE-5.
 *
 * Pure functions: no I/O, no DB, no network.
 *
 * HLE-5 scope:
 *  - IterationCheckpoint: durable snapshot of loop state at end of each iteration.
 *  - LoopContextEnvelope: model-switch-safe context reconstruction from checkpoints.
 *  - LoopBudgetPolicy: token/cost/time soft limits and projection.
 *  - SessionStageView: compact and expanded user-facing summaries.
 *
 * NOT in scope (handled by integration layer):
 *  - Actual persistence of checkpoints (calls db.saveContextCheckpoint)
 *  - Recovery orchestration (calls reconcile on startup)
 *  - Budget enforcement (called by agent-runner before each action)
 *  - UI rendering (returns serializable data, UI renders it)
 *
 * Design principles:
 *  - No raw inputs/params/trace enter the checkpoint
 *  - ContextEnvelope is deterministic given the same checkpoints
 *  - Budget projections are honest: unavailable metrics show as null
 *  - SessionStageView is safe to display; no secrets, no raw code
 */

const crypto = require('crypto');
const { REASON_CODES } = require('./loop-contract');

// ---------------------------------------------------------------------------
// IterationCheckpoint
// ---------------------------------------------------------------------------

const CHECKPOINT_VERSION = 1;

/**
 * Build a LoopIterationCheckpoint for persistence.
 * Called by integration layer at end of each iteration.
 *
 * @param {Object} ctx
 * @returns {Object} frozen IterationCheckpoint
 */
function buildIterationCheckpoint({
  loopRunId,
  loopRunHash,
  sequence,
  observedStateDigest,
  goalGapIds,
  decision,
  decisionReasonCode,
  publicConclusion,
  status,
  proposedActionHash,
  validatorResults = [],
  repairAttempt = null,
  toolJobId = null,
  artifactIds = [],
  costSnapshot = null,
}) {
  const checkpoint = {
    schemaVersion: CHECKPOINT_VERSION,
    checkpointId: deriveCheckpointId({ loopRunId, loopRunHash, sequence }),
    loopRunId,
    loopRunHash,
    sequence,
    observedStateDigest,
    goalGapIds: Object.freeze([...goalGapIds]),
    decision,
    decisionReasonCode,
    publicConclusion: redactPublicConclusion(publicConclusion),
    status,
    proposedActionHash: proposedActionHash || null,
    validatorResults: Object.freeze([...(validatorResults || [])].map(sanitizeValidatorResult)),
    repairAttempt: repairAttempt ? sanitizeRepairAttempt(repairAttempt) : null,
    toolJobId: toolJobId || null,
    artifactIds: Object.freeze([...(artifactIds || [])]),
    costSnapshot: costSnapshot ? Object.freeze({ ...costSnapshot }) : null,
    createdAt: new Date().toISOString(),
  };
  return Object.freeze(checkpoint);
}

/**
 * Derive a stable checkpoint ID from loop identity + sequence.
 */
function deriveCheckpointId({ loopRunId, loopRunHash, sequence }) {
  const input = `${loopRunId}:${loopRunHash}:${sequence}:checkpoint:v${CHECKPOINT_VERSION}`;
  return `cp_${crypto.createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// LoopContextEnvelope
// ---------------------------------------------------------------------------

const ENVELOPE_VERSION = 1;

/**
 * Build a LoopContextEnvelope from a sequence of checkpoints.
 * Used to reconstruct loop state after model switch or app restart.
 *
 * The envelope is deterministic: same checkpoints → same envelope.
 * It does NOT contain raw inputs/params/actionKeys.
 *
 * @param {Object} ctx
 * @returns {Object} frozen LoopContextEnvelope
 */
function buildLoopContextEnvelope({
  loopRunId,
  checkpoints = [],
  currentModelProfileId = null,
  currentModelProfileLabel = null,
}) {
  if (!checkpoints || checkpoints.length === 0) {
    return buildEmptyEnvelope({ loopRunId, currentModelProfileId, currentModelProfileLabel });
  }

  // Latest checkpoint = current state
  const latest = checkpoints[checkpoints.length - 1];
  // Prior checkpoint = previous state for comparison
  const prior = checkpoints.length >= 2 ? checkpoints[checkpoints.length - 2] : null;

  // Compute unresolved gap from latest checkpoint
  const unresolvedGaps = computeUnresolvedGaps(checkpoints);

  // Compute next candidate actions from latest decision
  const nextActions = computeNextCandidateActions(latest, unresolvedGaps);

  // Failure/repair history from all checkpoints
  const failureHistory = collectFailureHistory(checkpoints);

  // Budget projection from all cost snapshots
  const budgetProjection = projectBudget(checkpoints);

  const envelope = {
    schemaVersion: ENVELOPE_VERSION,
    envelopeId: deriveEnvelopeId({ loopRunId, checkpoints }),
    loopRunId,
    version: ENVELOPE_VERSION,
    createdAt: new Date().toISOString(),
    loopState: Object.freeze({
      loopRunHash: latest.loopRunHash,
      currentSequence: latest.sequence,
      currentDigest: latest.observedStateDigest,
      currentDecision: latest.decision,
      currentDecisionReasonCode: latest.decisionReasonCode,
      currentStatus: latest.status,
      publicConclusion: latest.publicConclusion,
      goalGapIds: latest.goalGapIds,
    }),
    unresolvedGaps,
    nextActions,
    failureHistory,
    budgetProjection,
    modelContext: Object.freeze({
      currentModelProfileId: currentModelProfileId || null,
      currentModelProfileLabel: currentModelProfileLabel || null,
      windowCheckpointCount: checkpoints.length,
      // Original source range is NOT included here; it lives in ConversationContextEnvelope
    }),
    recoveryHint: buildRecoveryHint(latest, unresolvedGaps, nextActions),
  };

  return Object.freeze(envelope);
}

/**
 * Build an empty envelope for a loop with no checkpoints yet.
 */
function buildEmptyEnvelope({ loopRunId, currentModelProfileId, currentModelProfileLabel }) {
  return Object.freeze({
    schemaVersion: ENVELOPE_VERSION,
    envelopeId: `env_empty_${loopRunId.slice(0, 16)}`,
    loopRunId,
    version: ENVELOPE_VERSION,
    createdAt: new Date().toISOString(),
    loopState: Object.freeze({
      loopRunHash: null,
      currentSequence: 0,
      currentDigest: null,
      currentDecision: null,
      currentDecisionReasonCode: null,
      currentStatus: 'planned',
      publicConclusion: null,
      goalGapIds: [],
    }),
    unresolvedGaps: [],
    nextActions: [],
    failureHistory: [],
    budgetProjection: null,
    modelContext: Object.freeze({
      currentModelProfileId: currentModelProfileId || null,
      currentModelProfileLabel: currentModelProfileLabel || null,
      windowCheckpointCount: 0,
    }),
    recoveryHint: Object.freeze({
      action: 'wait_for_first_iteration',
      message: 'Loop 已初始化，等待首次迭代。',
    }),
  });
}

/**
 * Compute unresolved gaps from checkpoint history.
 * A gap is unresolved if it appeared in a checkpoint but was never
 * followed by a 'complete' decision.
 */
function computeUnresolvedGaps(checkpoints) {
  if (!checkpoints || checkpoints.length === 0) return [];

  const resolved = new Set();
  const unresolved = [];

  for (const cp of checkpoints) {
    if (cp.decision === 'complete' && Array.isArray(cp.goalGapIds)) {
      cp.goalGapIds.forEach((g) => resolved.add(g));
    }
  }

  const latest = checkpoints[checkpoints.length - 1];
  if (Array.isArray(latest.goalGapIds)) {
    for (const g of latest.goalGapIds) {
      if (!resolved.has(g)) unresolved.push(g);
    }
  }

  return unresolved;
}

/**
 * Compute next candidate actions from latest checkpoint.
 */
function computeNextCandidateActions(latest, unresolvedGaps) {
  if (!latest) return [];

  const { decision, decisionReasonCode, repairAttempt } = latest;

  if (decision === 'complete') {
    return [{ action: 'none', message: 'Loop 已完成。' }];
  }
  if (decision === 'cancel') {
    return [{ action: 'none', message: 'Loop 已取消。' }];
  }
  if (decision === 'block') {
    if (unresolvedGaps.length > 0) {
      return [{
        action: 'wait',
        message: latest.publicConclusion || '任务被阻断，等待人工介入。',
        reasonCode: decisionReasonCode,
      }];
    }
    return [{ action: 'wait', message: '任务被阻断。', reasonCode: decisionReasonCode }];
  }
  if (decision === 'wait') {
    return [{ action: 'wait', message: latest.publicConclusion || '等待用户确认。', reasonCode: decisionReasonCode }];
  }
  if (decision === 'continue') {
    return [{ action: 'wait', message: latest.publicConclusion || '任务执行中。' }];
  }
  if (decision === 'retry') {
    if (repairAttempt) {
      return [{
        action: 'repair',
        strategyId: repairAttempt.strategyId || null,
        message: repairAttempt.publicMessage || '自动修复中。',
        reasonCode: decisionReasonCode,
        parentJobId: repairAttempt.parentLineage?.parentJobId || null,
      }];
    }
    return [{ action: 'retry', message: '重试中。', reasonCode: decisionReasonCode }];
  }
  // Default: propose action for first unresolved gap
  if (unresolvedGaps.length > 0) {
    return [{
      action: 'propose',
      gapIds: unresolvedGaps,
      message: latest.publicConclusion || '继续推进目标。',
      reasonCode: decisionReasonCode,
    }];
  }
  return [{ action: 'unknown', message: latest.publicConclusion || '状态未知。' }];
}

/**
 * Collect failure and repair history from checkpoints.
 */
function collectFailureHistory(checkpoints) {
  if (!checkpoints || checkpoints.length === 0) return [];

  const history = [];
  for (const cp of checkpoints) {
    if (cp.decision === 'block' || cp.decision === 'retry') {
      history.push({
        sequence: cp.sequence,
        decision: cp.decision,
        reasonCode: cp.decisionReasonCode,
        publicConclusion: cp.publicConclusion,
        repairAttempt: cp.repairAttempt
          ? { strategyId: cp.repairAttempt.strategyId, parentJobId: cp.repairAttempt.parentLineage?.parentJobId }
          : null,
        validatorResults: cp.validatorResults
          ? cp.validatorResults.map((r) => ({ validatorId: r.validatorId, status: r.status }))
          : [],
      });
    }
  }
  return Object.freeze(history);
}

/**
 * Derive envelope ID deterministically.
 */
function deriveEnvelopeId({ loopRunId, checkpoints }) {
  if (!checkpoints || checkpoints.length === 0) {
    return `env_${loopRunId.slice(0, 16)}_empty`;
  }
  const latest = checkpoints[checkpoints.length - 1];
  const input = `${loopRunId}:${latest.loopRunHash}:${latest.sequence}:v${ENVELOPE_VERSION}`;
  return `env_${crypto.createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16)}`;
}

/**
 * Build a recovery hint for the integration layer.
 */
function buildRecoveryHint(latest, unresolvedGaps, nextActions) {
  if (!latest) {
    return Object.freeze({ action: 'wait', message: '无检查点历史。' });
  }
  if (latest.decision === 'complete') {
    return Object.freeze({ action: 'none', message: 'Loop 已完成，无需恢复。' });
  }
  if (latest.decision === 'block') {
    if (unresolvedGaps.length === 0) {
      return Object.freeze({ action: 'recovery_required', message: '状态未知，需人工确认。' });
    }
    return Object.freeze({
      action: 'wait_for_user',
      message: latest.publicConclusion || '阻断中，等待用户。',
      unresolvedGaps,
    });
  }
  if (latest.decision === 'retry' && nextActions.length > 0 && nextActions[0].action === 'repair') {
    return Object.freeze({
      action: 'auto_repair',
      strategyId: nextActions[0].strategyId,
      message: nextActions[0].message,
      parentJobId: nextActions[0].parentJobId || null,
    });
  }
  if (latest.decision === 'wait') {
    return Object.freeze({ action: 'wait_for_user', message: latest.publicConclusion || '等待用户。' });
  }
  return Object.freeze({ action: 'resume', message: '可继续推进目标。' });
}

// ---------------------------------------------------------------------------
// LoopBudgetPolicy
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} BudgetSnapshot
 * @property {number|null} inputTokens   - total input tokens used so far
 * @property {number|null} outputTokens - total output tokens used so far
 * @property {number|null} costUsd       - estimated cost in USD
 * @property {number|null} elapsedMs     - wall-clock elapsed milliseconds
 * @property {number|null} cpuMs         - CPU milliseconds (if available)
 * @property {number|null} memoryMbPeak  - peak memory MB (if available)
 * @property {number|null} diskMbUsed    - disk usage MB
 * @property {number}      iterationCount - number of iterations
 */

/**
 * @typedef {Object} BudgetLimits
 * @property {number|null} maxInputTokens
 * @property {number|null} maxOutputTokens
 * @property {number|null} maxCostUsd
 * @property {number|null} maxElapsedMs
 * @property {number|null} maxIterations
 * @property {string}      whenExceed  - 'continue' | 'warn' | 'pause' | 'require_user'
 */

/**
 * @typedef {Object} BudgetProjection
 * @property {BudgetSnapshot} current
 * @property {BudgetLimits}   limits
 * @property {string}          status     - 'ok' | 'warning' | 'exceeded' | 'unavailable'
 * @property {number|null}    usagePct   - overall usage percentage (null if unavailable)
 * @property {string|null}    exhaustedResource - which resource hit the limit
 * @property {string|null}    projectedExhaustionMs - estimated ms until budget exhausted
 * @property {BudgetAdvice}   advice
 */

/**
 * @typedef {Object} BudgetAdvice
 * @property {string} action     - 'continue' | 'pause' | 'require_user' | 'stop'
 * @property {string} message
 * @property {string[]} warnings
 */

const DEFAULT_BUDGET_LIMITS = Object.freeze({
  maxInputTokens: null,
  maxOutputTokens: null,
  maxCostUsd: null,
  maxElapsedMs: null,
  maxIterations: null,
  whenExceed: 'warn',
});

/**
 * Project budget from a sequence of cost snapshots.
 *
 * @param {BudgetSnapshot[]} snapshots  - one per iteration
 * @param {BudgetLimits}    [limits]
 * @returns {BudgetProjection|null}
 */
function projectBudget(snapshots = [], limits = DEFAULT_BUDGET_LIMITS) {
  if (!snapshots || snapshots.length === 0) {
    return null;
  }

  const latest = snapshots[snapshots.length - 1];
  const effectiveLimits = { ...DEFAULT_BUDGET_LIMITS, ...limits };

  // Current snapshot
  const current = {
    inputTokens: latest.inputTokens || null,
    outputTokens: latest.outputTokens || null,
    costUsd: latest.costUsd || null,
    elapsedMs: latest.elapsedMs || null,
    cpuMs: latest.cpuMs || null,
    memoryMbPeak: latest.memoryMbPeak || null,
    diskMbUsed: latest.diskMbUsed || null,
    iterationCount: latest.iterationCount || snapshots.length,
  };

  // Check each resource
  const checks = [
    { name: 'inputTokens', value: latest.inputTokens, limit: effectiveLimits.maxInputTokens },
    { name: 'outputTokens', value: latest.outputTokens, limit: effectiveLimits.maxOutputTokens },
    { name: 'costUsd', value: latest.costUsd, limit: effectiveLimits.maxCostUsd },
    { name: 'elapsedMs', value: latest.elapsedMs, limit: effectiveLimits.maxElapsedMs },
    { name: 'iterations', value: snapshots.length, limit: effectiveLimits.maxIterations },
  ];

  const exceeded = checks.filter(
    (c) => c.value !== null && c.limit !== null && c.value >= c.limit,
  );
  const warnings = checks.filter(
    (c) =>
      c.value !== null &&
      c.limit !== null &&
      c.value >= c.limit * 0.8 &&
      c.value < c.limit,
  );

  let status = 'ok';
  let exhaustedResource = null;
  let usagePct = null;

  if (exceeded.length > 0) {
    status = 'exceeded';
    exhaustedResource = exceeded[0].name;
    usagePct = 100;
  } else if (warnings.length > 0) {
    status = 'warning';
    exhaustedResource = warnings[0].name;
    usagePct = Math.round((warnings[0].value / warnings[0].limit) * 100);
  } else {
    // Compute overall usage if any resource has a limit
    const firstWithLimit = checks.find((c) => c.limit !== null);
    if (firstWithLimit && firstWithLimit.value !== null) {
      usagePct = Math.round((firstWithLimit.value / firstWithLimit.limit) * 100);
    }
  }

  // Project exhaustion time from rate of change
  let projectedExhaustionMs = null;
  if (exceeded.length === 0 && latest.elapsedMs !== null && snapshots.length >= 2) {
    const first = snapshots[0];
    if (first.elapsedMs !== null) {
      const deltaMs = latest.elapsedMs - first.elapsedMs;
      const deltaIters = snapshots.length - 1;
      if (deltaMs > 0 && deltaIters > 0) {
        const msPerIter = deltaMs / deltaIters;
        if (latest.elapsedMs && effectiveLimits.maxElapsedMs) {
          const remaining = effectiveLimits.maxElapsedMs - latest.elapsedMs;
          if (remaining > 0) {
            projectedExhaustionMs = Math.round(remaining + msPerIter);
          }
        }
      }
    }
  }

  const advice = buildBudgetAdvice({
    status,
    exceeded,
    warnings,
    exhaustedResource,
    whenExceed: effectiveLimits.whenExceed,
  });

  return Object.freeze({
    current,
    limits: Object.freeze({ ...effectiveLimits }),
    status,
    usagePct,
    exhaustedResource,
    projectedExhaustionMs,
    advice,
  });
}

/**
 * Build budget advice based on status and limits policy.
 */
function buildBudgetAdvice({ status, exceeded, warnings, exhaustedResource, whenExceed }) {
  const warnings_list = warnings.map(
    (w) => `${w.name} 使用已达 ${Math.round((w.value / w.limit) * 100)}%`,
  );

  if (status === 'exceeded') {
    const action = whenExceed || 'pause';
    return Object.freeze({
      action,
      message:
        action === 'require_user'
          ? `预算已超限（${exhaustedResource}），请确认是否继续。`
          : `预算已超限（${exhaustedResource}）。`,
      warnings: warnings_list,
    });
  }

  if (status === 'warning') {
    return Object.freeze({
      action: 'warn',
      message: `${exhaustedResource} 使用超过 80%，接近预算上限。`,
      warnings: warnings_list,
    });
  }

  return Object.freeze({
    action: 'continue',
    message: '预算使用正常。',
    warnings: warnings_list,
  });
}

// ---------------------------------------------------------------------------
// SessionStageView — compact and expanded summaries
// ---------------------------------------------------------------------------

/**
 * Build a compact SessionStageView for the default (collapsed) UI.
 *
 * @param {Object} ctx
 * @returns {Object} frozen SessionStageView (compact)
 */
function buildSessionStageView({ loopRun, latestCheckpoint, budgetProjection }) {
  if (!loopRun && !latestCheckpoint) {
    return buildDefaultStageView();
  }

  const status = latestCheckpoint?.status || loopRun?.loopStatus || 'planned';
  const decision = latestCheckpoint?.decision || null;
  const conclusion = latestCheckpoint?.publicConclusion || loopRun?.metadata?.publicConclusion || null;
  const sequence = latestCheckpoint?.sequence || 0;
  const unresolvedGaps = latestCheckpoint?.goalGapIds || [];

  // Determine stage label from decision
  const stageLabel = deriveStageLabel({ status, decision, sequence });
  const stageIcon = deriveStageIcon({ status, decision });

  // Determine next hint from budget projection
  const budgetStatus = budgetProjection?.status || 'ok';
  const budgetAdvice = budgetProjection?.advice?.message || null;

  const compact = {
    schemaVersion: ENVELOPE_VERSION,
    viewType: 'compact',
    stage: Object.freeze({
      label: stageLabel,
      icon: stageIcon,
      sequence: sequence > 0 ? `${sequence}次迭代` : '初始化',
      status: deriveDisplayStatus({ status, decision }),
    }),
    conclusion: conclusion ? truncate(conclusion, 120) : null,
    nextHint: buildNextHint({ latestCheckpoint, budgetProjection }),
    budgetStatus,
    unresolvedCount: unresolvedGaps.length,
    recoveryHint: buildRecoveryHint(
      latestCheckpoint,
      unresolvedGaps,
      computeNextCandidateActions(latestCheckpoint, unresolvedGaps),
    ),
    generatedAt: new Date().toISOString(),
  };

  return Object.freeze(compact);
}

/**
 * Build an expanded SessionStageView for the detail panel.
 */
function buildExpandedSessionStageView({ loopRun, checkpoints = [], budgetProjection, failureHistory = [] }) {
  const latest = checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : null;
  const unresolvedGaps = latest ? computeUnresolvedGaps(checkpoints) : [];
  const nextActions = latest ? computeNextCandidateActions(latest, unresolvedGaps) : [];

  const expanded = {
    schemaVersion: ENVELOPE_VERSION,
    viewType: 'expanded',
    loopState: latest
      ? Object.freeze({
          loopRunId: loopRun?.loopRunId || latest.loopRunId,
          sequence: latest.sequence,
          status: latest.status,
          decision: latest.decision,
          reasonCode: latest.decisionReasonCode,
          publicConclusion: latest.publicConclusion,
          goalGapIds: latest.goalGapIds,
          validatorResults: latest.validatorResults || [],
          repairAttempt: latest.repairAttempt || null,
        })
      : null,
    unresolvedGaps,
    nextActions,
    failureHistory: Object.freeze([...(failureHistory || [])]),
    budgetProjection: budgetProjection || null,
    iterationCount: checkpoints.length,
    generatedAt: new Date().toISOString(),
  };

  return Object.freeze(expanded);
}

/**
 * Build the default view for a loop with no state yet.
 */
function buildDefaultStageView() {
  return Object.freeze({
    schemaVersion: ENVELOPE_VERSION,
    viewType: 'compact',
    stage: Object.freeze({
      label: '初始化',
      icon: 'loop',
      sequence: '',
      status: 'planned',
    }),
    conclusion: null,
    nextHint: Object.freeze({ action: 'wait', message: 'Loop 已创建，等待开始。' }),
    budgetStatus: 'ok',
    unresolvedCount: 0,
    recoveryHint: Object.freeze({ action: 'start', message: 'Loop 已初始化。' }),
    generatedAt: new Date().toISOString(),
  });
}

/**
 * Derive human-readable stage label from loop status + decision.
 * Decision takes priority over status for active states.
 */
function deriveStageLabel({ status, decision, sequence }) {
  if (decision === 'complete')  return '已完成';
  if (decision === 'retry')     return '自动修复';
  if (decision === 'block')     return '阻断';
  if (decision === 'wait')      return '等待确认';
  if (decision === 'cancel')    return '已取消';

  if (status === 'completed')  return '已完成';
  if (status === 'failed')     return '失败';
  if (status === 'cancelled')  return '已取消';
  if (status === 'blocked')    return '阻断';
  if (status === 'running')     return sequence > 0 ? '执行中' : '运行中';
  return '初始化';
}

/**
 * Derive icon name from decision first, then status.
 */
function deriveStageIcon({ status, decision }) {
  if (decision === 'complete') return 'check_circle';
  if (decision === 'retry')    return 'refresh';
  if (decision === 'block')     return 'warning';
  if (decision === 'wait')      return 'help';
  if (decision === 'cancel')    return 'cancel';

  if (status === 'completed') return 'check_circle';
  if (status === 'failed')    return 'error';
  if (status === 'cancelled') return 'cancel';
  if (status === 'blocked')   return 'block';
  if (status === 'running')   return 'sync';
  return 'loop';
}

/**
 * Derive display status string for compact view.
 */
function deriveDisplayStatus({ status, decision }) {
  if (decision === 'complete') return 'completed';
  if (decision === 'block')    return 'blocked';
  if (decision === 'wait')      return 'waiting';
  if (decision === 'retry')    return 'repairing';
  if (decision === 'cancel')    return 'cancelled';

  if (status === 'running')   return 'running';
  if (status === 'blocked')   return 'blocked';
  if (status === 'completed')  return 'completed';
  if (status === 'failed')    return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return status || 'unknown';
}

/**
 * Build next hint from latest checkpoint and budget.
 * Budget status ALWAYS takes priority over decision-based hints.
 */
function buildNextHint({ latestCheckpoint, budgetProjection }) {
  const bp = budgetProjection;
  // Budget exceeded always surfaces first, then warning
  if (bp && bp.status === 'exceeded') {
    return Object.freeze({
      action: bp.advice?.action || 'pause',
      message: bp.advice?.message || '预算已超限。',
    });
  }
  if (bp && bp.status === 'warning') {
    return Object.freeze({
      action: 'warn',
      message: bp.advice?.message || '接近预算上限。',
    });
  }
  if (!latestCheckpoint) {
    return Object.freeze({ action: 'wait', message: '等待开始。' });
  }
  const { decision, publicConclusion } = latestCheckpoint;
  if (decision === 'complete') {
    return Object.freeze({ action: 'none', message: '任务已完成。' });
  }
  if (decision === 'block') {
    return Object.freeze({ action: 'wait', message: publicConclusion || '阻断中。' });
  }
  if (decision === 'wait') {
    return Object.freeze({ action: 'wait', message: publicConclusion || '等待确认。' });
  }
  if (decision === 'retry') {
    return Object.freeze({ action: 'repair', message: '自动修复中。' });
  }
  if (decision === 'cancel') {
    return Object.freeze({ action: 'none', message: '任务已取消。' });
  }
  // 'continue' and unknown
  return Object.freeze({ action: 'proceed', message: publicConclusion || '继续。' });
}

// ---------------------------------------------------------------------------
// Sanitization helpers (no secrets, no raw code enter checkpoints)
// ---------------------------------------------------------------------------

function redactPublicConclusion(conclusion) {
  if (!conclusion) return null;
  return truncate(conclusion, 500);
}

function sanitizeValidatorResult(result) {
  return Object.freeze({
    validatorId: result.validatorId,
    status: result.status,
    version: result.version,
    findings: Object.freeze(
      (result.findings || []).map((f) =>
        Object.freeze({
          code: f.code || 'UNKNOWN',
          message: truncate(f.message || '', 200),
          severity: f.severity || 'warning',
        }),
      ),
    ),
    detail: result.detail ? truncate(result.detail, 200) : null,
  });
}

/**
 * Truncate a string to maxLen, appending "…" if truncated.
 */
function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…';
}

function sanitizeRepairAttempt(attempt) {
  return Object.freeze({
    strategyId: attempt.strategyId,
    strategyVersion: attempt.strategyVersion,
    safetyLevel: attempt.safetyLevel,
    costMultiplier: attempt.costMultiplier,
    isActionable: !!attempt.isActionable,
    requiresUserAuth: !!attempt.requiresUserAuth,
    publicMessage: truncate(attempt.publicMessage || '', 300),
    parentLineage: attempt.parentLineage
      ? Object.freeze({
          parentJobId: attempt.parentLineage.parentJobId || null,
          repairReason: attempt.parentLineage.repairReason || null,
        })
      : null,
    replacementJobId: attempt.replacementJobId || null,
    repaired: attempt.repaired === true,
    invalidatedArtifactIds: Object.freeze([...(attempt.invalidatedArtifactIds || [])]),
    preservedArtifactIds: Object.freeze([...(attempt.preservedArtifactIds || [])]),
  });
}

function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…';
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Merge a new cost snapshot into accumulated budget.
 */
function mergeCostSnapshot(accumulated, newSnapshot) {
  return {
    inputTokens: sum(accumulated?.inputTokens, newSnapshot?.inputTokens),
    outputTokens: sum(accumulated?.outputTokens, newSnapshot?.outputTokens),
    costUsd: sum(accumulated?.costUsd, newSnapshot?.costUsd),
    elapsedMs: newSnapshot?.elapsedMs || accumulated?.elapsedMs || null,
    cpuMs: max(accumulated?.cpuMs, newSnapshot?.cpuMs),
    memoryMbPeak: max(accumulated?.memoryMbPeak, newSnapshot?.memoryMbPeak),
    diskMbUsed: max(accumulated?.diskMbUsed, newSnapshot?.diskMbUsed),
    iterationCount: (accumulated?.iterationCount || 0) + 1,
  };
}

function sum(a, b) {
  if (a === null || a === undefined) return b;
  if (b === null || b === undefined) return a;
  return a + b;
}

function max(a, b) {
  if (a === null || a === undefined) return b;
  if (b === null || b === undefined) return a;
  return a > b ? a : b;
}

module.exports = {
  CHECKPOINT_VERSION,
  ENVELOPE_VERSION,
  buildIterationCheckpoint,
  deriveCheckpointId,
  buildLoopContextEnvelope,
  buildEmptyEnvelope,
  computeUnresolvedGaps,
  computeNextCandidateActions,
  collectFailureHistory,
  deriveEnvelopeId,
  buildRecoveryHint,
  projectBudget,
  buildBudgetAdvice,
  buildSessionStageView,
  buildExpandedSessionStageView,
  buildDefaultStageView,
  mergeCostSnapshot,
  DEFAULT_BUDGET_LIMITS,
};
