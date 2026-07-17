/**
 * LLM Provider Registry — AI 模型 Provider 注册表
 *
 * AI 控制层核心。将 LLM 调用从硬编码的 DeepSeek/DashScope 抽象为统一接口。
 * 桌面版用户在设置页自填 API key，选择 provider；
 * 凭据由宿主通过 credentialRef 解析；Provider adapter 不读取设置文件。
 *
 * 加新 provider = 新建实现 + registerProvider()，不改核心。
 * 未来可加 OpenAIProvider / OllamaProvider（本地离线模型）。
 *
 * 接口规范（LLMProvider）：
 *   name           — 'deepseek' | 'dashscope' | 'openai' | 'ollama' | ...
 *   capabilities   — 'chat' | 'embedding' | 'both'
 *   chat(apiKey, body, telemetry, options) → Promise<parsed JSON | {error}>
 *   chatStream(apiKey, body, telemetry, onEvent, options) → Promise<aggregate JSON | {error}>（可选）
 *   embed(apiKey, texts, telemetry) → Promise<Float32Array[] | null>
 *   healthCheck(apiKey) → Promise<boolean>   （可选）
 */

const logger = require('../logger');
const { DeepSeekProvider } = require('./deepseek');
const { DashScopeEmbedProvider } = require('./dashscope');
const { DashScopeVisionProvider } = require('./dashscope-vision');

const _providers = new Map();

function registerProvider(provider) {
  if (!provider || !provider.name) {
    throw new Error('registerProvider: provider.name is required');
  }
  _providers.set(provider.name, provider);
  logger.info(`[llm-providers] registered: ${provider.name} (${provider.capabilities})`);
}

function getProvider(name) {
  return _providers.get(name);
}

/**
 * 获取 chat provider。
 * 优先级：BIOF3_LLM_PROVIDER 环境变量 > 默认 'deepseek'
 */
function getChatProvider() {
  const name = process.env.BIOF3_LLM_PROVIDER || 'deepseek';
  const provider = _providers.get(name);
  if (!provider) {
    throw new Error(`LLM chat provider 未注册: ${name}`);
  }
  return provider;
}

/**
 * 获取 embedding provider。
 * 优先级：BIOF3_EMBED_PROVIDER 环境变量 > 默认 'dashscope'
 */
function getEmbedProvider() {
  const name = process.env.BIOF3_EMBED_PROVIDER || 'dashscope';
  const provider = _providers.get(name);
  if (!provider) {
    throw new Error(`LLM embed provider 未注册: ${name}`);
  }
  return provider;
}

function listProviders() {
  return Array.from(_providers.keys());
}

function registerBuiltInProviders() {
  if (!_providers.has('deepseek')) registerProvider(new DeepSeekProvider());
  if (!_providers.has('openai')) {
    registerProvider(new DeepSeekProvider({
      name: 'openai',
      label: 'OpenAI',
      defaultBaseUrl: 'https://api.openai.com/v1',
    }));
  }
  if (!_providers.has('openai-compatible')) {
    registerProvider(new DeepSeekProvider({
      name: 'openai-compatible',
      label: 'OpenAI-compatible',
      defaultBaseUrl: 'https://api.openai.com/v1',
      requiresApiKey: false,
    }));
  }
  if (!_providers.has('ollama')) {
    registerProvider(new DeepSeekProvider({
      name: 'ollama',
      label: 'Ollama',
      defaultBaseUrl: 'http://127.0.0.1:11434/v1',
      requiresApiKey: false,
    }));
  }
  if (!_providers.has('lmstudio')) {
    registerProvider(new DeepSeekProvider({
      name: 'lmstudio',
      label: 'LM Studio',
      defaultBaseUrl: 'http://127.0.0.1:1234/v1',
      requiresApiKey: false,
    }));
  }
  if (!_providers.has('vllm')) {
    registerProvider(new DeepSeekProvider({
      name: 'vllm',
      label: 'vLLM',
      defaultBaseUrl: 'http://127.0.0.1:8000/v1',
      requiresApiKey: false,
    }));
  }
  if (!_providers.has('dashscope')) registerProvider(new DashScopeEmbedProvider());
  if (!_providers.has('dashscope-vision')) registerProvider(new DashScopeVisionProvider());
}

registerBuiltInProviders();

module.exports = {
  registerProvider,
  getProvider,
  getChatProvider,
  getEmbedProvider,
  listProviders,
  registerBuiltInProviders,
  ...require('./model-profile'),
  ...require('./model-gateway'),
  protocolConversion: require('./protocol-conversion'),
  streamAggregate: require('./stream-aggregate'),
  protocolUsage: require('./protocol-usage'),
  providerReliability: require('./provider-reliability'),
};
