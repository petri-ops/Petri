/**
 * helpers/llm-client.js — DeepSeek API client used by /api/ai/agent.
 *
 * 现在统一委托给 Model Gateway。旧函数名只作为兼容转发层保留。
 * 保持 callDeepSeek(apiKey, body, telemetry) 导出兼容，调用方不用改。
 *
 * 桌面版：apiKey 从 ai-settings.js 用户设置读取（调用方传入）。
 * Web 版：apiKey 从 process.env.DEEPSEEK_API_KEY 读取（调用方传入）。
 */

const { modelGateway } = require('./model-gateway');

function resolveCompatibilityProfileId(providerName, body, options) {
  if (options && options.profileId) return options.profileId;
  const config = modelGateway.getConfig();
  const requestedModel = body && body.model;
  const requestedBaseUrl = options && options.baseUrl;
  const match = config.profiles.find((profile) =>
    (!providerName || profile.provider === providerName) &&
    (!requestedModel || profile.model === requestedModel) &&
    (!requestedBaseUrl || profile.baseUrl === requestedBaseUrl)
  );
  return match && match.id;
}

/**
 * callDeepSeek — 委托给 DeepSeekProvider.chat()
 * @param {string} apiKey - DeepSeek API key
 * @param {object} body - OpenAI 兼容格式请求体
 * @param {object} telemetry - {userId?, conversationId?, kind?}
 * @returns {Promise<object>} - 解析后的 JSON 或 {error}
 */
function callDeepSeek(apiKey, body, telemetry, options) {
  return modelGateway.chat({
    role: 'chat',
    body,
    telemetry,
    profileId: resolveCompatibilityProfileId('deepseek', body, options),
    modelOverride: options && options.modelOverride,
    signal: options && options.signal,
    apiKeyOverride: apiKey,
  });
}

function callDeepSeekStream(apiKey, body, telemetry, onEvent, options) {
  return modelGateway.chat({
    role: 'chat',
    body,
    telemetry,
    onEvent,
    profileId: resolveCompatibilityProfileId('deepseek', body, options),
    modelOverride: options && options.modelOverride,
    signal: options && options.signal,
    apiKeyOverride: apiKey,
    fallbackWhen: options && options.fallbackWhen,
    // BLOCK-376（S1 / G-03）——兼容入口透传 errorsAsRejections（callChatProvider 已有，
    // callDeepSeekStream 漏齐：chat 轨生产调用方经此入口时开关被静默吞掉）。
    // 缺省不注入键（零行为变化，与网关 options 组装同款条件展开）。
    ...(options && options.errorsAsRejections ? { errorsAsRejections: true } : {}),
  });
}

function callChatProvider(providerName, apiKey, body, telemetry, onEvent, options) {
  const invoke = () => modelGateway.chat({
    role: (options && options.role) || 'agent',
    profileId: resolveCompatibilityProfileId(providerName, body, options),
    modelOverride: options && options.modelOverride,
    body,
    telemetry,
    onEvent,
    signal: options && options.signal,
    apiKeyOverride: apiKey,
    fallbackWhen: options && options.fallbackWhen,
    // BLOCK-56 P1 — 降级续跑任务关闭请求级 fallback（单级不连环）
    disableFallback: !!(options && options.disableFallback),
    // BLOCK-81 P1 — 思考档位（中性档位随调用链进网关，映射与容错都在网关侧）
    thinkingLevel: options && options.thinkingLevel,
    // BLOCK-365（F-01）流中断穿透到上层整轮重试（此前在此丢参，生产链路零重试）
    errorsAsRejections: !!(options && options.errorsAsRejections),
  });
  return invoke().then((result) => {
    // BLOCK-338 P2 / STALL-ROOT — stall 可重试判据是「本轮零可见交付输出」而非 phase。
    // reasoning_delta 会把看门狗 phase 推到 idle，但 reasoning 不是交付内容：模型只吐
    // reasoning 后卡死（idle + emittedOutput=false）同样是零输出瞬态，重放安全，应重试。
    // 真正吐了 content/tool_call（emittedOutput=true）才不重试，防重复交付。
    // emittedOutput 未显式为 true（兼容旧 mock/调用方）时按零输出处理。第二次仍 stall 直接返回。
    if (result && result.error === 'stream_stalled' && result.emittedOutput !== true) {
      // BLOCK-365（W1）重试可观测：不把重试当错误，也不把重试藏起来。
      if (typeof onEvent === 'function') {
        try {
          onEvent({
            type: 'provider_retry',
            reason: result.phase === 'first_token' ? 'stream_stalled_first_token' : 'stream_stalled_no_output',
            elapsedMs: result.elapsedMs || null,
            attempt: 2,
          });
        } catch { /* 观测回调失败不影响重试 */ }
      }
      return invoke();
    }
    return result;
  });
}

/**
 * callVision — 兼容入口，委托给 Model Gateway 的 vision 角色。
 * 让 agent 能看图。具体模型和凭据由 vision 角色的 ModelProfile 决定。
 * @param {string} apiKey - 旧调用方可传；为空时由 credentialRef 解析
 * @param {object} body - { messages: [{role, content:[{type:'text'|'image',...}]}] }
 * @param {object} telemetry - {userId?, conversationId?, kind?}
 * @returns {Promise<{ok, content, usage}|{error, message}>}
 */
function callVision(apiKey, body, telemetry) {
  return modelGateway.vision({ body, telemetry, apiKeyOverride: apiKey });
}

module.exports = {
  callDeepSeek,
  callDeepSeekStream,
  callChatProvider,
  callVision,
  modelGateway,
};
