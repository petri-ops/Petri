/**
 * helpers/ai-settings.js — AI 配置本地存储（桌面版）
 *
 * 桌面版用户在设置页填入 API key，密钥由 credential-store 单独保存。
 * Web 版不使用本模块。
 *
 * BLOCK-150 加映（用户裁决 2026-10-09「杜绝走 env 这个就应该显式的设置」）：
 * 凭据唯一来源 = credential store（设置页显式配置）。原 `|| process.env[*_API_KEY]`
 * 兜底路已移除——隐性 env 通道会随栈重启链路漂移（识图时好时坏的根因），
 * 且绕过用户可见的配置面。.petri-secrets 中的 AI key 自此对本模块失活（其余
 * env 用途如 NODE_EXTRA_CA_CERTS 不受影响）。
 *
 * 文件位置：~/Documents/Petri-Local/ai-settings.json
 *
 * ai-settings.json 永不保存或返回明文 API key。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { normalizeModelConfig } = require('../../shared-backend/llm-providers/model-profile');
const { createCredentialStore, normalizeProvider } = require('./credential-store');
// BLOCK-199 P2 — 生成参数形状（类型/区间/取整）取配置 schema 单源，数值语义不在这里复制。
const {
  CONFIG_FAMILIES, findKeyEntry: findConfigKey, validateValue: validateConfigValue, commitGuard: commitGuardConfig,
} = require('../../packages/shared-config/config-schema.js');

const GENERATION_FAMILY = 'generation';
const _generationLookup = (family, path) => (family === GENERATION_FAMILY ? findConfigKey(`generation.${path}`) : null);
const commitGuardGeneration = (patch) => commitGuardConfig(GENERATION_FAMILY, patch, _generationLookup);

const SETTINGS_DIR = process.env.PETRI_LOCAL_DATA_DIR ||
  path.join(os.homedir(), 'Documents', 'Petri-Local');
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
    model: 'deepseek-flash',
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
  // UI-638 加映 — 迁移落盘（仅当磁盘上原本显式写了不同的 vision 绑定；缺省不写）。
  try {
    const disk = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const diskVision = disk && disk.model_role_bindings && disk.model_role_bindings.vision;
    const runtimeVision = _cache && _cache.model_role_bindings && _cache.model_role_bindings.vision;
    if (diskVision && runtimeVision && diskVision !== runtimeVision) {
      disk.model_role_bindings = { ...(disk.model_role_bindings || {}), vision: runtimeVision };
      _ensureDir();
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(disk, null, 2));
      fs.chmodSync(SETTINGS_FILE, 0o600);
    }
  } catch {
    // 落盘失败不阻断读取：运行时绑定已生效，下次保存设置会自然带出。
  }
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
          contextWindow: typeof p.contextWindow === 'number' && p.contextWindow > 0 ? Math.round(p.contextWindow) : undefined,
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
  // UI-638 加映 — 识图默认走 DeepSeek（用户裁决 2026-10-30「软件写定」）：
  // 旧配置把 vision 显式绑到「未配置凭据的 dashscope-vision」时，若 chat 档案
  // 已声明 vision 能力，自动改绑到 chat 档案；chat 无 vision 能力则保持显式
  // 配置真相（resolve 会诚实报 model_capability_mismatch）。落盘见 getAiSettings。
  const visionBinding = next.model_role_bindings && next.model_role_bindings.vision;
  if (visionBinding === 'dashscope-vision' && next.credential_status.dashscope !== true) {
    const chatProfile = next.model_profiles.find(
      (profile) => profile.id === (next.model_role_bindings && next.model_role_bindings.chat),
    );
    if (chatProfile && Array.isArray(chatProfile.capabilities) && chatProfile.capabilities.includes('vision')) {
      next.model_role_bindings = { ...next.model_role_bindings, vision: chatProfile.id };
    }
  }
  return next;
}

/**
 * BLOCK-203 W4a P6 — `ai-settings.json` 顶层键白名单（"磁盘不再长出未知顶层键"）。
 *
 * 为什么**不放进** shared-config 注册表（D-W4a-7，留痕）：这个文件顶层同时装着凭据引用
 * （`credential_status`）、模型 profile 快照与派生态（`model_config_diagnostics` 等）——
 * 把它们的键路径登记进注册表，等于顺手把它们变成"可导出/可重置的配置键"，越 D-2 红线。
 * 顶层白名单属于**文件主人的形状**，真相在产生它的 `normalizeAiSettings`。
 *
 * 派生方式（不手写第二份清单）：
 *  · `normalizeAiSettings({})` 的键 = 该文件被规范化后的**权威输出形状**（随 normalize 自动更新）；
 *  · 注册表里 `store: file:ai-settings.json#<root>` 的 root = 各配置族在该文件里的键袋
 *    （generation / reasoning / costCapCny）。注册表加族时这里自动跟上。
 */
const AI_SETTINGS_REGISTRY_ROOTS = Object.values(CONFIG_FAMILIES)
  .map((family) => /^file:ai-settings\.json#(.+)$/.exec(family.store || ''))
  .filter(Boolean)
  .map((match) => match[1]);
// 历史/派生键显式放行：`chat_provider` 只作 `llm_provider` 缺省时的回落读（GET 会回传它，
// 设置页整坨写回时不该被当成未知键丢掉）；它是派生值，留不留都不影响语义，但"保存一次就少一个键"
// 会让用户在上游改动后突然失去回落路径。
const AI_SETTINGS_LEGACY_TOP_LEVEL_KEYS = ['chat_provider'];
const AI_SETTINGS_TOP_LEVEL_KEYS = new Set([
  ...Object.keys(normalizeAiSettings({})),
  ...AI_SETTINGS_REGISTRY_ROOTS,
  ...AI_SETTINGS_LEGACY_TOP_LEVEL_KEYS,
]);

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
  // BLOCK-150 加映 — 显式配置唯一来源：只读 credential store，不落 env 兜底
  //（用户裁决「杜绝走 env」；env 通道随重启链路漂移是识图时好时坏的根因）。
  return credentialStore.get(normalizeProvider(provider));
}

/**
 * 获取 chat provider 名称（桌面版从用户设置读，否则走环境变量）。
 */
function getChatProviderName() {
  const settings = getAiSettings();
  const preset = getChatModelPreset(settings.active_chat_model_id);
  return (preset && preset.provider) || settings.llm_provider || process.env.PETRI_LLM_PROVIDER || 'deepseek';
}

/**
 * 获取 embed provider 名称。
 */
function getEmbedProviderName() {
  const settings = getAiSettings();
  return settings.embed_provider || process.env.PETRI_EMBED_PROVIDER || 'dashscope';
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
  // BLOCK-203 W4a P6 — 顶层白名单：写进去的未知键不进盘，磁盘上已有的未知键在下一次写入时自愈。
  // 取"过滤 + 诊断"而不是 400（D-W4a-3）：设置页整坨写入会把 GET 回来的键原样回传，
  // 400 会让"有历史脏键的用户保存不了任何设置"。
  const droppedTopLevel = new Set();
  for (const key of Object.keys(merged)) {
    if (AI_SETTINGS_TOP_LEVEL_KEYS.has(key)) continue;
    droppedTopLevel.add(key);
    delete merged[key];
  }
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
  return {
    dropped: [...droppedTopLevel].map((key) => ({
      code: 'unknown-key', family: 'ai-settings-root', path: key, message: `未注册的顶层键 ${key}（已丢弃，不写盘）`,
    })),
  };
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

/**
 * BLOCK-172 CP-7 — 生成参数全局缺省（temperature/maxTokens）。
 * 来源优先级：env 覆盖 > ai-settings.json `generation` 键 > 缺省（loop 侧 0.4/16384）。
 * 诚实边界：仅收数值域合法值；maxTokens 下限 256 防误配物理截断。
 * BLOCK-199 P2 — 形状（类型/区间/取整）改由 shared-config schema 单源声明；**胜负保持原样**：
 * env 一旦"存在"就赢（哪怕值非法也直接丢键，不回落到文件），这条不是设计而是现状，
 * 由拆前基线 test/block199-config-compat.test.mjs 冻结。
 */
function _pickGenerationValue(entryKey, envVarName, fileValue) {
  const entry = findConfigKey(entryKey);
  const envRaw = process.env[envVarName];
  if (envRaw == null) return validateConfigValue(entry, fileValue);
  return validateConfigValue(entry, envRaw);
}

function _sanitizeGeneration(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  const temperature = _pickGenerationValue('generation.temperature', 'PETRI_LLM_TEMPERATURE', source.temperature);
  if (temperature.ok) out.temperature = temperature.normalized;
  const maxTokens = _pickGenerationValue('generation.maxTokens', 'PETRI_LLM_MAX_TOKENS', source.maxTokens);
  if (maxTokens.ok) out.maxTokens = maxTokens.normalized;
  return out;
}

function getGenerationDefaults() {
  const stored = getAiSettings();
  return _sanitizeGeneration(stored && typeof stored === 'object' ? stored.generation : null);
}

function saveGenerationDefaults(partial) {
  // BLOCK-199 P3 — 写侧统一守卫：只校验**提交来的值**（不再把 env 混进写路径的裁剪），
  // 非法/未知键一律拒绝并带结构化诊断；`null` 仍是清键语义。
  // 这是本包里唯一有意改变的既有行为：原先非法值被静默丢键（用户以为保存了），现在改 400。
  const patch = {};
  for (const key of ['temperature', 'maxTokens']) {
    if (partial && typeof partial === 'object' && Object.prototype.hasOwnProperty.call(partial, key)) patch[key] = partial[key];
  }
  const guard = commitGuardGeneration(patch);
  if (!guard.ok) {
    const err = new Error(`config_value_rejected: ${guard.diagnostics.map((d) => `${d.path}：${d.message}`).join('；')}`);
    err.code = 'config_value_rejected';
    err.diagnostics = guard.diagnostics;
    throw err;
  }
  const stored = getAiSettings() || {};
  const generation = { ...(stored.generation || {}) };
  for (const key of Object.keys(patch)) {
    if (patch[key] === null) delete generation[key];
    else if (guard.normalized[key] !== undefined) generation[key] = guard.normalized[key];
  }
  const next = { ...stored, generation };
  _ensureDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  fs.chmodSync(SETTINGS_FILE, 0o600);
  _cache = next;
  _cacheSignature = _settingsFileSignature();
  return getGenerationDefaults();
}

/**
 * 推理档位段（BLOCK-200 P2）。**写盘原语留在本模块**——`ai-settings.json` 的写入者只能有一个
 * （generation 与 reasoning 同文件，另起一个 read-modify-write 就是并发覆盖通道）。
 * 形状/取值校验不在这里做（那是 `helpers/reasoning-config.js` 过 shared-config 注册表的事），
 * 本函数只负责"把已批准的段落到盘上并刷新缓存"。
 */
function saveReasoningSection(section) {
  const stored = getAiSettings() || {};
  const next = { ...stored, reasoning: section && typeof section === 'object' ? section : {} };
  _ensureDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  fs.chmodSync(SETTINGS_FILE, 0o600);
  _cache = next;
  _cacheSignature = _settingsFileSignature();
  return next.reasoning;
}

module.exports = {
  AI_SETTINGS_TOP_LEVEL_KEYS,
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
  getGenerationDefaults,
  saveGenerationDefaults,
  saveReasoningSection,
  resolveChatModelCredential,
  _extractCredentialUpdates,
  credentialStore,
  SETTINGS_FILE,
};
