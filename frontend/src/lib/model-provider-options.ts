export const USER_MODEL_PROVIDER_OPTIONS = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'openai-compatible', label: '自定义 API' },
] as const;

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
