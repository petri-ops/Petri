import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveChatModelCredential } = require('../core/petri-server/helpers/ai-settings');

test('selected custom model resolves its credentialRef before provider fallback', () => {
  const reads = [];
  const secret = resolveChatModelCredential({
    preset: { id: 'custom-model', provider: 'openai-compatible' },
    profiles: [{
      id: 'custom-model',
      provider: 'openai-compatible',
      credentialRef: 'credential:custom-key',
    }],
    getCredential(id) {
      reads.push(id);
      return id === 'custom-key' ? 'resolved-secret' : '';
    },
  });
  assert.equal(secret, 'resolved-secret');
  assert.deepEqual(reads, ['custom-key']);
});

test('built-in provider preset keeps the provider credential fallback', () => {
  const secret = resolveChatModelCredential({
    preset: { id: 'deepseek-chat', provider: 'deepseek' },
    profiles: [{
      id: 'deepseek-chat',
      provider: 'deepseek',
      credentialRef: 'provider:deepseek',
    }],
    getCredential: (id) => id === 'deepseek' ? 'provider-secret' : '',
  });
  assert.equal(secret, 'provider-secret');
});

test('missing profile credential falls back to preset id before provider id', () => {
  const reads = [];
  const secret = resolveChatModelCredential({
    preset: { id: 'custom-model', provider: 'openai-compatible' },
    profiles: [],
    getCredential(id) {
      reads.push(id);
      return id === 'custom-model' ? 'preset-secret' : '';
    },
  });
  assert.equal(secret, 'preset-secret');
  assert.deepEqual(reads, ['custom-model']);
});
