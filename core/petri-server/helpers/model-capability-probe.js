'use strict';

/**
 * model-capability-probe — BLOCK-458 用户确认后的轻量模型能力探测。
 *
 * 只读地发一次极小 chat 请求，用响应中的 reasoning_content / reasoning_tokens
 * 作为“支持思考”的证据；无证据只返回 unknown，不冒充 false。
 * 不写盘探测日志，只把 request_id、时间、模型等证据字段返回给调用方。
 */

const { modelGateway } = require('./model-gateway');
const { getAiSettings } = require('./ai-settings');
const { isUnknownParameterError } = require('../../shared-backend/llm-providers/thinking-level');

const PROBE_TIMEOUT_MS = 15000;
const PROBE_SYSTEM = '你是简洁推理探针。请认真思考，但最终只输出一个数字答案。';
const PROBE_USER = '甲有 17 个球，乙比甲多 6 个，丙比乙少 9 个。丙有多少个球？只输出数字。';

function errorText(result) {
  return [
    result && result.message,
    result && result.error,
    result && result.error && result.error.message,
  ].filter(Boolean).map((value) => (typeof value === 'string' ? value : JSON.stringify(value))).join(' ');
}

function reasoningEvidenceFromResult(result) {
  const usage = result && result.usage && typeof result.usage === 'object' ? result.usage : {};
  const details = usage.completion_tokens_details && typeof usage.completion_tokens_details === 'object'
    ? usage.completion_tokens_details
    : {};
  const message = result && result.choices && result.choices[0] && result.choices[0].message
    ? result.choices[0].message
    : {};
  const reasoningText = typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
  return {
    reasoningContent: reasoningText.trim().length > 0,
    reasoningTokens: Number.isFinite(Number(details.reasoning_tokens)) ? Number(details.reasoning_tokens) : 0,
    requestId: typeof result?.request_id === 'string' ? result.request_id : null,
    model: typeof result?.model === 'string' ? result.model : null,
  };
}

function probeVerdictFromResult(result) {
  if (result && result.error) {
    return isUnknownParameterError(errorText(result)) ? 'unsupported' : 'error';
  }
  const evidence = reasoningEvidenceFromResult(result);
  if (evidence.reasoningContent || evidence.reasoningTokens > 0) return 'supported';
  return 'unknown';
}

async function probeReasoningCapability({ profileId, model, userId } = {}) {
  const id = typeof profileId === 'string' ? profileId.trim() : '';
  if (!id) return { ok: false, error: 'profile_id_required', verdict: 'error' };
  const settings = getAiSettings();
  const profile = (Array.isArray(settings.model_profiles) ? settings.model_profiles : [])
    .find((row) => row && row.id === id);
  if (!profile) return { ok: false, error: 'profile_not_found', verdict: 'error' };
  const targetModel = typeof model === 'string' && model.trim() ? model.trim() : profile.model;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const result = await modelGateway.chat({
      role: 'chat',
      profileId: id,
      modelOverride: targetModel,
      disableFallback: true,
      thinkingLevel: 'high',
      telemetry: { userId: userId || null, kind: 'capability-probe-reasoning' },
      signal: controller.signal,
      body: {
        messages: [
          { role: 'system', content: PROBE_SYSTEM },
          { role: 'user', content: PROBE_USER },
        ],
        temperature: 0.2,
        max_tokens: 256,
        stream: false,
      },
    });
    const verdict = probeVerdictFromResult(result);
    const evidence = {
      ...reasoningEvidenceFromResult(result),
      observedAt: new Date().toISOString(),
    };
    if (verdict === 'error') {
      return {
        ok: false,
        verdict,
        error: typeof result?.error === 'string' ? result.error : 'model_call_failed',
        message: errorText(result) || undefined,
      };
    }
    return {
      ok: true,
      verdict,
      profileId: id,
      requestedModel: targetModel,
      model: evidence.model || targetModel,
      provider: profile.provider,
      evidence: { ...evidence, requestedModel: targetModel, responseModel: evidence.model },
    };
  } catch (error) {
    return {
      ok: false,
      verdict: 'error',
      error: error && error.name === 'AbortError' ? 'timeout' : ((error && error.message) || 'model_call_failed'),
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  PROBE_TIMEOUT_MS,
  errorText,
  reasoningEvidenceFromResult,
  probeVerdictFromResult,
  probeReasoningCapability,
};
