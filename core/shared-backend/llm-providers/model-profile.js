/**
 * ModelProfile v1 contract.
 *
 * This module is intentionally transport-agnostic. It normalizes persisted
 * configuration and resolves task roles before the Model Gateway chooses a
 * provider adapter. Execution jobs and artifact persistence do not depend on
 * this contract.
 */

const MODEL_PROFILE_SCHEMA_VERSION = 1;

const MODEL_CAPABILITIES = Object.freeze([
  'chat',
  'streaming',
  'tools',
  'vision',
  'embedding',
  'reasoning',
]);

const MODEL_ROLES = Object.freeze([
  'chat',
  'agent',
  'planner',
  'vision',
  'embedding',
  'summary',
  'report',
  'explanation',
]);

const ROLE_CAPABILITY = Object.freeze({
  chat: 'chat',
  agent: 'tools',
  planner: 'chat',
  vision: 'vision',
  embedding: 'embedding',
  summary: 'chat',
  report: 'chat',
  explanation: 'chat',
});

const DEFAULT_MODEL_PROFILES = Object.freeze([
  Object.freeze({
    schemaVersion: MODEL_PROFILE_SCHEMA_VERSION,
    id: 'deepseek-chat',
    label: 'DeepSeek Chat',
    provider: 'deepseek',
    protocol: 'openai-compatible',
    model: 'deepseek-chat',
    credentialRef: 'provider:deepseek',
    capabilities: Object.freeze(['chat', 'streaming', 'tools']),
    roles: Object.freeze(['chat', 'agent', 'planner', 'summary', 'report', 'explanation']),
    parameters: Object.freeze({}),
  }),
  Object.freeze({
    schemaVersion: MODEL_PROFILE_SCHEMA_VERSION,
    id: 'dashscope-vision',
    label: 'Qwen VL Max',
    provider: 'dashscope-vision',
    protocol: 'dashscope-native',
    model: 'qwen-vl-max',
    credentialRef: 'provider:dashscope',
    capabilities: Object.freeze(['vision']),
    roles: Object.freeze(['vision']),
    parameters: Object.freeze({}),
  }),
  Object.freeze({
    schemaVersion: MODEL_PROFILE_SCHEMA_VERSION,
    id: 'dashscope-embedding',
    label: 'DashScope Embedding',
    provider: 'dashscope',
    protocol: 'dashscope-native',
    model: 'text-embedding-v3',
    credentialRef: 'provider:dashscope',
    capabilities: Object.freeze(['embedding']),
    roles: Object.freeze(['embedding']),
    parameters: Object.freeze({}),
  }),
]);

const DEFAULT_MODEL_ROLE_BINDINGS = Object.freeze({
  chat: 'deepseek-chat',
  agent: 'deepseek-chat',
  planner: 'deepseek-chat',
  vision: 'dashscope-vision',
  embedding: 'dashscope-embedding',
  summary: 'deepseek-chat',
  report: 'deepseek-chat',
  explanation: 'deepseek-chat',
});

function _cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function _uniqueKnown(values, known) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(_cleanString).filter((value) => value && known.includes(value)))];
}

function inferProtocol(provider) {
  if (provider === 'dashscope' || provider === 'dashscope-vision') return 'dashscope-native';
  if (provider === 'anthropic') return 'anthropic-messages';
  return 'openai-compatible';
}

function inferCapabilities(provider) {
  if (provider === 'dashscope') return ['embedding'];
  if (provider === 'dashscope-vision') return ['vision'];
  return ['chat', 'streaming', 'tools'];
}

function normalizeModelProfile(input, index = 0) {
  if (!input || typeof input !== 'object') return null;
  const provider = _cleanString(input.provider) || 'deepseek';
  const model = _cleanString(input.model);
  if (!model) return null;
  const defaultModel = _cleanString(input.defaultModel) || model;
  const id = _cleanString(input.id) || `${provider}-${model}-${index + 1}`;
  const inferredCapabilities = inferCapabilities(provider);
  const capabilities = _uniqueKnown(input.capabilities, MODEL_CAPABILITIES);
  const roles = _uniqueKnown(input.roles, MODEL_ROLES);
  const parameters = input.parameters && typeof input.parameters === 'object' && !Array.isArray(input.parameters)
    ? { ...input.parameters }
    : {};
  const normalized = {
    schemaVersion: MODEL_PROFILE_SCHEMA_VERSION,
    id,
    label: _cleanString(input.label) || model,
    provider,
    protocol: _cleanString(input.protocol) || inferProtocol(provider),
    model,
    defaultModel,
    credentialRef: _cleanString(input.credentialRef) || `provider:${provider.replace(/-vision$/, '')}`,
    capabilities: capabilities.length ? capabilities : inferredCapabilities,
    roles,
    parameters,
  };
  const baseUrl = _cleanString(input.baseUrl);
  if (baseUrl) normalized.baseUrl = baseUrl.replace(/\/$/, '');
  const contextWindow = typeof input.contextWindow === 'number' && input.contextWindow > 0
    ? Math.round(input.contextWindow)
    : undefined;
  if (contextWindow !== undefined) normalized.contextWindow = contextWindow;
  return normalized;
}

function legacyPresetToProfile(preset, index = 0) {
  if (!preset || typeof preset !== 'object') return null;
  return normalizeModelProfile(
    {
      ...preset,
      protocol: preset.protocol || inferProtocol(preset.provider),
      capabilities: preset.capabilities || inferCapabilities(preset.provider),
    },
    index
  );
}

function normalizeModelProfiles(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const supplied = Array.isArray(source.model_profiles) ? source.model_profiles : [];
  const legacy = Array.isArray(source.chat_model_presets) ? source.chat_model_presets : [];
  const candidates = supplied.length ? supplied : legacy.map(legacyPresetToProfile);
  const profiles = [];
  const ids = new Set();
  for (const candidate of candidates) {
    const profile = normalizeModelProfile(candidate, profiles.length);
    if (!profile || ids.has(profile.id)) continue;
    profiles.push(profile);
    ids.add(profile.id);
  }
  // Defaults are a first-run / legacy migration aid only. Once a caller saves
  // explicit ModelProfiles, that list is authoritative: silently adding cloud
  // models would make the model-management UI lie about what is configured.
  if (supplied.length) return profiles;
  for (const defaultProfile of DEFAULT_MODEL_PROFILES) {
    const capability = defaultProfile.capabilities[0];
    if (!profiles.some((profile) => profile.capabilities.includes(capability))) {
      profiles.push(normalizeModelProfile(defaultProfile));
      ids.add(defaultProfile.id);
    }
  }
  return profiles;
}

function normalizeRoleBindings(settings, profiles) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const supplied = source.model_role_bindings && typeof source.model_role_bindings === 'object'
    ? source.model_role_bindings
    : {};
  const activeChatId = _cleanString(source.active_chat_model_id);
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const bindings = {};
  for (const role of MODEL_ROLES) {
    const requested = _cleanString(supplied[role]) || (role === 'chat' ? activeChatId : undefined);
    const capability = ROLE_CAPABILITY[role];
    // An explicit binding is configuration truth, even when invalid. Preserve
    // it so resolution returns a visible diagnostic instead of silently using
    // another model for the task.
    if (requested) {
      bindings[role] = requested;
      continue;
    }
    const defaultId = DEFAULT_MODEL_ROLE_BINDINGS[role];
    const defaultProfile = byId.get(defaultId);
    const fallback = defaultProfile && defaultProfile.capabilities.includes(capability)
      ? defaultProfile
      : profiles.find((profile) => profile.capabilities.includes(capability));
    if (fallback) bindings[role] = fallback.id;
  }
  return bindings;
}

function normalizeFallbackBindings(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const supplied = source.model_fallback_bindings && typeof source.model_fallback_bindings === 'object'
    ? source.model_fallback_bindings
    : {};
  const bindings = {};
  for (const role of MODEL_ROLES) {
    const values = Array.isArray(supplied[role]) ? supplied[role] : [];
    const ids = [...new Set(values.map(_cleanString).filter(Boolean))];
    if (ids.length) bindings[role] = ids;
  }
  return bindings;
}

function normalizeModelConfig(settings) {
  const profiles = normalizeModelProfiles(settings);
  const config = {
    schemaVersion: MODEL_PROFILE_SCHEMA_VERSION,
    profiles,
    roleBindings: normalizeRoleBindings(settings, profiles),
    fallbackEnabled: settings && settings.model_fallback_enabled === true,
    fallbackBindings: normalizeFallbackBindings(settings),
  };
  return { ...config, diagnostics: validateModelConfig(config) };
}

function validateModelConfig(config) {
  const diagnostics = [];
  const profiles = config && Array.isArray(config.profiles) ? config.profiles : [];
  const roleBindings = config && config.roleBindings && typeof config.roleBindings === 'object'
    ? config.roleBindings
    : {};
  const fallbackBindings = config && config.fallbackBindings && typeof config.fallbackBindings === 'object'
    ? config.fallbackBindings
    : {};
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));

  for (const role of MODEL_ROLES) {
    const profileId = _cleanString(roleBindings[role]);
    if (!profileId) {
      diagnostics.push({
        code: 'model_role_unbound',
        role,
        message: `模型角色尚未绑定: ${role}`,
      });
      continue;
    }
    const profile = byId.get(profileId);
    if (!profile) {
      diagnostics.push({
        code: 'model_profile_not_found',
        role,
        profileId,
        message: `模型角色 ${role} 绑定了不存在的配置: ${profileId}`,
      });
      continue;
    }
    const capability = ROLE_CAPABILITY[role];
    if (!profile.capabilities.includes(capability)) {
      diagnostics.push({
        code: 'model_capability_mismatch',
        role,
        profileId,
        requiredCapability: capability,
        message: `模型 ${profile.label} 不支持 ${capability} 能力（任务角色: ${role}）`,
      });
    }

    for (const fallbackId of fallbackBindings[role] || []) {
      const fallback = byId.get(fallbackId);
      if (fallbackId === profileId) {
        diagnostics.push({
          code: 'model_fallback_matches_primary',
          role,
          profileId: fallbackId,
          message: `模型角色 ${role} 的 fallback 与主模型相同: ${fallbackId}`,
        });
      } else if (!fallback) {
        diagnostics.push({
          code: 'model_fallback_not_found',
          role,
          profileId: fallbackId,
          message: `模型角色 ${role} 的 fallback 不存在: ${fallbackId}`,
        });
      } else if (!fallback.capabilities.includes(capability)) {
        diagnostics.push({
          code: 'model_fallback_capability_mismatch',
          role,
          profileId: fallbackId,
          requiredCapability: capability,
          message: `Fallback 模型 ${fallback.label} 不支持 ${capability} 能力（任务角色: ${role}）`,
        });
      }
    }
  }
  return diagnostics;
}

function resolveModelProfile(config, role, requestedId) {
  if (!MODEL_ROLES.includes(role)) {
    return { error: 'unknown_model_role', message: `未知模型角色: ${role}` };
  }
  const profiles = config && Array.isArray(config.profiles) ? config.profiles : [];
  const id = _cleanString(requestedId) || (config && config.roleBindings && config.roleBindings[role]);
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!profile) {
    return { error: 'model_profile_not_found', message: `模型配置不存在: ${id || role}` };
  }
  const required = ROLE_CAPABILITY[role];
  if (!profile.capabilities.includes(required)) {
    return {
      error: 'model_capability_mismatch',
      message: `模型 ${profile.label} 不支持 ${required} 能力（任务角色: ${role}）`,
      profile,
      requiredCapability: required,
    };
  }
  return { profile, requiredCapability: required };
}

module.exports = {
  MODEL_PROFILE_SCHEMA_VERSION,
  MODEL_CAPABILITIES,
  MODEL_ROLES,
  ROLE_CAPABILITY,
  DEFAULT_MODEL_PROFILES,
  DEFAULT_MODEL_ROLE_BINDINGS,
  inferProtocol,
  inferCapabilities,
  normalizeModelProfile,
  legacyPresetToProfile,
  normalizeFallbackBindings,
  normalizeModelConfig,
  validateModelConfig,
  resolveModelProfile,
};
