'use strict';

/**
 * BLOCK-508 — agent 循环层 stall-resume 纯函数。
 *
 * 职责边界：本模块只做「决策 / 去重 / checkpoint 现场」三件纯逻辑，
 * 不碰网关、不碰 provider、不碰计时；orchestrator 负责薄接线与事件发射。
 *
 * 为什么在循环层：已吐 content/tool_call 后 idle stall 时 emittedOutput=true，
 * provider 层为防重复交付不重试（BLOCK-338 P2）→ 任务 break。流式协议无
 * resume/cursor（DeepSeek 实证）→ 只能循环层重发+去重，才能「不中断」。
 */

const { createHash } = require('node:crypto');

/** 有界续跑预算（保守默认；真实 1M 数据到手后校准，reopen 在案）。 */
const STALL_RESUME_LIMITS = Object.freeze({
  maxAttempts: 3,          // 本轮最多续跑次数（不含首次）
  maxTotalBudgetMs: 10 * 60 * 1000, // 续跑累计预算上限 10 分钟
  backoffMsByAttempt: Object.freeze([0, 2000, 5000]), // 第 1/2/3 次续跑前退避
});

/**
 * stall 后是否续跑（纯函数）。
 * @param {object} s
 * @param {string} s.error - 结果错误码；只有 'stream_stalled' 可续跑
 * @param {boolean} [s.emittedOutput] - 本轮是否已有可见交付（决定 reason，不决定是否续跑）
 * @param {number} [s.attempt] - 已续跑次数
 * @param {number} [s.elapsedMs] - 已耗时
 * @param {number} [s.budgetMs] - 总预算
 * @param {object} [s.limits]
 * @returns {{action: 'resume'|'terminal', reason: string, nextAttempt?: number}}
 */
function shouldResumeOnStall(s = {}) {
  if (s.error !== 'stream_stalled') {
    return { action: 'terminal', reason: 'not_stall' };
  }
  const limits = s.limits && typeof s.limits === 'object' ? s.limits : STALL_RESUME_LIMITS;
  const attempt = Number.isFinite(s.attempt) ? s.attempt : 0;
  const elapsed = Number.isFinite(s.elapsedMs) ? s.elapsedMs : 0;
  const budget = Number.isFinite(s.budgetMs) ? s.budgetMs : limits.maxTotalBudgetMs;
  if (attempt >= limits.maxAttempts) {
    return { action: 'terminal', reason: 'attempt_budget_exhausted' };
  }
  if (elapsed >= budget) {
    return { action: 'terminal', reason: 'time_budget_exhausted' };
  }
  const reason = s.emittedOutput
    ? 'stall_with_visible_output_resumable'
    : 'stall_no_visible_output';
  return { action: 'resume', reason, nextAttempt: attempt + 1 };
}

/**
 * 重放事件去重过滤器：按已发帧游标抑制重复交付。
 *
 * 判据：
 * - content_delta：按 emittedTextLength 剥离已发文本长度的前缀字符；
 *   重生成内容与原文不完全一致时按长度保守剥离（宁少勿重）。
 * - tool_call_delta：id 在 emittedToolCallIds 集合中的整条丢弃。
 * - reasoning_delta / done / usage / error / stream_stall / provider_retry 等一律透传。
 *
 * @param {{emittedTextLength?: number, emittedToolCallIds?: string[]}} cursor
 * @returns {(event: object) => object}
 */
function createResumeEventFilter(cursor = {}) {
  let seenTextChars = Math.max(0, Number.isFinite(cursor.emittedTextLength) ? cursor.emittedTextLength : 0);
  const seenToolIds = new Set(Array.isArray(cursor.emittedToolCallIds) ? cursor.emittedToolCallIds : []);
  return (event) => {
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') return event;
    if (event.type === 'content_delta') {
      const text = typeof event.content === 'string' ? event.content : '';
      if (seenTextChars <= 0) return { ...event, suppressed: false };
      const keep = text.slice(seenTextChars);
      seenTextChars = Math.max(0, seenTextChars - text.length);
      return { ...event, content: keep, suppressed: keep.length === 0 };
    }
    if (event.type === 'tool_call_delta' && typeof event.id === 'string') {
      if (seenToolIds.has(event.id)) return { ...event, suppressed: true };
      seenToolIds.add(event.id);
      return { ...event, suppressed: false };
    }
    return event;
  };
}

/**
 * 请求前生成现场 checkpoint（只存摘要与游标，不复制大正文）。
 * @returns {object} 冻结的 checkpoint 现场
 */
function buildGenerationCheckpoint({ messages, emittedTextLength = 0, emittedToolCallIds = [], attempt = 0, requestHash = null } = {}) {
  const digest = createHash('sha256')
    .update(JSON.stringify(Array.isArray(messages) ? messages.length : 0))
    .update('|')
    .update(JSON.stringify(Array.isArray(messages) ? messages.map((m) => (m && m.role) || '') : []))
    .digest('hex');
  return Object.freeze({
    schemaVersion: 1,
    kind: 'block508-generation-checkpoint',
    messagesDigest: digest,
    emittedTextLength: Math.max(0, Number.isFinite(emittedTextLength) ? emittedTextLength : 0),
    emittedToolCallIds: Object.freeze([...new Set(Array.isArray(emittedToolCallIds) ? emittedToolCallIds : [])]),
    attempt: Math.max(0, Number.isFinite(attempt) ? attempt : 0),
    requestHash: typeof requestHash === 'string' ? requestHash : null,
    createdAt: new Date().toISOString(),
  });
}

module.exports = {
  STALL_RESUME_LIMITS,
  shouldResumeOnStall,
  createResumeEventFilter,
  buildGenerationCheckpoint,
};
