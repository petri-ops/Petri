import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  MODEL_PROFILE_SCHEMA_VERSION,
  normalizeModelConfig,
  normalizeModelProfile,
  resolveModelProfile,
} = require('../core/shared-backend/llm-providers/model-profile.js');

test('ModelProfile v1 normalizes an OpenAI-compatible custom model', () => {
  assert.deepEqual(
    normalizeModelProfile({
      id: 'lab-model',
      label: 'Lab Model',
      provider: 'openai-compatible',
      model: 'qwen3-32b',
      baseUrl: 'http://127.0.0.1:8000/v1/',
      credentialRef: 'provider:lab',
      capabilities: ['chat', 'streaming', 'tools', 'unknown'],
      roles: ['chat', 'agent', 'invalid'],
    }),
    {
      schemaVersion: MODEL_PROFILE_SCHEMA_VERSION,
      id: 'lab-model',
      label: 'Lab Model',
      provider: 'openai-compatible',
      protocol: 'openai-compatible',
      model: 'qwen3-32b',
      baseUrl: 'http://127.0.0.1:8000/v1',
      credentialRef: 'provider:lab',
      capabilities: ['chat', 'streaming', 'tools'],
      roles: ['chat', 'agent'],
      parameters: {},
    }
  );
});

test('legacy chat presets migrate without persisting their inline apiKey', () => {
  const config = normalizeModelConfig({
    chat_model_presets: [
      {
        id: 'legacy',
        label: 'Legacy',
        provider: 'deepseek',
        model: 'deepseek-chat',
        apiKey: 'must-not-enter-profile',
      },
    ],
    active_chat_model_id: 'legacy',
  });

  const profile = config.profiles.find((item) => item.id === 'legacy');
  assert.equal(profile.apiKey, undefined);
  assert.equal(profile.credentialRef, 'provider:deepseek');
  assert.equal(config.roleBindings.chat, 'legacy');
  assert.ok(config.profiles.some((item) => item.capabilities.includes('vision')));
  assert.ok(config.profiles.some((item) => item.capabilities.includes('embedding')));
});

test('role resolution rejects a profile without the required capability', () => {
  const config = normalizeModelConfig({
    model_profiles: [
      {
        id: 'chat-only',
        provider: 'deepseek',
        model: 'deepseek-chat',
        capabilities: ['chat'],
      },
    ],
    model_role_bindings: { chat: 'chat-only', agent: 'chat-only' },
  });

  assert.equal(resolveModelProfile(config, 'chat').profile.id, 'chat-only');
  assert.equal(resolveModelProfile(config, 'agent', 'chat-only').error, 'model_capability_mismatch');
});

test('invalid role is diagnosed before a provider call', () => {
  const result = resolveModelProfile(normalizeModelConfig({}), 'unknown-role');
  assert.equal(result.error, 'unknown_model_role');
});
