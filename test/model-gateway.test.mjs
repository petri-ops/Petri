import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ModelGateway } = require('../core/shared-backend/llm-providers/model-gateway.js');

function createGateway(overrides = {}) {
  const calls = [];
  const provider = {
    async chat(apiKey, body, telemetry, options) {
      calls.push({ method: 'chat', apiKey, body, telemetry, options });
      return { choices: [{ message: { role: 'assistant', content: 'ok' } }] };
    },
    async chatStream(apiKey, body, telemetry, onEvent, options) {
      calls.push({ method: 'chatStream', apiKey, body, telemetry, options });
      onEvent({ type: 'content_delta', content: 'ok' });
      return { choices: [{ message: { role: 'assistant', content: 'ok' } }] };
    },
    async embed(apiKey, texts, telemetry, options) {
      calls.push({ method: 'embed', apiKey, texts, telemetry, options });
      return [Float32Array.from([1, 0])];
    },
  };
  const settings = {
    model_profiles: [
      {
        id: 'chat-a',
        label: 'Chat A',
        provider: 'fake-chat',
        model: 'model-a',
        credentialRef: 'credential:a',
        capabilities: ['chat', 'streaming', 'tools'],
        parameters: { temperature: 0.2 },
      },
      {
        id: 'embed-a',
        label: 'Embed A',
        provider: 'fake-embed',
        model: 'embed-model',
        credentialRef: 'credential:b',
        capabilities: ['embedding'],
      },
    ],
    model_role_bindings: { chat: 'chat-a', agent: 'chat-a', embedding: 'embed-a' },
  };
  const gateway = new ModelGateway({
    getSettings: () => overrides.settings || settings,
    getCredential: (ref) => ({ 'credential:a': 'key-a', 'credential:b': 'key-b' })[ref] || '',
    getProvider: (name) => (name === 'fake-chat' || name === 'fake-embed' ? provider : undefined),
  });
  return { gateway, calls };
}

test('gateway resolves a role, injects profile model, and streams through one adapter', async () => {
  const { gateway, calls } = createGateway();
  const events = [];
  const result = await gateway.chat({
    role: 'agent',
    body: { model: 'caller-must-not-win', messages: [], temperature: 0.7 },
    telemetry: { kind: 'agent_iter' },
    onEvent: (event) => events.push(event),
  });

  assert.equal(result.choices[0].message.content, 'ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].apiKey, 'key-a');
  assert.equal(calls[0].body.model, 'model-a');
  assert.equal(calls[0].body.temperature, 0.7);
  assert.equal(events[0].content, 'ok');
});

test('gateway routes embedding with profile model and credential reference', async () => {
  const { gateway, calls } = createGateway();
  const vectors = await gateway.embed({ texts: ['abc'], telemetry: { kind: 'embedding' } });
  assert.equal(vectors[0][0], 1);
  assert.equal(calls[0].apiKey, 'key-b');
  assert.equal(calls[0].options.model, 'embed-model');
});

test('gateway blocks capability mismatch before provider dispatch', async () => {
  const { gateway, calls } = createGateway();
  const result = await gateway.chat({ role: 'agent', profileId: 'embed-a', body: { messages: [] } });
  assert.equal(result.error, 'model_capability_mismatch');
  assert.equal(calls.length, 0);
});

test('gateway reports an unregistered provider without exposing credentials', async () => {
  const { gateway } = createGateway({
    settings: {
      model_profiles: [
        { id: 'missing', provider: 'missing', model: 'x', capabilities: ['chat'] },
      ],
      model_role_bindings: { chat: 'missing' },
    },
  });
  const result = await gateway.chat({ body: { messages: [] } });
  assert.equal(result.error, 'provider_not_registered');
  assert.equal(JSON.stringify(result).includes('apiKey'), false);
});
