'use strict';

/**
 * Loop Controller v1 — centralized observe → decide → validate → record → evaluate exit.
 *
 * Pure functions: no I/O, no DB, no network. All side effects (persisting iterations,
 * executing tools, updating conversation state) live in the integration layer.
 *
 * HLE-2 scope:
 *  - Derive observedStateDigest from conversation + job state (deterministic hash).
 *  - Compute goalGapIds by diffing DAG progress against previous iterations.
 *  - Detect no-progress cycles (same gap IDs observed repeatedly).
 *  - Detect repeated-action (same actionKey observed previously in this loop).
 *  - Detect oscillation (A↔B plan revision ping-pong).
 *  - Decide: continue / retry / wait / block / complete / cancel.
 *  - Validate: inputs completeness, tool readiness, parameter sanity.
 *  - Record: build a complete Iteration record via loop-contract.js.
 *  - Evaluate: should the loop exit? (all gaps resolved, or terminal error).
 *
 * NOT in scope (HLE-1: already done; HLE-3: validators; HLE-4: repair strategies):
 *  - Actually executing a tool (tool_executor lives in r-server).
 *  - Replaying a session from disk.
 *  - Re-routing around a failed node (HLE-4 repair strategy).
 *
 * Integration contract (HLE-3+):
 *  - Controller produces a "proposedAction" with actionKey.
 *  - Integration layer calls db.persistLoopIteration() then tool_executor().
 *  - After execution, integration layer calls controller.evaluate() again
 *    with the execution result embedded in observedStateDigest.
 */

const { redactSensitiveValue } = require('./redaction');

const {
  ACTION_TYPES,
  DECISION_OUTCOMES,
  REASON_CODES,
  EVIDENCE_KINDS,
  LOOP_RUN_STATUSES,
  stableHash,
  deriveIterationHash,
  pickSemanticFields,
  SEMANTIC_FIELD_KEYS,
  buildAction,
  buildIteration,
  buildEvidence,
  buildDecision,
  isTerminalLoopStatus,
} = require('./loop-contract');

const TOOL_STATES = Object.freeze(['pending', 'queued', 'running', 'completed', 'failed', 'blocked']);

// ---------------------------------------------------------------------------
// Observed state — derived deterministically from conversation + job facts.
// ---------------------------------------------------------------------------

/**
 * Derive a deterministic digest of the current conversation + job state.
 * Two calls with identical inputs always produce the same digest.
 * @param {Object} facts - { toolJobs, conversationSummary, dagProgress, lastIteration }
 * @returns {string} SHA-256 hex digest
 */
function deriveObservedStateDigest(facts) {
  const { toolJobs = [], conversationSummary = '', dagProgress = {} } = facts;
  const jobDigest = deriveJobsDigest(toolJobs);
  const progressDigest = deriveProgressDigest(dagProgress);
  const summaryDigest = stableHash({ conversationSummary, jobDigest, progressDigest });
  return summaryDigest;
}

function deriveJobsDigest(jobs) {
  if (!jobs || jobs.length === 0) return stableHash({ count: 0 });
  const summaries = (jobs)
    .slice()
    .sort((a, b) => String(a.id || '').localeCompare(b.id || ''))
    .map((j) => ({
      id: j.id || j.tool_job_id || null,
      status: j.status || null,
      error: j.error ? 'has_error' : 'no_error',
      finished: j.finished_at || j.completed_at ? 'finished' : 'incomplete',
    }));
  return stableHash({ jobs: summaries });
}

function deriveProgressDigest(progress) {
  if (!progress || typeof progress !== 'object') return stableHash({});
  const nodeStatuses = Object.keys(progress)
    .sort()
    .map((k) => `${k}:${String(progress[k])}`);
  return stableHash({ nodes: nodeStatuses });
}

// ---------------------------------------------------------------------------
// Goal gap analysis — which DAG gaps remain unresolved?
// ---------------------------------------------------------------------------

/**
 * Compute goal gap IDs by comparing DAG progress against previous iterations.
 * @param {Object} dag           - { nodes: [{ id, status }] }
 * @param {Array}  iterations   - previous iterations (most recent last)
 * @returns {Array<string>}     - IDs of unresolved gaps
 */
function computeGoalGapIds(dag, iterations = []) {
  if (!dag || !Array.isArray(dag.nodes)) return [];
  // Accumulate all resolved (previously proposed) gap IDs from every iteration.
  // This correctly handles multi-node proposals: if it1 proposed [n1,n2,n3],
  // all three are resolved, even if only n1 finished.
  const resolved = new Set();
  for (const it of iterations || []) {
    if (it && Array.isArray(it.goalGapIds)) {
      for (const id of it.goalGapIds) resolved.add(id);
    }
  }
  const incomplete = dag.nodes
    .filter((n) => !resolved.has(n.id))
    .map((n) => n.id);

  if (incomplete.length > 0) return incomplete;

  // All nodes resolved — check delivery
  if (dag.expectedDeliverables) {
    const pendingDeliverables = (dag.expectedDeliverables || [])
      .filter((d) => !d.delivered);
    if (pendingDeliverables.length > 0) {
      return ['pending_deliverables'];
    }
  }

  return [];
}

/**
 * Compute which goal gap IDs were resolved in this iteration vs the last.
 * @param {Array<string>} currentGapIds  - from computeGoalGapIds
 * @param {Array}        iterations     - previous iterations (most recent last)
 * @returns {Array<string>} IDs that are new (not in last iteration's gaps)
 */
function computeResolvedGapIds(currentGapIds, iterations = []) {
  if (!iterations || iterations.length === 0) return currentGapIds;
  const last = iterations[iterations.length - 1];
  if (!last || !Array.isArray(last.goalGapIds)) return currentGapIds;
  const prevGaps = new Set(last.goalGapIds);
  return currentGapIds.filter((id) => !prevGaps.has(id));
}

// ---------------------------------------------------------------------------
// Detection: no-progress / repeated-action / oscillation
// ---------------------------------------------------------------------------

/**
 * Detect no-progress cycles: the same set of goal gaps observed for N consecutive
 * iterations with no newly resolved gaps.
 * @param {Array<string>}   currentGapIds  - from computeGoalGapIds
 * @param {Array}          iterations     - previous iterations (in order)
 * @param {number}         threshold      - number of repeats to trigger (default 3)
 * @returns {{ detected: boolean, reason: string|null, cycleCount: number }}
 */
function detectNoProgress(currentGapIds, iterations = [], threshold = 3) {
  if (!iterations || iterations.length === 0) {
    return { detected: false, reason: null, cycleCount: 0 };
  }
  if (currentGapIds.length === 0) {
    return { detected: false, reason: null, cycleCount: 0 };
  }
  const currentSet = new Set(currentGapIds);
  let cycleCount = 0;
  for (let i = iterations.length - 1; i >= 0; i--) {
    const prev = iterations[i];
    if (!prev || !Array.isArray(prev.goalGapIds)) break;
    const prevSet = new Set(prev.goalGapIds);
    if (
      prevSet.size === currentSet.size &&
      [...currentSet].every((id) => prevSet.has(id))
    ) {
      cycleCount += 1;
    } else {
      break;
    }
  }
  const detected = cycleCount >= threshold;
  return {
    detected,
    reason: detected ? REASON_CODES.NO_PROGRESS_CYCLE_DETECTED : null,
    cycleCount,
  };
}

/**
 * Detect repeated-action: the same actionKey appeared in a previous iteration
 * of this loop run (dedupe signal).
 *
 * Self-match guard: if a prior iteration's proposedAction is the exact same
 * object reference as currentProposedAction (unit-test artifact), skip it.
 * This avoids false positives when the "current action" is manually included
 * in the iterations array for testing purposes.
 * In production, the current action is NOT in the iterations array yet —
 * iterations only contain PRIOR completed iterations.
 *
 * @param {string}          actionKey             - from buildAction().actionKey
 * @param {Array}          iterations           - prior iterations
 * @param {Object|null}    currentProposedAction - current proposed action (self-guard)
 * @returns {{ detected: boolean, previousIterationId: string|null }}
 */
function detectRepeatedAction(actionKey, iterations = [], currentProposedAction = null) {
  if (!actionKey || !iterations || iterations.length === 0) {
    return { detected: false, previousIterationId: null };
  }
  for (let i = iterations.length - 1; i >= 0; i--) {
    const prev = iterations[i];
    if (!prev || !prev.proposedAction) continue;
    // Self-match guard: skip if it's the same object reference as currentProposedAction.
    // In production, currentProposedAction is not in the iterations array at all
    // (iterations only contain PRIOR completed iterations).
    if (currentProposedAction && prev.proposedAction === currentProposedAction) continue;
    if (prev.proposedAction.actionKey === actionKey) {
      return { detected: true, previousIterationId: prev.iterationId || null };
    }
  }
  return { detected: false, previousIterationId: null };
}

/**
 * Detect oscillation: the last two iterations proposed conflicting plan revisions
 * (A then B then A, or same goalGapIds with different proposedAction.toolId).
 * @param {Array} iterations   - previous iterations (most recent last)
 * @param {string} currentToolId - proposed toolId in this iteration
 * @returns {{ detected: boolean, reason: string|null }}
 */
function detectOscillation(iterations = [], currentToolId) {
  if (!iterations || iterations.length < 2) {
    return { detected: false, reason: null };
  }
  const recent = iterations.slice(-2); // last two
  const [prev1, prev2] = recent;
  if (
    prev1?.proposedAction?.actionType === 'plan' &&
    prev2?.proposedAction?.actionType === 'plan'
  ) {
    const sameToolId = prev1.proposedAction.toolId === currentToolId;
    const prev1Has = prev1.proposedAction.params?.toolId || prev1.proposedAction.toolId || null;
    const prev2Has = prev2.proposedAction.params?.toolId || prev2.proposedAction.toolId || null;
    if (prev1Has && prev2Has && prev1Has === prev2Has && sameToolId) {
      return { detected: true, reason: REASON_CODES.PLAN_OSCILLATION_DETECTED };
    }
  }
  return { detected: false, reason: null };
}

// ---------------------------------------------------------------------------
// Validation: check proposed action before execution
// ---------------------------------------------------------------------------

/**
 * Validate a proposed action before it is executed.
 * Returns null if valid; returns an error object if not.
 *
 * @param {Object} action     - built via buildAction()
 * @param {Object} context    - { dag, toolMetadata, runtimeReady }
 * @returns {{ ok: boolean, error: string|null, reasonCode: string|null }}
 */
function validateAction(action, context = {}) {
  if (!action || !action.actionType) {
    return { ok: false, error: 'action_missing', reasonCode: REASON_CODES.INVALID_ARGUMENTS };
  }

  if (action.actionType === 'run_tool') {
    if (!action.toolId || typeof action.toolId !== 'string') {
      return { ok: false, error: 'tool_id_required', reasonCode: REASON_CODES.INVALID_ARGUMENTS };
    }

    // Check inputs completeness
    if (context.dag) {
      const node = (context.dag.nodes || []).find((n) => n.toolId === action.toolId);
      if (node) {
        const missing = (node.requiredInputs || []).filter(
          (inputId) => !action.inputs || !(inputId in action.inputs),
        );
        if (missing.length > 0) {
          return {
            ok: false,
            error: `missing_required_inputs:${missing.join(',')}`,
            reasonCode: REASON_CODES.INPUT_FORMAT_MISMATCH,
          };
        }
      }
    }

    // Check runtime readiness
    if (context.runtimeReady === false) {
      return {
        ok: false,
        error: 'runtime_not_ready',
        reasonCode: REASON_CODES.TOOL_RUNTIME_NOT_READY,
      };
    }

    // Check method applicability
    if (context.dag && action.toolId) {
      const node = (context.dag.nodes || []).find((n) => n.toolId === action.toolId);
      if (node && node.methodNotApplicable) {
        return {
          ok: false,
          error: 'method_not_applicable',
          reasonCode: REASON_CODES.METHOD_NOT_APPLICABLE,
        };
      }
    }
  }

  if (action.actionType === 'wait_for_user') {
    // Always valid
  }

  if (action.actionType === 'cancel') {
    if (!action.reason && !action.params?.reason) {
      return {
        ok: false,
        error: 'cancel_requires_reason',
        reasonCode: REASON_CODES.INVALID_ARGUMENTS,
      };
    }
  }

  return { ok: true, error: null, reasonCode: null };
}

// ---------------------------------------------------------------------------
// Decision: select next action based on observed state + detections
// ---------------------------------------------------------------------------

/**
 * Decide the next action and decision outcome given current state.
 * This is the "brain" — all branching lives here, not in tool executors.
 *
 * Priority order (first match wins):
 *  1. Oscillation detected → block, ask user
 *  2. Repeated action detected → block, return wait
 *  3. Action validation failed → block, report reason
 *  4. All gaps resolved → complete
 *  5. No-progress cycle detected → block, suggest repair
 *  6. User confirmation required → wait_for_user
 *  7. Active jobs running → continue observing
 *  8. Next gap available → propose action
 *  9. No gaps, no action → complete
 *  10. Catch-all → continue
 *
 * @param {Object}  ctx
 * @param {string}  ctx.observedStateDigest
 * @param {Array<string>} ctx.goalGapIds
 * @param {Array}   ctx.iterations    - previous iterations (most recent last)
 * @param {Object}  ctx.loopRunStatus - current loop status
 * @param {Array}   ctx.activeJobs    - currently running tool jobs
 * @param {Object}  ctx.dag           - DAG definition
 * @param {Object}  ctx.toolMetadata  - { toolId → { inputs, readiness } }
 * @param {Object}  ctx.runtimeReady  - boolean
 * @returns {{ decision, decisionReasonCode, proposedAction, publicConclusion }}
 */
function decideNextAction(ctx) {
  const {
    observedStateDigest,
    goalGapIds = [],
    iterations = [],
    loopRunStatus = 'running',
    activeJobs = [],
    dag = null,
    toolMetadata = {},
    runtimeReady = true,
    userConfirmationRequired = false,
    validatorResults = [],
  } = ctx;

  const currentGapSet = new Set(goalGapIds);
  const resolvedGaps = computeResolvedGapIds(goalGapIds, iterations);

  // Oscillation
  const pendingToolId = goalGapIds.length > 0 ? goalGapIds[0] : null;
  const osc = detectOscillation(iterations, pendingToolId);
  if (osc.detected) {
    return {
      decision: 'block',
      decisionReasonCode: osc.reason,
      proposedAction: null,
      publicConclusion:
        '检测到计划振荡（反复尝试同一工具），请确认设计或参数后继续。',
    };
  }

  // Validator results — block on blocked/delivery artifacts before proposing new actions
  if (validatorResults.length > 0 && goalGapIds.length > 0) {
    const blocked = validatorResults.filter((r) => r.status === 'blocked');
    if (blocked.length > 0) {
      const findings = blocked.flatMap((r) => r.findings || []);
      const summary = findings.length > 0
        ? findings.map((f) => f.code).join(', ')
        : `${blocked.length} 个验证器报告 blocked`;
      return {
        decision: 'block',
        decisionReasonCode: REASON_CODES.ARTIFACT_VALIDATION_FAILED,
        proposedAction: null,
        publicConclusion: `验证失败：${summary}。请修复后再继续。`,
      };
    }
    const degraded = validatorResults.filter((r) => r.status === 'degraded');
    if (degraded.length > 0) {
      const summary = degraded.flatMap((r) => r.findings || []).map((f) => f.code).join(', ');
      return {
        decision: 'continue',
        decisionReasonCode: REASON_CODES.ARTIFACT_VALIDATION_WARNING,
        proposedAction: null,
        publicConclusion: `验证警告：${summary}。任务可继续但结果可能受影响。`,
      };
    }
  }

  // Repeated action
  if (goalGapIds.length > 0) {
    const proposedAction = buildProposedAction(goalGapIds[0], dag, activeJobs);
    const repeated = detectRepeatedAction(
      proposedAction?.actionKey,
      iterations,
      proposedAction, // pass current action to skip it
    );
    if (repeated.detected) {
      return {
        decision: 'block',
        decisionReasonCode: REASON_CODES.TRANSIENT_RUNTIME_RETRY,
        proposedAction: null,
        publicConclusion:
          `检测到重复工具调用（actionKey=${proposedAction?.actionKey?.slice(0, 8)}…），请检查运行时状态或等待恢复。`,
      };
    }
  }

  // Action validation from previous iteration's attempt
  // (Checked in integration layer before calling decideNextAction again)

  // All gaps resolved
  if (goalGapIds.length === 0) {
    return {
      decision: 'complete',
      decisionReasonCode: REASON_CODES.ALL_NODES_VERIFIED,
      proposedAction: null,
      publicConclusion: '所有 DAG 节点已完成，交付物已就绪。',
    };
  }

  // No-progress cycle
  const noProgress = detectNoProgress(goalGapIds, iterations);
  if (noProgress.detected) {
    return {
      decision: 'block',
      decisionReasonCode: REASON_CODES.NO_PROGRESS_CYCLE_DETECTED,
      proposedAction: null,
      publicConclusion:
        `连续 ${noProgress.cycleCount} 次迭代未推进目标（gap IDs: ${goalGapIds.join(', ')}），请检查参数或设计后继续。`,
    };
  }

  // User confirmation required
  if (userConfirmationRequired) {
    return {
      decision: 'wait',
      decisionReasonCode: REASON_CODES.NORMAL_PLAN_GENERATED,
      proposedAction: buildAction({
        actionType: 'wait_for_user',
        params: { reason: 'user_decision_required', goalGapIds },
      }),
      publicConclusion: '等待用户确认参数或设计。',
    };
  }

  // Active jobs running
  if (activeJobs.length > 0) {
    return {
      decision: 'continue',
      decisionReasonCode: REASON_CODES.TOOL_SUCCEEDED,
      proposedAction: null,
      publicConclusion: `${activeJobs.length} 个任务执行中，等待结果。`,
    };
  }

  // Next gap → propose action
  const firstGap = goalGapIds[0];
  if (firstGap) {
    const proposedAction = buildProposedAction(firstGap, dag, activeJobs);
    const validation = validateAction(proposedAction, { dag, runtimeReady });
    if (!validation.ok) {
      return {
        decision: 'block',
        decisionReasonCode: validation.reasonCode,
        proposedAction: null,
        publicConclusion: `行动验证失败：${validation.error}（${validation.reasonCode}）`,
      };
    }
    return {
      decision: resolvedGaps.length > 0 ? 'continue' : 'continue',
      decisionReasonCode: resolvedGaps.length > 0
        ? REASON_CODES.NORMAL_PLAN_GENERATED
        : REASON_CODES.NORMAL_PLAN_GENERATED,
      proposedAction,
      publicConclusion: `推进目标节点：${firstGap}`,
    };
  }

  // No gap, no action
  return {
    decision: 'complete',
    decisionReasonCode: REASON_CODES.GOAL_ACHIEVED,
    proposedAction: null,
    publicConclusion: '所有目标已完成。',
  };
}

function buildProposedAction(gapId, dag, activeJobs) {
  const node = dag?.nodes?.find((n) => n.id === gapId || n.toolId === gapId);
  const toolId = node?.toolId || gapId;
  const inputs = (node?.inputs || {}) || {};

  return buildAction({
    actionType: node?.actionType || 'run_tool',
    toolId,
    inputs,
    params: { goalGapId: gapId, ...(node?.params || {}) },
    expectedArtifactKinds: node?.expectedArtifactKinds || [],
    attempt: 1,
  });
}

// ---------------------------------------------------------------------------
// Build iteration record — combines observe + decide into a DB-ready record
// ---------------------------------------------------------------------------

/**
 * Build a full iteration record for persistence.
 * Calls loop-contract.js buildIteration() to produce a stable-hashed record.
 *
 * @param {Object} ctx            - same as decideNextAction
 * @param {string} ctx.loopRunId
 * @param {number} ctx.sequence   - 1-based iteration sequence
 * @param {string} [ctx.parentIterationHash]
 * @param {Array}  [ctx.validatorResults] - optional ValidatorResult[] from validateArtifact/validateDelivery
 * @returns {Object} full iteration record (not yet persisted)
 */
function buildControllerIteration(ctx) {
  const {
    loopRunId,
    sequence,
    parentIterationHash = null,
    observedStateDigest,
    goalGapIds = [],
    iterations = [],
    loopRunStatus = 'running',
    activeJobs = [],
    dag = null,
    toolMetadata = {},
    runtimeReady = true,
    userConfirmationRequired = false,
    validatorResults = [],
  } = ctx;

  const decision = decideNextAction({
    observedStateDigest,
    goalGapIds,
    iterations,
    loopRunStatus,
    activeJobs,
    dag,
    toolMetadata,
    runtimeReady,
    userConfirmationRequired,
    validatorResults,
  });

  return buildIteration({
    loopRunId,
    sequence,
    observedStateDigest,
    goalGapIds,
    proposedAction: decision.proposedAction,
    decision: decision.decision,
    decisionReasonCode: decision.decisionReasonCode,
    publicConclusion: decision.publicConclusion,
    status: mapDecisionToIterationStatus(decision.decision),
    parentIterationHash,
    createdAt: new Date().toISOString(),
  });
}

function mapDecisionToIterationStatus(decision) {
  switch (decision) {
    case 'continue': return 'succeeded';
    case 'retry':    return 'failed';
    case 'block':    return 'blocked';
    case 'wait':     return 'pending';
    case 'complete': return 'succeeded';
    case 'cancel':   return 'skipped';
    default:         return 'pending';
  }
}

// ---------------------------------------------------------------------------
// Evaluate exit — should the loop stop?
// ---------------------------------------------------------------------------

/**
 * Evaluate whether the loop should exit based on current state.
 * Returns { shouldExit, loopStatus, publicConclusion }.
 *
 * @param {Object} ctx
 * @returns {{ shouldExit: boolean, loopStatus: string, publicConclusion: string }}
 */
function evaluateExit(ctx) {
  const { decision, goalGapIds = [], iterations = [], loopRunStatus = 'running' } = ctx;

  if (isTerminalLoopStatus(loopRunStatus)) {
    return {
      shouldExit: true,
      loopStatus: loopRunStatus,
      publicConclusion: 'Loop 已处于终止状态。',
    };
  }

  if (decision === 'complete') {
    return {
      shouldExit: true,
      loopStatus: 'completed',
      publicConclusion: '所有目标节点已完成，Loop 正常结束。',
    };
  }

  if (decision === 'cancel') {
    return {
      shouldExit: true,
      loopStatus: 'cancelled',
      publicConclusion: '用户取消了任务。',
    };
  }

  if (decision === 'block') {
    const noProgress = detectNoProgress(goalGapIds, iterations);
    const osc = detectOscillation(iterations, goalGapIds.length > 0 ? goalGapIds[0] : null);
    if (
      noProgress.detected ||
      osc.detected
    ) {
      return {
        shouldExit: true,
        loopStatus: 'blocked',
        publicConclusion:
          noProgress.detected
            ? `连续 ${noProgress.cycleCount} 次无进展，需人工介入。`
            : '检测到计划振荡，需人工介入。',
      };
    }
    // Other blocks (validation failure) — keep loop alive, wait for user/repair
    return {
      shouldExit: false,
      loopStatus: 'running',
      publicConclusion: '行动验证失败，等待修复或人工决策。',
    };
  }

  return {
    shouldExit: false,
    loopStatus: 'running',
    publicConclusion: 'Loop 继续推进。',
  };
}

// ---------------------------------------------------------------------------
// Reconciliation: reconcile tool job state into observed digest
// ---------------------------------------------------------------------------

/**
 * Reconcile a tool job's result back into the observed state digest.
 * After a job completes, call this to produce the next observed digest
 * that feeds into the next decideNextAction call.
 *
 * @param {string} oldDigest    - digest from before execution
 * @param {Object} job          - tool job row from DB
 * @param {Object} dag         - DAG definition
 * @returns {string} new digest
 */
function reconcileJobResult(oldDigest, job, dag = {}) {
  if (!job) return oldDigest;
  const { id, status, error, finished_at: finishedAt } = job;
  return stableHash({
    prevDigest: oldDigest,
    jobSummary: {
      id,
      status,
      error: error ? 'has_error' : 'no_error',
      finished: finishedAt ? 'finished' : 'incomplete',
    },
  });
}

// ---------------------------------------------------------------------------
// Provider-safe structured decision — for MCP/agent consumption
// ---------------------------------------------------------------------------

/**
 * Build a Provider-safe structured decision object (safe to send to LLM).
 * Contains no internal IDs, no raw stack traces, no API keys.
 *
 * @param {Object} iteration  - from buildControllerIteration
 * @returns {Object} sanitized decision
 */
function toStructuredDecision(iteration) {
  if (!iteration) return null;
  return {
    decision: iteration.decision,
    reasonCode: iteration.decisionReasonCode,
    publicConclusion: redactSensitiveValue(iteration.publicConclusion || ''),
    proposedAction: iteration.proposedAction
      ? {
          actionType: iteration.proposedAction.actionType,
          toolId: iteration.proposedAction.toolId,
          expectedArtifactKinds: iteration.proposedAction.expectedArtifactKinds,
          attempt: iteration.proposedAction.attempt,
          // Never expose actionKey or raw inputs/params to Provider
        }
      : null,
    iterationId: iteration.iterationId,
    sequence: iteration.sequence,
    hash: iteration.hash,
  };
}

module.exports = {
  TOOL_STATES,
  deriveObservedStateDigest,
  deriveJobsDigest,
  deriveProgressDigest,
  computeGoalGapIds,
  computeResolvedGapIds,
  detectNoProgress,
  detectRepeatedAction,
  detectOscillation,
  validateAction,
  decideNextAction,
  buildProposedAction,
  buildControllerIteration,
  buildAction,
  mapDecisionToIterationStatus,
  evaluateExit,
  reconcileJobResult,
  toStructuredDecision,
};