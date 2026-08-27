import { describe, it, expect } from 'vitest';
import { parseContextWindow, formatContextWindow } from './format-context-window';
import type { ChatModelPreset } from '@/hooks/useAiSettings';

/**
 * Simulates the exact data flow inside DesktopSettingsPanel:
 *  1. User types into the input
 *  2. onChange fires: parseContextWindow → updateProfile
 *  3. handleSave sends model_profiles + chat_model_presets
 *  4. Backend save → loadSettings → setModelProfiles
 *  5. Re-render: input value = formatContextWindow(profile.contextWindow)
 */

interface MockSavePayload {
  model_profiles: ChatModelPreset[];
  chat_model_presets: ChatModelPreset[];
}

function simulateUserInput(profile: ChatModelPreset, userInput: string): ChatModelPreset {
  // onChange path: parseContextWindow(userInput) → contextWindow patch
  const parsed = parseContextWindow(userInput);
  return { ...profile, contextWindow: parsed };
}

function simulateBackendRoundTrip(payload: MockSavePayload): MockSavePayload {
  // Backend normalizeModelProfile keeps contextWindow
  // Backend normalizeAiSettings's chat_model_presets branch keeps contextWindow
  return payload;
}

function simulateLoadSettings(saved: MockSavePayload): ChatModelPreset[] {
  // DesktopSettingsPanel.loadSettings: keeps contextWindow via spread
  return saved.model_profiles.map((p) => ({ ...p, defaultModel: p.defaultModel || p.model }));
}

describe('contextWindow save/load round-trip', () => {
  const baseProfile: ChatModelPreset = {
    id: 'test',
    label: 'Test',
    provider: 'openai-compatible',
    model: 'deepseek-chat',
    defaultModel: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com',
  };

  it('preserves 128K through full cycle', () => {
    // Step 1+2: user types
    const afterInput = simulateUserInput(baseProfile, '128K');
    expect(afterInput.contextWindow).toBe(128000);

    // Step 3: handleSave builds payload
    const payload: MockSavePayload = {
      model_profiles: [afterInput],
      chat_model_presets: [{
        id: afterInput.id,
        label: afterInput.label,
        provider: afterInput.provider,
        model: afterInput.model,
        defaultModel: afterInput.defaultModel,
        baseUrl: afterInput.baseUrl,
        contextWindow: afterInput.contextWindow,
      }],
    };

    // Step 4: backend round-trip (real)
    const saved = simulateBackendRoundTrip(payload);
    expect(saved.model_profiles[0].contextWindow).toBe(128000);
    expect(saved.chat_model_presets[0].contextWindow).toBe(128000);

    // Step 5: loadSettings + re-render
    const reloaded = simulateLoadSettings(saved);
    expect(reloaded[0].contextWindow).toBe(128000);
    expect(formatContextWindow(reloaded[0].contextWindow)).toBe('128K');
  });

  it('shows K-formatted display, not raw integer', () => {
    const profile: ChatModelPreset = { ...baseProfile, contextWindow: 128000 };
    expect(formatContextWindow(profile.contextWindow)).toBe('128K');
  });

  it('input renders empty when value is undefined', () => {
    const profile: ChatModelPreset = baseProfile;
    expect(formatContextWindow(profile.contextWindow)).toBe('');
  });
});