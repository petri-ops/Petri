import { describe, expect, it } from 'vitest';
import {
  USER_MODEL_PROVIDER_OPTIONS,
  USER_MODEL_ROLE_IDS,
  isUserConfigurableModelProvider,
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
});
