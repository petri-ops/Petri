export const USER_MODEL_PROVIDER_OPTIONS = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'openai-compatible', label: 'OpenAI 兼容' },
  { value: 'anthropic', label: 'Anthropic 原生' },
] as const;

export type UserModelProvider = (typeof USER_MODEL_PROVIDER_OPTIONS)[number]['value'];

export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com';
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';

const USER_MODEL_PROVIDERS = new Set<string>(
  USER_MODEL_PROVIDER_OPTIONS.map((option) => option.value)
);

export const USER_MODEL_ROLE_IDS = [
  'chat',
  'agent',
  'planner',
  'summary',
  'report',
  'explanation',
] as const;

export function isUserConfigurableModelProvider(provider: string): boolean {
  return USER_MODEL_PROVIDERS.has(provider);
}

export function endpointBaseUrl(profile: {
  provider: string;
  baseUrl?: string;
}): string {
  if (profile.baseUrl) return profile.baseUrl;
  if (profile.provider === 'deepseek') return DEEPSEEK_DEFAULT_BASE_URL;
  if (profile.provider === 'anthropic') return ANTHROPIC_DEFAULT_BASE_URL;
  return '';
}

export function modelSupplierName(profile: {
  provider: string;
  label?: string;
  baseUrl?: string;
}): string {
  if (profile.provider === 'deepseek') return 'DeepSeek';
  if (profile.provider === 'anthropic') return profile.label?.trim() || 'Anthropic';
  if (profile.label?.trim()) return profile.label.trim();
  try {
    return profile.baseUrl ? new URL(profile.baseUrl).hostname : '自定义 API';
  } catch {
    return '自定义 API';
  }
}

export function modelChoiceId(profileId: string, model: string): string {
  return `${profileId}::${encodeURIComponent(model)}`;
}

/** Infer the transport adapter from the endpoint instead of exposing it in UI. */
export function inferUserModelProvider(profile: {
  label?: string;
  baseUrl?: string;
}): UserModelProvider {
  try {
    const hostname = profile.baseUrl ? new URL(profile.baseUrl).hostname.toLowerCase() : '';
    if (hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) return 'deepseek';
    if (hostname === 'api.anthropic.com' || hostname.endsWith('.anthropic.com')) return 'anthropic';
  } catch {
    // Validation reports malformed URLs separately; keep the generic adapter here.
  }
  return 'openai-compatible';
}

export function modelProviderProtocol(provider: string): 'anthropic-messages' | 'openai-compatible' {
  return provider === 'anthropic' ? 'anthropic-messages' : 'openai-compatible';
}

export function modelProviderRequiresCredential(provider: string): boolean {
  return provider === 'deepseek' || provider === 'anthropic';
}

function credentialScope(profileId: string): string {
  const normalized = profileId.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 64);
  return normalized || 'model';
}

export function modelProviderCredentialRef(
  provider: UserModelProvider,
  profileId: string
): string {
  if (provider === 'deepseek') return 'provider:deepseek';
  return `credential:${credentialScope(profileId)}-${provider}`;
}

export interface UserModelProfileLike {
  id?: string;
  provider?: string;
  model?: string;
  defaultModel?: string;
  baseUrl?: string;
  capabilities?: string[];
}

export function isChatSelectableProfile(profile: UserModelProfileLike): boolean {
  return Boolean(
    profile.id?.trim() &&
      profile.model?.trim() &&
      profile.provider &&
      isUserConfigurableModelProvider(profile.provider) &&
      (!Array.isArray(profile.capabilities) || profile.capabilities.includes('chat'))
  );
}

export function validateUserModelProfile(
  profile: UserModelProfileLike
): string | null {
  if (!profile.model?.trim()) return '请先从 API 获取并选择模型，保存后才能在聊天中选择。';
  if (profile.provider && isUserConfigurableModelProvider(profile.provider)) {
    const baseUrl = endpointBaseUrl({ provider: profile.provider, baseUrl: profile.baseUrl });
    if (!baseUrl.trim()) return '自定义 API 必须填写 Base URL。';
    try {
      const url = new URL(baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return 'Base URL 必须使用 http 或 https。';
      }
    } catch {
      return 'Base URL 格式不正确。';
    }
  }
  return null;
}
