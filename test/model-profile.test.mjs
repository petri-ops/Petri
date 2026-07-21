import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  MODEL_PROFILE_SCHEMA_VERSION,
  normalizeModelConfig,
  normalizeModelProfile,
  resolveModelProfile,
  validateModelConfig,
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
      defaultModel: 'qwen3-32b',
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

test('explicit profiles are authoritative and do not inject cloud defaults', () => {
  const config = normalizeModelConfig({
    model_profiles: [
      {
        id: 'local-chat',
        provider: 'ollama',
        model: 'qwen3',
        capabilities: ['chat', 'streaming', 'tools'],
      },
    ],
    model_role_bindings: { chat: 'local-chat', agent: 'local-chat' },
  });

  assert.deepEqual(config.profiles.map((profile) => profile.id), ['local-chat']);
  assert.equal(config.roleBindings.chat, 'local-chat');
  assert.ok(config.diagnostics.some((item) => item.code === 'model_role_unbound' && item.role === 'vision'));
});

test('invalid explicit role bindings remain visible instead of silently switching models', () => {
  const config = normalizeModelConfig({
    model_profiles: [
      { id: 'chat-only', provider: 'deepseek', model: 'deepseek-chat', capabilities: ['chat'] },
    ],
    model_role_bindings: { chat: 'missing', agent: 'chat-only' },
  });

  assert.equal(config.roleBindings.chat, 'missing');
  assert.equal(config.roleBindings.agent, 'chat-only');
  assert.equal(resolveModelProfile(config, 'chat').error, 'model_profile_not_found');
  assert.equal(resolveModelProfile(config, 'agent').error, 'model_capability_mismatch');
  assert.deepEqual(
    validateModelConfig(config).filter((item) => item.role === 'chat' || item.role === 'agent').map((item) => item.code),
    ['model_profile_not_found', 'model_capability_mismatch']
  );
});

test('duplicate profile ids resolve deterministically to the first profile', () => {
  const config = normalizeModelConfig({
    model_profiles: [
      { id: 'same', provider: 'ollama', model: 'first', capabilities: ['chat'] },
      { id: 'same', provider: 'openai', model: 'second', capabilities: ['chat'] },
    ],
    model_role_bindings: { chat: 'same' },
  });

  assert.equal(config.profiles.length, 1);
  assert.equal(config.profiles[0].model, 'first');
});

test('fallback policy is disabled by default and diagnoses invalid candidates', () => {
  const config = normalizeModelConfig({
    model_profiles: [
      { id: 'primary', provider: 'openai', model: 'chat-a', capabilities: ['chat'] },
      { id: 'embed', provider: 'dashscope', model: 'embed-a', capabilities: ['embedding'] },
    ],
    model_role_bindings: { chat: 'primary' },
    model_fallback_bindings: { chat: ['primary', 'missing', 'embed'] },
  });

  assert.equal(config.fallbackEnabled, false);
  assert.deepEqual(config.fallbackBindings.chat, ['primary', 'missing', 'embed']);
  assert.deepEqual(
    config.diagnostics.filter((item) => item.role === 'chat' && item.code.startsWith('model_fallback')).map((item) => item.code),
    ['model_fallback_matches_primary', 'model_fallback_not_found', 'model_fallback_capability_mismatch']
  );
});
