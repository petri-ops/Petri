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
    signal: options && options.signal,
    apiKeyOverride: apiKey,
  });
}

async function callChatProvider(providerName, apiKey, body, telemetry, onEvent, options) {
  return modelGateway.chat({
    role: (options && options.role) || 'agent',
    profileId: resolveCompatibilityProfileId(providerName, body, options),
    body,
    telemetry,
    onEvent,
    signal: options && options.signal,
    apiKeyOverride: apiKey,
  });
}

/**
 * callVision — 委托给 DashScopeVisionProvider.chat()（agent-led 阶段2 Task4）
 * 让 agent 能看图（qwen-vl-max）。apiKey 复用 DashScope key（getApiKey('dashscope')）。
 * @param {string} apiKey - DashScope API key
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
