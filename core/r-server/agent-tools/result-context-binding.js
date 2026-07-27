'use strict';

const CONTEXT_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const { projectPublicEditPhase } = require('../../shared-backend/result-studio-context');
const CONTEXT_BOUND_TOOLS = new Set([
  'result_edit_plan_in_context',
  'result_changeset_create_in_context',
  'result_changeset_status_in_context',
  'result_changeset_compare_in_context',
  'result_changeset_adopt_in_context',
  'result_changeset_revert_in_context',
]);

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validContextToken(value) {
  return CONTEXT_TOKEN_PATTERN.test(trimmed(value));
}

/**
 * Project untrusted request context into the narrow hint accepted by
 * resolveResultStudioContext. IDs remain hints: SQLite/Artifact Truth is
 * re-read by every tool operation and the token is compared fail-closed.
 */
function projectResultStudioToolContext(context = {}) {
  const candidate = context && context.activeArtifact && typeof context.activeArtifact === 'object'
    ? context.activeArtifact
    : null;
  const jobId = trimmed(candidate && candidate.jobId);
  const name = trimmed(candidate && candidate.name);
  const revisionId = trimmed(candidate && candidate.revisionId);
  const contextToken = candidate && validContextToken(candidate.contextToken)
    ? trimmed(candidate.contextToken)
    : null;
  return {
    activeArtifact: jobId && name
      ? { jobId, name, revisionId: revisionId || null }
      : null,
    resultStudioContextToken: contextToken,
  };
}

/**
 * Bind the click-time token before JSON-schema validation.
 *
 * An explicitly supplied token always wins — even when stale or malformed —
 * so the existing guard can reject it instead of silently retargeting a write.
 */
function bindResultStudioContextToken(name, args = {}, ctx = {}) {
  const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  if (!CONTEXT_BOUND_TOOLS.has(name)) return safeArgs;
  if (Object.prototype.hasOwnProperty.call(safeArgs, 'contextToken')) return safeArgs;
  if (!validContextToken(ctx.resultStudioContextToken)) return safeArgs;
  return { ...safeArgs, contextToken: trimmed(ctx.resultStudioContextToken) };
}

/** One bounded recorder shared by task and legacy Agent paths. */
function createResultEditProgressRecorder() {
  let events = [];
  const append = (event = {}) => {
    const projected = projectPublicEditPhase(event.stage, event.status);
    const next = {
      resultEditProgressVersion: 1,
      // ChangeSet events are numbered per candidate, while intent/plan
      // events precede any candidate and retries start another local
      // sequence. Persist one monotonic public sequence for the whole turn.
      sequence: events.length > 0 ? events[events.length - 1].sequence + 1 : 1,
      changeSetId: trimmed(event.changeSetId),
      stage: trimmed(event.stage),
      status: trimmed(event.status),
      ...(trimmed(event.reason) ? { reason: trimmed(event.reason).slice(0, 500) } : {}),
      ...(trimmed(event.toolJobId) ? { toolJobId: trimmed(event.toolJobId) } : {}),
      ...(trimmed(event.revisionId) ? { revisionId: trimmed(event.revisionId) } : {}),
      ...(projected.phase ? { publicPhase: projected.phase, publicPhaseLabel: projected.label } : {}),
    };
    events = events.concat(next).slice(-30);
    return next;
  };
  return {
    record: append,
    ensureTerminal(event = {}) {
      if (events.length > 0 && events[events.length - 1].status === 'terminal') return null;
      return append({ ...event, status: 'terminal' });
    },
    snapshot() {
      return events.map((event) => ({ ...event }));
    },
  };
}

function finalizeResultEditProgress(recorder, { outcome, reason } = {}) {
  const cancelled = outcome === 'cancelled';
  const hasResultEditProgress = recorder && recorder.snapshot().length > 0;
  const terminal = hasResultEditProgress
    ? recorder.ensureTerminal({ stage: cancelled ? 'cancelled' : 'failed', reason })
    : null;
  return {
    hasResultEditProgress,
    terminal,
    assistantMessage: hasResultEditProgress
      ? (cancelled
        ? '结果修改已停止；已完成的阶段结论已保留。'
        : '结果修改未完成；已完成的阶段结论已保留，可在当前会话中继续处理。')
      : (cancelled
        ? '任务已由用户停止。已完成的阶段结论、工具记录和结果已保留，未开始的步骤不会继续执行。'
        : '本轮 Agent 请求未完成；上游模型响应异常，请稍后重试。'),
  };
}

module.exports = {
  CONTEXT_BOUND_TOOLS,
  validContextToken,
  projectResultStudioToolContext,
  bindResultStudioContextToken,
  createResultEditProgressRecorder,
  finalizeResultEditProgress,
};
