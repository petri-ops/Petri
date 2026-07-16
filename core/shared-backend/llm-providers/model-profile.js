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
    credentialRef: _cleanString(input.credentialRef) || `provider:${provider.replace(/-vision$/, '')}`,
    capabilities: capabilities.length ? capabilities : inferredCapabilities,
    roles,
    parameters,
  };
  const baseUrl = _cleanString(input.baseUrl);
  if (baseUrl) normalized.baseUrl = baseUrl.replace(/\/$/, '');
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
  const profiles = candidates.map(normalizeModelProfile).filter(Boolean);
  const ids = new Set(profiles.map((profile) => profile.id));
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
    const requestedProfile = requested && byId.get(requested);
    if (requestedProfile && requestedProfile.capabilities.includes(capability)) {
      bindings[role] = requestedProfile.id;
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

function normalizeModelConfig(settings) {
  const profiles = normalizeModelProfiles(settings);
  return {
    schemaVersion: MODEL_PROFILE_SCHEMA_VERSION,
    profiles,
    roleBindings: normalizeRoleBindings(settings, profiles),
  };
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
  normalizeModelConfig,
  resolveModelProfile,
};
