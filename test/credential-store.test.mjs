import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCredentialStore } = require('../core/r-server/helpers/credential-store.js');
const {
  _extractCredentialUpdates,
  listAvailableModels,
  testApiKey,
} = require('../core/r-server/helpers/ai-settings.js');
const { registerProvider } = require('../core/shared-backend/llm-providers/index.js');

test('file credential backend separates secrets with owner-only permissions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-credentials-'));
  const store = createCredentialStore({ settingsDir: dir, backend: 'file', platform: 'linux' });
  store.set('OpenAI', 'secret-value');

  assert.equal(store.get('openai'), 'secret-value');
  assert.equal(store.isConfigured('openai'), true);
  // Windows 无 Unix 文件模式语义（chmod 0600 不映射为 mode 位），仅 Unix 校验 owner-only 权限
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(store.filePath).mode & 0o777, 0o600);
  }
  store.remove('openai');
  assert.equal(store.get('openai'), '');
});

test('keychain backend uses provider account without returning command details', () => {
  const calls = [];
  const execFileSync = (command, args) => {
    calls.push({ command, args });
    return args[0] === 'find-generic-password' ? 'keychain-secret\n' : '';
  };
  const store = createCredentialStore({
    settingsDir: '/unused',
    backend: 'keychain',
    platform: 'darwin',
    execFileSync,
  });

  store.set('anthropic', 'new-secret');
  assert.equal(store.get('anthropic'), 'keychain-secret');
  assert.equal(calls[0].command, '/usr/bin/security');
  assert.deepEqual(calls[0].args.slice(0, 6), [
    'add-generic-password', '-U', '-a', 'anthropic', '-s', 'com.biof3.desktop.ai',
  ]);
});

test('credential ids support separate keys for multiple compatible endpoints', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-credentials-'));
  const store = createCredentialStore({ settingsDir: dir, backend: 'file', platform: 'linux' });
  store.set('lab-a', 'key-a');
  store.set('lab-b', 'key-b');
  assert.equal(store.get('lab-a'), 'key-a');
  assert.equal(store.get('lab-b'), 'key-b');
});

test('legacy and profile API keys are stripped before settings persistence', () => {
  const extracted = _extractCredentialUpdates({
    deepseek_api_key: 'deepseek-secret',
    credential_updates: { anthropic: 'anthropic-secret' },
    chat_model_presets: [
      { id: 'lab', provider: 'openai-compatible', model: 'lab-model', apiKey: 'lab-secret' },
    ],
  });

  assert.deepEqual(extracted.credentials, {
    anthropic: 'anthropic-secret',
    deepseek: 'deepseek-secret',
    'openai-compatible': 'lab-secret',
  });
  assert.equal(JSON.stringify(extracted.settings).includes('secret'), false);
  assert.equal(extracted.settings.deepseek_api_key, undefined);
  assert.equal(extracted.settings.chat_model_presets[0].apiKey, undefined);
});

test('connection test uses the configured profile endpoint and supports no-key local providers', async () => {
  let received;
  registerProvider({
    name: 'test-local-profile',
    capabilities: 'chat',
    async healthCheck(apiKey, options) {
      received = { apiKey, options };
      return true;
    },
  });
  const result = await testApiKey({
    id: 'local-a',
    provider: 'test-local-profile',
    model: 'qwen3',
    baseUrl: 'http://127.0.0.1:9999/v1',
    capabilities: ['chat'],
  }, '');

  assert.deepEqual(result, { ok: true, message: '连接正常' });
  assert.equal(received.apiKey, '');
  assert.equal(received.options.baseUrl, 'http://127.0.0.1:9999/v1');
  assert.equal(received.options.model, 'qwen3');
});

test('model discovery passes the endpoint and one-time key without persisting it', async () => {
  let received;
  registerProvider({
    name: 'test-model-discovery',
    capabilities: 'chat',
    async listModels(apiKey, options) {
      received = { apiKey, options };
      return { ok: true, models: ['model-b', 'model-a'], message: '已获取 2 个模型' };
    },
  });

  const result = await listAvailableModels({
    id: 'discovery-a',
    provider: 'test-model-discovery',
    model: '',
    baseUrl: 'http://127.0.0.1:9999/v1',
    credentialRef: 'credential:discovery-a',
    capabilities: ['chat'],
  }, 'one-time-secret');

  assert.deepEqual(result, {
    ok: true,
    models: ['model-b', 'model-a'],
    message: '已获取 2 个模型',
  });
  assert.equal(received.apiKey, 'one-time-secret');
  assert.equal(received.options.baseUrl, 'http://127.0.0.1:9999/v1');
});
