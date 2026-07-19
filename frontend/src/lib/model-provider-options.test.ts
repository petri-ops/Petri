import { describe, expect, it } from 'vitest';
import {
  USER_MODEL_PROVIDER_OPTIONS,
  USER_MODEL_ROLE_IDS,
  endpointBaseUrl,
  isChatSelectableProfile,
  isUserConfigurableModelProvider,
  validateUserModelProfile,
} from './model-provider-options';

describe('user-facing model provider options', () => {
  it('only exposes DeepSeek and a custom OpenAI-compatible API', () => {
    expect(USER_MODEL_PROVIDER_OPTIONS).toEqual([
      { value: 'deepseek', label: 'DeepSeek' },
      { value: 'openai-compatible', label: '自定义 API' },
    ]);
  });

  it('keeps system vision and embedding services out of user choices', () => {
    expect(isUserConfigurableModelProvider('deepseek')).toBe(true);
    expect(isUserConfigurableModelProvider('openai-compatible')).toBe(true);
    expect(isUserConfigurableModelProvider('dashscope')).toBe(false);
    expect(isUserConfigurableModelProvider('dashscope-vision')).toBe(false);
    expect(isUserConfigurableModelProvider('anthropic')).toBe(false);
    expect(USER_MODEL_ROLE_IDS).not.toContain('vision');
    expect(USER_MODEL_ROLE_IDS).not.toContain('embedding');
  });

  it('shows the effective URL for each endpoint', () => {
    expect(endpointBaseUrl({ provider: 'deepseek' })).toBe('https://api.deepseek.com');
    expect(
      endpointBaseUrl({
        provider: 'openai-compatible',
        baseUrl: 'https://example.com/v1',
      })
    ).toBe('https://example.com/v1');
    expect(endpointBaseUrl({ provider: 'openai-compatible' })).toBe('');
  });

  it('uses one explicit contract for chat-selectable endpoints', () => {
    expect(
      isChatSelectableProfile({
        id: 'custom',
        provider: 'openai-compatible',
        model: 'custom-chat',
        capabilities: ['chat', 'streaming'],
      })
    ).toBe(true);
    expect(
      isChatSelectableProfile({
        id: 'custom',
        provider: 'openai-compatible',
        model: 'custom-chat',
        capabilities: ['embedding'],
      })
    ).toBe(false);
    expect(
      isChatSelectableProfile({
        id: 'legacy',
        provider: 'anthropic',
        model: 'claude',
        capabilities: ['chat'],
      })
    ).toBe(false);
  });

  it('rejects incomplete custom endpoints instead of silently dropping them', () => {
    expect(
      validateUserModelProfile({
        provider: 'openai-compatible',
        model: '',
        baseUrl: 'https://example.com/v1',
      })
    ).toContain('模型名称');
    expect(
      validateUserModelProfile({
        provider: 'openai-compatible',
        model: 'custom-chat',
      })
    ).toContain('Base URL');
    expect(
      validateUserModelProfile({
        provider: 'openai-compatible',
        model: 'custom-chat',
        baseUrl: 'https://example.com/v1',
      })
    ).toBeNull();
  });
});
