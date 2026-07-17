/**
 * helpers/ai-settings.js — AI 配置本地存储（桌面版）
 *
 * 桌面版用户在设置页填入 API key，存储在本地文件。
 * Web 版不使用此模块（走 process.env.DEEPSEEK_API_KEY / DASHSCOPE_API_KEY）。
 *
 * 文件位置：~/Documents/BioF3-Local/ai-settings.json
 *
 * 安全说明：API key 以明文存储（与 .env 同级别），文档告知用户。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { normalizeModelConfig } = require('../../shared-backend/llm-providers/model-profile');

const SETTINGS_DIR = process.env.BIOF3_LOCAL_DATA_DIR ||
  path.join(os.homedir(), 'Documents', 'BioF3-Local');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'ai-settings.json');

let _cache = null;

const DEFAULT_CHAT_MODEL_PRESETS = [
  {
    id: 'deepseek-chat',
    label: 'DeepSeek Chat',
    provider: 'deepseek',
    model: 'deepseek-chat',
  },
];

function _ensureDir() {
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  } catch {}
}

/**
 * 读取 AI 设置。
 * @returns {object} - { deepseek_api_key, dashscope_api_key, llm_provider, embed_provider, ... }
 */
function getAiSettings() {
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    _cache = {};
  }
  _cache = normalizeAiSettings(_cache);
  return _cache;
}

function normalizeAiSettings(settings) {
  const next = settings && typeof settings === 'object' ? { ...settings } : {};
  const presets = Array.isArray(next.chat_model_presets)
    ? next.chat_model_presets
        .filter((p) => p && typeof p === 'object')
        .map((p) => ({
          id: String(p.id || `${p.provider || 'deepseek'}-${p.model || 'deepseek-chat'}`).trim(),
          label: String(p.label || p.model || p.id || 'DeepSeek Chat').trim(),
          provider: String(p.provider || 'deepseek').trim(),
          model: String(p.model || 'deepseek-chat').trim(),
          baseUrl: p.baseUrl ? String(p.baseUrl).trim() : undefined,
          apiKey: p.apiKey ? String(p.apiKey).trim() : undefined,
        }))
        .filter((p) => p.id && p.label && p.provider && p.model)
    : [];
  next.chat_model_presets = presets.length > 0 ? presets : DEFAULT_CHAT_MODEL_PRESETS;
  if (!next.active_chat_model_id) {
    next.active_chat_model_id = next.chat_model_presets[0].id;
  }
  next.llm_provider = next.llm_provider || next.chat_provider || next.chat_model_presets[0].provider || 'deepseek';
  const modelConfig = normalizeModelConfig(next);
  next.model_profile_schema_version = modelConfig.schemaVersion;
  next.model_profiles = modelConfig.profiles;
  next.model_role_bindings = modelConfig.roleBindings;
  next.model_fallback_enabled = modelConfig.fallbackEnabled;
  next.model_fallback_bindings = modelConfig.fallbackBindings;
  next.model_config_diagnostics = modelConfig.diagnostics;
  next.deepseek_configured = !!(next.deepseek_api_key || process.env.DEEPSEEK_API_KEY);
  next.dashscope_configured = !!(next.dashscope_api_key || process.env.DASHSCOPE_API_KEY);
  return next;
}

function getChatModelPreset(id) {
  const settings = getAiSettings();
  const presets = settings.chat_model_presets || DEFAULT_CHAT_MODEL_PRESETS;
  return presets.find((p) => p.id === id) || presets.find((p) => p.id === settings.active_chat_model_id) || presets[0];
}

/**
 * 获取指定 provider 的 API key。
 * 桌面版：从用户设置文件读。
 * Web 版：fallback 到 process.env。
 *
 * @param {string} provider - 'deepseek' | 'dashscope' | ...
 * @returns {string} - API key 或空字符串
 */
function getApiKey(provider) {
  const settings = getAiSettings();
  const envKey = `${provider.toUpperCase()}_API_KEY`;
  return settings[`${provider}_api_key`] || process.env[envKey] || '';
}

/**
 * 获取 chat provider 名称（桌面版从用户设置读，否则走环境变量）。
 */
function getChatProviderName() {
  const settings = getAiSettings();
  const preset = getChatModelPreset(settings.active_chat_model_id);
  return (preset && preset.provider) || settings.llm_provider || process.env.BIOF3_LLM_PROVIDER || 'deepseek';
}

/**
 * 获取 embed provider 名称。
 */
function getEmbedProviderName() {
  const settings = getAiSettings();
  return settings.embed_provider || process.env.BIOF3_EMBED_PROVIDER || 'dashscope';
}

/**
 * 保存 AI 设置（设置页调用）。
 * @param {object} settings - { deepseek_api_key, dashscope_api_key, ... }
 */
function saveAiSettings(settings) {
  _ensureDir();
  const prev = getAiSettings();
  const merged = { ...prev, ...(settings || {}) };
  // The Stage 1 UI still writes chat_model_presets. When it does not also send
  // model_profiles, rebuild profiles from those presets instead of retaining a
  // stale normalized snapshot from the previous read.
  if (settings && Array.isArray(settings.chat_model_presets) && !Array.isArray(settings.model_profiles)) {
    delete merged.model_profiles;
  }
  if (!settings || !settings.deepseek_api_key) merged.deepseek_api_key = prev.deepseek_api_key;
  if (!settings || !settings.dashscope_api_key) merged.dashscope_api_key = prev.dashscope_api_key;
  _cache = normalizeAiSettings(merged);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(_cache, null, 2));
}

/**
 * 测试 API key 连通性（设置页"测试"按钮调用）。
 */
async function testApiKey(provider, apiKey) {
  if (!apiKey) return { ok: false, message: 'API key 为空' };
  try {
    const { getProvider } = require('../../shared-backend/llm-providers');
    const p = getProvider(provider);
    if (!p) return { ok: false, message: `Provider ${provider} 未注册` };
    if (typeof p.healthCheck === 'function') {
      const ok = await p.healthCheck(apiKey);
      return { ok, message: ok ? '连接正常' : '连接失败' };
    }
    return { ok: true, message: 'Provider 无健康检查，跳过' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

module.exports = {
  getAiSettings,
  getApiKey,
  getChatProviderName,
  getChatModelPreset,
  getEmbedProviderName,
  saveAiSettings,
  testApiKey,
  SETTINGS_FILE,
};
