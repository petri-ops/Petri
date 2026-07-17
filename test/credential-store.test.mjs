import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCredentialStore } = require('../core/r-server/helpers/credential-store.js');
const { _extractCredentialUpdates } = require('../core/r-server/helpers/ai-settings.js');

test('file credential backend separates secrets with owner-only permissions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-credentials-'));
  const store = createCredentialStore({ settingsDir: dir, backend: 'file', platform: 'linux' });
  store.set('OpenAI', 'secret-value');

  assert.equal(store.get('openai'), 'secret-value');
  assert.equal(store.isConfigured('openai'), true);
  assert.equal(fs.statSync(store.filePath).mode & 0o777, 0o600);
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
