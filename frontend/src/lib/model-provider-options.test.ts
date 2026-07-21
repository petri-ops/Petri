import { describe, expect, it } from 'vitest';
import {
  USER_MODEL_PROVIDER_OPTIONS,
  USER_MODEL_ROLE_IDS,
  endpointBaseUrl,
  inferUserModelProvider,
  isChatSelectableProfile,
  isUserConfigurableModelProvider,
  modelChoiceId,
  modelSupplierName,
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

  it('derives stable supplier labels and unique endpoint/model choice ids', () => {
    expect(modelSupplierName({ provider: 'deepseek', label: 'DeepSeek Chat' })).toBe('DeepSeek');
    expect(modelSupplierName({
      provider: 'openai-compatible',
      label: '火山方舟',
      baseUrl: 'https://ark.example.com/v1',
    })).toBe('火山方舟');
    expect(modelSupplierName({
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
    })).toBe('api.example.com');
    expect(modelChoiceId('endpoint-a', 'model/a')).toBe('endpoint-a::model%2Fa');
  });

  it('infers the transport adapter from the endpoint host', () => {
    expect(inferUserModelProvider({ baseUrl: 'https://api.deepseek.com' })).toBe('deepseek');
    expect(inferUserModelProvider({ baseUrl: 'https://ai.example.com/v1' })).toBe('openai-compatible');
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
    ).toContain('获取并选择模型');
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
