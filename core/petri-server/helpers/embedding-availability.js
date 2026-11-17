'use strict';

/**
 * embedding 角色可用性（UI-638 加映四）。
 *
 * 旧实现只看 credential_status.dashscope —— 换绑到本地/其它 provider 后会被
 * 误判为不可用（知识空间拒绝启用）。现按「角色绑定 → 档案能力 → provider 是否
 * 必须凭据」判定：本地 provider（ollama/lmstudio/vllm）无需 key。
 */

const CREDENTIAL_REQUIRED_PROVIDERS = new Set(['deepseek', 'openai', 'anthropic', 'dashscope', 'dashscope-vision']);

const { parseModelBinding, resolveModelCapabilities } = require('../../shared-backend/llm-providers/model-profile');

function embeddingRoleAvailable(settings) {
  if (!settings || typeof settings !== 'object') return false;
  // BLOCK-455 — 绑定支持 渠道::模型 对；能力按绑定模型解析（模型级覆写优先）。
  const binding = parseModelBinding(settings.model_role_bindings && settings.model_role_bindings.embedding);
  const profiles = Array.isArray(settings.model_profiles) ? settings.model_profiles : [];
  const profile = profiles.find((item) => item && item.id === binding.profileId);
  if (!profile) return false;
  if (!resolveModelCapabilities(profile, binding.model || profile.model).includes('embedding')) return false;
  const provider = String(profile.provider || '');
  if (!CREDENTIAL_REQUIRED_PROVIDERS.has(provider)) return true;
  return !!(settings.credential_status && settings.credential_status[provider]);
}

module.exports = { embeddingRoleAvailable, CREDENTIAL_REQUIRED_PROVIDERS };
