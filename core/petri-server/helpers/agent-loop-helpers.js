'use strict';

// A2 WAVE2 位置变更：agent-runner.js 原为 require('../shared-backend/loop-contract')，
// 本模块下移一层到 helpers/，故相对路径改 ../../shared-backend/loop-contract（同一模块，零逻辑变化）。
const { buildEvidence } = require('../../shared-backend/loop-contract');

/**
 * agent-loop-helpers.js — A2 WAVE2 纯函数聚宝盆拆解（纯搬运，行为零变化）
 *
 * 从 agent-runner.js 迁出的顶层纯函数。每个函数逐字搬运，仅因模块位置变化
 * 调整相对 require 路径；不改逻辑、不改 reasonCode、不改参数语义。
 * agent-runner.js 以 facade 重导出，外部 require 零变化。
 *
 * 边界：runAgentLoop 主循环体不拆；自进化 lesson 注入点区域（原
 * agent-runner.js:321-323）不碰；本模块无隐式主循环闭包依赖、无副作用耦合。
 */

/**
 * Resolve terminal task status.
 * @param {object} opts
 * @returns {{status: string, error: string|null}}
 */
function resolveAgentTaskTerminal({
  cancelled = false,
  fatalError = null,
  assistantText = '',
  pendingApproval = false,
} = {}) {
  if (cancelled) return { status: 'cancelled', error: null };
  if (fatalError) {
    return {
      status: 'failed',
      error: fatalError.message || String(fatalError) || 'agent loop failed',
    };
  }
  // BLOCK-49 加映 —— 完成判定放宽为非空即完成：原 >20 字符启发式把短回答
  // 子任务（如纯算式「17 * 23 = 391」14 字符）误判为 failed（实机两轮触发，
  // 破坏 wait_agent/followup 对短任务可靠性）。空字符串仍判 failed（防御
  // 「模型全程无输出」的真失败）。
  if (String(assistantText || '').trim().length > 0 || pendingApproval) {
    return { status: 'completed', error: null };
  }
  return { status: 'failed', error: 'agent loop 未生成有效回复' };
}

/**
 * Resolve failed job replacements from tool jobs array.
 * @param {Array} toolJobs
 * @returns {object}
 */
function resolveFailedJobReplacements(toolJobs = []) {
  const failedJobs = toolJobs.filter((job) => ['failed', 'blocked'].includes(job.status));
  const replacementByFailureKey = new Map();
  for (const failed of failedJobs) {
    const failedToolId = failed.toolId || failed.jobTruth?.tool_id || null;
    if (!failedToolId) continue;
    const replacement = toolJobs.find((candidate) =>
      candidate.status === 'completed' &&
      candidate.toolJobId &&
      candidate.iteration > failed.iteration &&
      (candidate.toolId || candidate.jobTruth?.tool_id) === failedToolId
    );
    if (replacement) {
      replacementByFailureKey.set(failed.toolJobId || failed.callId, replacement);
    }
  }
  const unresolvedFailedJobs = failedJobs.filter(
    (failed) => !replacementByFailureKey.has(failed.toolJobId || failed.callId)
  );
  const primaryFailed = failedJobs.find((failed) =>
    failed.toolJobId && replacementByFailureKey.has(failed.toolJobId)
  ) || failedJobs.find((failed) => failed.toolJobId) || failedJobs[0] || null;
  return {
    failedJobs,
    unresolvedFailedJobs,
    primaryFailed,
    replacementByFailureKey,
    repairedFailedJobIds: new Set(
      failedJobs
        .filter((failed) => failed.toolJobId && replacementByFailureKey.has(failed.toolJobId))
        .map((failed) => failed.toolJobId)
    ),
  };
}

/**
 * Build observed replacement attempt evidence.
 * @param {object} diagnosis
 * @param {object} failedJob
 * @param {object} replacementJob
 * @returns {object|null}
 */
function buildObservedReplacementAttempt(diagnosis, failedJob, replacementJob) {
  if (!failedJob?.toolJobId || !replacementJob?.toolJobId) return null;
  const toolId =
    replacementJob.toolId ||
    replacementJob.jobTruth?.tool_id ||
    failedJob.toolId ||
    failedJob.jobTruth?.tool_id ||
    null;
  return {
    strategyId: 'observed_same_tool_replacement',
    strategyVersion: '1.0.0',
    newToolId: toolId,
    newInputs: null,
    newParams: null,
    parentLineage: {
      parentJobId: failedJob.toolJobId,
      parentArtifactIds: [],
      parentPlanHash: null,
      repairReason: diagnosis?.faultType || 'unclassified_failure',
    },
    replacementJobId: replacementJob.toolJobId,
    repaired: true,
    invalidatedArtifactIds: [],
    preservedArtifactIds: [],
    isActionable: false,
    requiresUserAuth: false,
    publicMessage: '已验证同一工具的新 Job 成功替换失败 Job，并保留 parent/replacement lineage。',
    costMultiplier: 1,
    safetyLevel: 'safe',
  };
}

/**
 * Build loop observation evidence.
 * @param {object} input
 * @returns {object}
 */
function buildLoopObservationEvidence(input) {
  return buildEvidence({
    ...input,
    kind: 'observation',
  });
}

/**
 * BLOCK-207（W7b）— 项目信任级天花板：请求档位 → 按项目信任级**只收紧**后的档位。
 * 边界：四档判定/审批/用户规则一字不动；这里只可能在进入判定前把写/执行降为 read。
 *
 * A2 WAVE2 位置变更：agent-runner.js 原惰性 require('./helpers/runtime-policy') 与
 * require('./helpers/trust-policy')，本模块位于 helpers/ 故路径改 ./runtime-policy / ./trust-policy
 * （同一模块；惰性 require + fail-open catch 语义逐字保留）。
 */
function _applyProjectTrustCeiling(context) {
  const explicit = context && (context.accessMode === 'read' || context.accessMode === 'workspace-write' || context.accessMode === 'plan' || context.accessMode === 'full')
    ? context.accessMode
    : require('./runtime-policy').getDefaultApprovalMode();
  try {
    const trust = require('./trust-policy');
    const level = trust.levelForProject(context && context.projectId);
    return trust.applyTrustCeiling(explicit, level);
  } catch {
    // 信任层故障不得改变既有行为（fail-open 到原档位）：它是收紧器，不是判定器
    return explicit;
  }
}

module.exports = {
  resolveAgentTaskTerminal,
  resolveFailedJobReplacements,
  buildObservedReplacementAttempt,
  buildLoopObservationEvidence,
  _applyProjectTrustCeiling,
};
