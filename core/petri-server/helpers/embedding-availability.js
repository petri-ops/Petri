'use strict';

/**
 * embedding 角色可用性（UI-638 加映四）。
 *
 * 旧实现只看 credential_status.dashscope —— 换绑到本地/其它 provider 后会被
 * 误判为不可用（知识空间拒绝启用）。现按「角色绑定 → 档案能力 → provider 是否
 * 必须凭据」判定：本地 provider（ollama/lmstudio/vllm）无需 key。
 */

const CREDENTIAL_REQUIRED_PROVIDERS = new Set(['deepseek', 'openai', 'anthropic', 'dashscope', 'dashscope-vision']);

function embeddingRoleAvailable(settings) {
  if (!settings || typeof settings !== 'object') return false;
  const binding = settings.model_role_bindings && settings.model_role_bindings.embedding;
  const profiles = Array.isArray(settings.model_profiles) ? settings.model_profiles : [];
  const profile = profiles.find((item) => item && item.id === binding);
  if (!profile) return false;
  if (!Array.isArray(profile.capabilities) || !profile.capabilities.includes('embedding')) return false;
  const provider = String(profile.provider || '');
  if (!CREDENTIAL_REQUIRED_PROVIDERS.has(provider)) return true;
  return !!(settings.credential_status && settings.credential_status[provider]);
}

module.exports = { embeddingRoleAvailable, CREDENTIAL_REQUIRED_PROVIDERS };
