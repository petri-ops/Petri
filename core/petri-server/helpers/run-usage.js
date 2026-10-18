'use strict';

/**
 * UI-523 — 单次模型调用的用量事件构造（composer 运行计量条的数据源）。
 *
 * 口径（与既有账本同源，不新建计数器）：
 * - token 数取自 provider 原始 usage 形状，兼容 OpenAI（prompt/completion_tokens）、
 *   Anthropic（input/output_tokens）与 stream-aggregate 归一字段——与
 *   `ai-usage.recordAiUsage` 的落库口径一致；
 * - cache 字段复用 `protocol-usage.extractCacheFields`（BLOCK-95 B3 同一实现，
 *   不复制三协议兼容矩阵）；
 * - `durationMs` 由调用方在 provider 调用外层实测（含网络与首 token 前 prefill），
 *   与 `ai_usage.latency_ms` 同口径 ⇒ 速率 = completionTokens ÷ durationMs 是
 *   端到端平均输出速率的下限，界面**不得**称「解码速度」（BLOCK-79 口径）。
 *
 * 诚实边界：usage 缺失、或输入/输出 token 均为 0 时返回 `null`——调用方不发事件，
 * 前端显示 `—` 而不是伪造 0。
 *
 * 纯函数：零 IO、零全局状态，单测在 `test/ui523-usage-event.test.mjs`。
 */

const { extractCacheFields } = require('../../shared-backend/llm-providers/protocol-usage');

function positiveInt(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

/**
 * @param {unknown} rawUsage provider 返回的 usage（原始或归一形状）
 * @param {{conversationId?: string|null, iteration?: number, attempt?: number, model?: string|null, durationMs?: number}} meta
 * @returns {object|null} SSE 事件载荷；不可算时 null
 */
function buildRunUsageEvent(rawUsage, meta = {}) {
  const usage = rawUsage && typeof rawUsage === 'object' ? rawUsage : null;
  if (!usage) return null;

  const promptTokens = positiveInt(usage.prompt_tokens ?? usage.input_tokens);
  const completionTokens = positiveInt(usage.completion_tokens ?? usage.output_tokens);
  // 渠道未返回 usage（或返回全 0）时不发事件：界面据此显示「不可算」而非 0。
  if (promptTokens <= 0 && completionTokens <= 0) return null;

  const cache = extractCacheFields(usage);
  const durationMs = Math.max(0, Math.round(Number(meta.durationMs) || 0));

  return {
    event: 'usage',
    scope: 'call',
    conversationId: meta.conversationId ? String(meta.conversationId) : null,
    iteration: positiveInt(meta.iteration),
    attempt: Math.max(1, positiveInt(meta.attempt) || 1),
    model: meta.model ? String(meta.model) : null,
    promptTokens,
    completionTokens,
    cacheReadTokens: cache.cacheReadTokens,
    cacheCreationTokens: cache.cacheCreationTokens,
    durationMs,
    at: new Date().toISOString(),
  };
}

module.exports = { buildRunUsageEvent };
