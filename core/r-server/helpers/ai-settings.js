/**
 * helpers/ai-settings.js — AI 配置本地存储（桌面版）
 *
 * 桌面版用户在设置页填入 API key，密钥由 credential-store 单独保存。
 * Web 版不使用此模块（走 process.env.DEEPSEEK_API_KEY / DASHSCOPE_API_KEY）。
 *
 * 文件位置：~/Documents/BioF3-Local/ai-settings.json
 *
 * ai-settings.json 永不保存或返回明文 API key。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { normalizeModelConfig } = require('../../shared-backend/llm-providers/model-profile');
const { createCredentialStore, normalizeProvider } = require('./credential-store');

const SETTINGS_DIR = process.env.BIOF3_LOCAL_DATA_DIR ||
  path.join(os.homedir(), 'Documents', 'BioF3-Local');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'ai-settings.json');
const credentialStore = createCredentialStore({ settingsDir: SETTINGS_DIR });

let _cache = null;
let _cacheSignature = null;

function _settingsFileSignature() {
  try {
    const stat = fs.statSync(SETTINGS_FILE);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

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
 * @returns {object} - ModelProfiles, role bindings, credential status and non-secret preferences.
 */
function getAiSettings() {
  const signature = _settingsFileSignature();
  if (_cache && signature === _cacheSignature) return _cache;
  try {
    const stored = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const migrated = _extractCredentialUpdates(stored);
    for (const [provider, secret] of Object.entries(migrated.credentials)) {
      credentialStore.set(provider, secret);
    }
    _cache = migrated.settings;
    if (Object.keys(migrated.credentials).length) {
      _ensureDir();
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(_cache, null, 2));
      fs.chmodSync(SETTINGS_FILE, 0o600);
    }
  } catch {
    // Another desktop process may be between truncate/write while saving.
    // Keep the last valid snapshot and retry on the next read instead of
    // briefly replacing the live Gateway configuration with defaults.
    if (_cache) return _cache;
    _cache = {};
  }
  _cache = normalizeAiSettings(_cache);
  _cacheSignature = _settingsFileSignature();
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
  const providers = [...new Set(modelConfig.profiles.map((profile) => {
    const ref = String(profile.credentialRef || '');
    const separator = ref.indexOf(':');
    return normalizeProvider(separator >= 0 ? ref.slice(separator + 1) : (ref || profile.provider));
  }))];
  next.credential_backend = credentialStore.backend;
  next.credential_status = Object.fromEntries(providers.map((provider) => [provider, !!getApiKey(provider)]));
  next.deepseek_configured = !!next.credential_status.deepseek;
  next.dashscope_configured = !!next.credential_status.dashscope;
  return next;
}

function _extractCredentialUpdates(input) {
  const settings = input && typeof input === 'object' ? { ...input } : {};
  const credentials = {};
  const explicit = settings.credential_updates && typeof settings.credential_updates === 'object'
    ? settings.credential_updates
    : {};
  for (const [provider, secret] of Object.entries(explicit)) {
    if (secret) credentials[normalizeProvider(provider)] = String(secret).trim();
  }
  delete settings.credential_updates;
  for (const key of Object.keys(settings)) {
    if (!key.endsWith('_api_key')) continue;
    const secret = settings[key];
    if (secret) credentials[normalizeProvider(key.slice(0, -'_api_key'.length))] = String(secret).trim();
    delete settings[key];
  }
  if (Array.isArray(settings.chat_model_presets)) {
    settings.chat_model_presets = settings.chat_model_presets.map((preset) => {
      if (!preset || typeof preset !== 'object') return preset;
      const { apiKey, ...safePreset } = preset;
      if (apiKey && safePreset.provider) {
        credentials[normalizeProvider(safePreset.provider)] = String(apiKey).trim();
      }
      return safePreset;
    });
  }
  return { settings, credentials };
}

function getChatModelPreset(id) {
  const settings = getAiSettings();
  const presets = settings.chat_model_presets || DEFAULT_CHAT_MODEL_PRESETS;
  return presets.find((p) => p.id === id) || presets.find((p) => p.id === settings.active_chat_model_id) || presets[0];
}

function resolveChatModelCredential({ preset, profiles, getCredential }) {
  const selected = preset && typeof preset === 'object' ? preset : {};
  const profile = (Array.isArray(profiles) ? profiles : [])
    .find((item) => item && item.id === selected.id);
  const ref = String(profile?.credentialRef || '');
  const refId = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref;
  const candidates = [refId, selected.id, selected.provider]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((value) => normalizeProvider(value));
  for (const credentialId of [...new Set(candidates)]) {
    const secret = getCredential(credentialId);
    if (secret) return secret;
  }
  return '';
}

function getChatModelCredential(preset) {
  const settings = getAiSettings();
  return resolveChatModelCredential({
    preset,
    profiles: settings.model_profiles,
    getCredential: getApiKey,
  });
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
  const id = normalizeProvider(provider);
  const envKey = `${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
  return credentialStore.get(id) || process.env[envKey] || '';
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
 * @param {object} settings - ordinary settings plus optional one-way credential_updates.
 */
function saveAiSettings(settings) {
  _ensureDir();
  const prev = getAiSettings();
  const extracted = _extractCredentialUpdates(settings);
  for (const [provider, secret] of Object.entries(extracted.credentials)) {
    credentialStore.set(provider, secret);
  }
  const merged = { ...prev, ...extracted.settings };
  // The Stage 1 UI still writes chat_model_presets. When it does not also send
  // model_profiles, rebuild profiles from those presets instead of retaining a
  // stale normalized snapshot from the previous read.
  if (extracted.settings && Array.isArray(extracted.settings.chat_model_presets) && !Array.isArray(extracted.settings.model_profiles)) {
    delete merged.model_profiles;
  }
  _cache = normalizeAiSettings(merged);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(_cache, null, 2));
  fs.chmodSync(SETTINGS_FILE, 0o600);
  _cacheSignature = _settingsFileSignature();
}

/**
 * 测试 API key 连通性（设置页"测试"按钮调用）。
 */
async function testApiKey(provider, apiKey) {
  try {
    const { getProvider } = require('../../shared-backend/llm-providers');
    const { normalizeModelProfile } = require('../../shared-backend/llm-providers/model-profile');
    const profile = typeof provider === 'object'
      ? normalizeModelProfile(provider)
      : normalizeModelProfile({ provider, model: 'connection-test' });
    if (!profile) return { ok: false, message: '模型配置无效' };
    const p = getProvider(profile.provider);
    if (!p) return { ok: false, message: `Provider ${profile.provider} 未注册` };
    if (typeof p.healthCheck === 'function') {
      const ref = String(profile.credentialRef || `provider:${profile.provider.replace(/-vision$/, '')}`);
      const credentialId = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref;
      const resolvedKey = apiKey || getApiKey(credentialId);
      const ok = await p.healthCheck(resolvedKey || '', {
        baseUrl: profile.baseUrl,
        model: profile.model,
        profile,
      });
      return { ok, message: ok ? '连接正常' : '连接失败' };
    }
    return { ok: true, message: 'Provider 无健康检查，跳过' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

/**
 * 从 DeepSeek 或 OpenAI-compatible Endpoint 获取可用模型。
 * Key 仅作为一次性 IPC 参数或从凭据存储解析，不写入设置快照。
 */
async function listAvailableModels(provider, apiKey) {
  try {
    const { getProvider } = require('../../shared-backend/llm-providers');
    const { normalizeModelProfile } = require('../../shared-backend/llm-providers/model-profile');
    const input = typeof provider === 'object'
      ? { ...provider, model: provider.model || 'model-discovery' }
      : { provider, model: 'model-discovery' };
    const profile = normalizeModelProfile(input);
    if (!profile) return { ok: false, models: [], message: '模型接口配置无效' };
    const p = getProvider(profile.provider);
    if (!p) return { ok: false, models: [], message: `Provider ${profile.provider} 未注册` };
    if (typeof p.listModels !== 'function') {
      return { ok: false, models: [], message: `Provider ${profile.provider} 不支持模型列表查询` };
    }
    const ref = String(profile.credentialRef || `provider:${profile.provider.replace(/-vision$/, '')}`);
    const credentialId = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref;
    const resolvedKey = apiKey || getApiKey(credentialId);
    const result = await p.listModels(resolvedKey || '', {
      baseUrl: profile.baseUrl,
      profile,
    });
    const models = Array.isArray(result && result.models)
      ? [...new Set(result.models.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 1000)
      : [];
    return {
      ok: result && result.ok === true && models.length > 0,
      models,
      message: (result && result.message) || (models.length > 0 ? `已获取 ${models.length} 个模型` : '接口未返回可用模型'),
    };
  } catch (e) {
    return { ok: false, models: [], message: e.message };
  }
}

module.exports = {
  getAiSettings,
  getApiKey,
  getChatProviderName,
  getChatModelPreset,
  getChatModelCredential,
  getEmbedProviderName,
  saveAiSettings,
  testApiKey,
  listAvailableModels,
  normalizeAiSettings,
  resolveChatModelCredential,
  _extractCredentialUpdates,
  credentialStore,
  SETTINGS_FILE,
};
