/**
 * helpers/llm-client.js — DeepSeek API client used by /api/ai/agent.
 *
 * 现在委托给 shared-backend/llm-providers/deepseek.js（LLMProvider 抽象层）。
 * 保持 callDeepSeek(apiKey, body, telemetry) 导出兼容，调用方不用改。
 *
 * 桌面版：apiKey 从 ai-settings.js 用户设置读取（调用方传入）。
 * Web 版：apiKey 从 process.env.DEEPSEEK_API_KEY 读取（调用方传入）。
 */

const { DeepSeekProvider } = require('../../shared-backend/llm-providers/deepseek');
const { DashScopeVisionProvider } = require('../../shared-backend/llm-providers/dashscope-vision');

const _provider = new DeepSeekProvider();
const _visionProvider = new DashScopeVisionProvider();

/**
 * callDeepSeek — 委托给 DeepSeekProvider.chat()
 * @param {string} apiKey - DeepSeek API key
 * @param {object} body - OpenAI 兼容格式请求体
 * @param {object} telemetry - {userId?, conversationId?, kind?}
 * @returns {Promise<object>} - 解析后的 JSON 或 {error}
 */
function callDeepSeek(apiKey, body, telemetry, options) {
  return _provider.chat(apiKey, body, telemetry, options);
}

function callDeepSeekStream(apiKey, body, telemetry, onEvent, options) {
  return _provider.chatStream(apiKey, body, telemetry, onEvent, options);
}

function getChatProvider(providerName) {
  if (!providerName || providerName === _provider.name) return _provider;
  return require('../../shared-backend/llm-providers').getProvider(providerName);
}

async function callChatProvider(providerName, apiKey, body, telemetry, onEvent, options) {
  const provider = getChatProvider(providerName);
  if (!provider) {
    return { error: 'provider_not_registered', message: `LLM Provider 未注册: ${providerName}` };
  }
  if (typeof provider.chatStream === 'function') {
    return provider.chatStream(apiKey, body, telemetry, onEvent, options);
  }
  const result = await provider.chat(apiKey, body, telemetry, options);
  const content = result && result.choices && result.choices[0] && result.choices[0].message
    ? result.choices[0].message.content || ''
    : '';
  if (content && typeof onEvent === 'function') onEvent({ type: 'content_delta', content });
  if (typeof onEvent === 'function') onEvent({ type: 'done', usage: result && result.usage });
  return result;
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
  return _visionProvider.chat(apiKey, body, telemetry);
}

module.exports = {
  callDeepSeek,
  callDeepSeekStream,
  callChatProvider,
  getChatProvider,
  callVision,
};
