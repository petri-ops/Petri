/**
 * BLOCK-455 P2 — 后端消费面模型级接线契约（HK-01 红绿先行）。
 *
 * 锁定：thinking 门跟实际 attempt 模型；vision/embed 用绑定解析出的模型；
 * embedding 可用性与 vision_configured 吃 渠道::模型 对绑定。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ModelGateway } = require('../core/shared-backend/llm-providers/model-gateway.js');
const { embeddingRoleAvailable } = require('../core/petri-server/helpers/embedding-availability.js');
const { computeVisionConfigured } = require('../core/petri-server/routes/ai-settings-api.js');

function createGateway(settings) {
  const calls = [];
  const provider = {
    async chat(apiKey, body, telemetry, options) {
      calls.push({ method: 'chat', body, options });
      return { choices: [{ message: { role: 'assistant', content: 'ok' } }] };
    },
    async embed(apiKey, texts, telemetry, options) {
      calls.push({ method: 'embed', texts, options });
      return [Float32Array.from([1, 0])];
    },
  };
  const gateway = new ModelGateway({
    getSettings: () => settings,
    getCredential: () => 'key',
    getProvider: () => provider,
  });
  return { gateway, calls };
}

const baseProfile = {
  id: 'ep',
  provider: 'openai-compatible',
  protocol: 'openai-compatible',
  model: 'default-model',
  credentialRef: 'credential:ep',
  capabilities: ['chat', 'streaming', 'tools', 'reasoning', 'vision'],
  modelCapabilities: {
    'reasoner-x': ['chat', 'streaming', 'tools', 'reasoning'],
    'plain-y': ['chat', 'streaming', 'tools'],
    'vl-model': ['chat', 'streaming', 'tools', 'vision'],
    'bge-m3': ['embedding'],
  },
};

test('BLOCK-518 声明面退役：thinking 档跟实际模型但 reasoning 覆写归一时收窄，高档不发参', async () => {
  const { gateway, calls } = createGateway({
    model_profiles: [baseProfile],
    model_role_bindings: { chat: 'ep' },
  });
  await gateway.chat({ role: 'chat', modelOverride: 'plain-y', thinkingLevel: 'high', body: { messages: [] } });
  assert.equal(calls[0].body.model, 'plain-y');
  assert.equal(calls[0].body.reasoning_effort, undefined);

  await gateway.chat({ role: 'chat', modelOverride: 'reasoner-x', thinkingLevel: 'high', body: { messages: [] } });
  assert.equal(calls[1].body.model, 'reasoner-x');
  assert.equal(calls[1].body.reasoning_effort, undefined, '模型名推断 reasoning 已退役，归一收窄后无声明位');
});

test('BLOCK-518 — 渠道/模型旧 reasoning 声明均不发参（声明面退役，未声明不发参口径）', async () => {
  const { gateway, calls } = createGateway({
    model_profiles: [{ ...baseProfile, capabilities: ['chat', 'streaming', 'tools'] }],
    model_role_bindings: { chat: 'ep' },
  });
  await gateway.chat({ role: 'chat', modelOverride: 'reasoner-x', thinkingLevel: 'high', body: { messages: [] } });
  assert.equal(calls[0].body.reasoning_effort, undefined);
});

test('vision 绑定 渠道::模型 对 → 请求用绑定模型', async () => {
  const { gateway, calls } = createGateway({
    model_profiles: [baseProfile],
    model_role_bindings: { vision: 'ep::vl-model' },
  });
  const result = await gateway.vision({ body: { messages: [] } });
  assert.equal(result.error, undefined);
  assert.equal(calls[0].body.model, 'vl-model');
});

test('BLOCK-518 槽位撤门：vision 绑定模型无 vision 声明也不 mismatch（请求仍用绑定模型）', async () => {
  const { gateway, calls } = createGateway({
    model_profiles: [baseProfile],
    model_role_bindings: { vision: 'ep::plain-y' },
  });
  const result = await gateway.vision({ body: { messages: [] } });
  assert.equal(result.error, undefined);
  assert.equal(calls[0].body.model, 'plain-y');
});

test('embed 绑定 渠道::模型 对 → embed 用绑定模型', async () => {
  const { gateway, calls } = createGateway({
    model_profiles: [baseProfile],
    model_role_bindings: { embedding: 'ep::bge-m3' },
  });
  await gateway.embed({ texts: ['hello'] });
  assert.equal(calls[0].options.model, 'bge-m3');
});

test('embeddingRoleAvailable：对绑定 + 模型级能力判定', () => {
  const settings = {
    model_profiles: [{ ...baseProfile, provider: 'ollama' }],
    model_role_bindings: { embedding: 'ep::bge-m3' },
  };
  assert.equal(embeddingRoleAvailable(settings), true);
  assert.equal(embeddingRoleAvailable({
    ...settings,
    model_role_bindings: { embedding: 'ep::plain-y' },
  }), false);
  // 裸绑定旧形态不受影响（渠道默认模型无 embedding 覆写 → 渠道 capabilities 兜底）
  assert.equal(embeddingRoleAvailable({
    model_profiles: [{ id: 'e', provider: 'ollama', model: 'm', capabilities: ['embedding'] }],
    model_role_bindings: { embedding: 'e' },
  }), true);
});

test('computeVisionConfigured：对绑定按 profileId 查凭据', () => {
  const settings = {
    model_profiles: [baseProfile],
    model_role_bindings: { vision: 'ep::vl-model' },
  };
  assert.equal(computeVisionConfigured(settings, () => 'key'), true);
  assert.equal(computeVisionConfigured(settings, () => ''), false);
});