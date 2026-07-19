import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ModelGateway, isRetryableProviderError } = require('../core/shared-backend/llm-providers/model-gateway.js');
const { parseJsonText, responseText } = require('../core/r-server/helpers/model-tasks.js');

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

test('gateway applies a discovered model override to the selected primary endpoint', async () => {
  const { gateway, calls } = createGateway();
  await gateway.chat({
    role: 'chat',
    profileId: 'chat-a',
    modelOverride: 'model-b',
    body: { model: 'caller-must-not-win', messages: [] },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, 'model-b');
  assert.equal(calls[0].options.profile.id, 'chat-a');
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

test('model task helpers normalize text and fenced JSON-like output', () => {
  assert.equal(
    responseText({ choices: [{ message: { content: '  result  ' } }] }),
    'result'
  );
  assert.deepEqual(parseJsonText('answer:\n{"ok":true}\nend'), { ok: true });
  assert.deepEqual(parseJsonText('prefix [1,2,3] suffix'), [1, 2, 3]);
  assert.equal(parseJsonText('not-json'), null);
});

test('gateway only falls back when explicitly enabled and records the switch', async () => {
  const calls = [];
  const providers = {
    first: {
      async chatStream(_key, _body, _telemetry, onEvent) {
        calls.push('first');
        onEvent({ type: 'error', error: 'http_error', message: 'busy' });
        return { error: 'http_error', message: 'busy', status: 503 };
      },
    },
    second: {
      async chatStream(_key, _body, _telemetry, onEvent) {
        calls.push('second');
        onEvent({ type: 'content_delta', content: 'recovered' });
        onEvent({ type: 'done' });
        return { choices: [{ message: { content: 'recovered' } }] };
      },
    },
  };
  const gateway = new ModelGateway({
    getSettings: () => ({
      model_profiles: [
        { id: 'a', provider: 'first', model: 'a', capabilities: ['chat', 'streaming'] },
        { id: 'b', provider: 'second', model: 'b', capabilities: ['chat', 'streaming'] },
      ],
      model_role_bindings: { chat: 'a' },
      model_fallback_enabled: true,
      model_fallback_bindings: { chat: ['b'] },
    }),
    getCredential: () => 'key',
    getProvider: (name) => providers[name],
  });
  const events = [];
  const result = await gateway.chat({ body: { messages: [] }, onEvent: (event) => events.push(event) });

  assert.deepEqual(calls, ['first', 'second']);
  assert.equal(events.some((event) => event.type === 'error'), false);
  assert.deepEqual(events.find((event) => event.type === 'model_fallback'), {
    type: 'model_fallback',
    role: 'chat',
    fromProfileId: 'a',
    toProfileId: 'b',
    reason: { code: 'http_error', status: 503 },
  });
  assert.deepEqual(result.modelRouting, {
    role: 'chat',
    profileId: 'b',
    fallbackFrom: 'a',
    fallbackReason: { code: 'http_error', status: 503 },
  });
});

test('gateway does not switch on auth errors or after streamed output begins', async () => {
  for (const failure of [
    { result: { error: 'api_error', status: 401 }, emitContent: false },
    { result: { error: 'timeout' }, emitContent: true },
  ]) {
    const calls = [];
    const gateway = new ModelGateway({
      getSettings: () => ({
        model_profiles: [
          { id: 'a', provider: 'first', model: 'a', capabilities: ['chat', 'streaming'] },
          { id: 'b', provider: 'second', model: 'b', capabilities: ['chat', 'streaming'] },
        ],
        model_role_bindings: { chat: 'a' },
        model_fallback_enabled: true,
        model_fallback_bindings: { chat: ['b'] },
      }),
      getCredential: () => 'key',
      getProvider: (name) => ({
        async chatStream(_key, _body, _telemetry, onEvent) {
          calls.push(name);
          if (failure.emitContent) onEvent({ type: 'content_delta', content: 'partial' });
          return failure.result;
        },
      }),
    });
    await gateway.chat({ body: { messages: [] }, onEvent: () => {} });
    assert.deepEqual(calls, ['first']);
  }
});

test('retryable provider errors are classified without retrying configuration failures', () => {
  assert.equal(isRetryableProviderError({ error: 'timeout' }), true);
  assert.equal(isRetryableProviderError({ error: 'api_error', status: 429 }), true);
  assert.equal(isRetryableProviderError({ error: 'api_error', status: 500 }), true);
  assert.equal(isRetryableProviderError({ error: 'api_error', status: 401 }), false);
  assert.equal(isRetryableProviderError({ error: 'no_api_key' }), false);
  assert.equal(isRetryableProviderError({ error: 'aborted' }), false);
});

test('vision and embedding use the same explicit fallback policy and audit callback', async () => {
  const routing = [];
  const calls = [];
  const gateway = new ModelGateway({
    getSettings: () => ({
      model_profiles: [
        { id: 'vision-a', provider: 'vision-a', model: 'va', capabilities: ['vision'] },
        { id: 'vision-b', provider: 'vision-b', model: 'vb', capabilities: ['vision'] },
        { id: 'embed-a', provider: 'embed-a', model: 'ea', capabilities: ['embedding'] },
        { id: 'embed-b', provider: 'embed-b', model: 'eb', capabilities: ['embedding'] },
      ],
      model_role_bindings: { vision: 'vision-a', embedding: 'embed-a' },
      model_fallback_enabled: true,
      model_fallback_bindings: { vision: ['vision-b'], embedding: ['embed-b'] },
    }),
    getCredential: () => 'key',
    getProvider: (name) => ({
      async chat() {
        calls.push(name);
        return name === 'vision-a'
          ? { error: 'network_error', message: 'offline' }
          : { ok: true, content: 'seen' };
      },
      async embed() {
        calls.push(name);
        return name === 'embed-a'
          ? { error: 'timeout', message: 'slow' }
          : [Float32Array.from([0.5])];
      },
    }),
    recordRouting: (event) => routing.push(event),
  });

  const vision = await gateway.vision({ body: { messages: [] } });
  const vectors = await gateway.embed({ texts: ['abc'] });
  assert.equal(vision.content, 'seen');
  assert.equal(vision.modelRouting.fallbackFrom, 'vision-a');
  assert.equal(vectors[0][0], 0.5);
  assert.deepEqual(calls, ['vision-a', 'vision-b', 'embed-a', 'embed-b']);
  assert.deepEqual(routing.map((event) => [event.role, event.fromProfileId, event.toProfileId]), [
    ['vision', 'vision-a', 'vision-b'],
    ['embedding', 'embed-a', 'embed-b'],
  ]);
});
