import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { ModelGateway } = require('../core/shared-backend/llm-providers/model-gateway.js');

/** 单档隔离网关：binding 与档位一一对应，避免归一化器在多 vision 档间的重推导歧义。 */
function gatewayWithProfile(profile, chatImpl) {
  return new ModelGateway({
    getSettings: () => ({ model_role_bindings: { vision: profile.id }, model_profiles: [profile] }),
    getCredential: () => 'sk-test',
    getProvider: (name) => (name === profile.provider ? chatImpl : null),
    recordRouting() {}, recordTranscript() {},
  });
}

const VISION_BODY = {
  messages: [{ role: 'user', content: [
    { type: 'text', text: '这张图里是什么' },
    { type: 'image', image: 'data:image/png;base64,AAAA' },
  ] }],
};

test('BLOCK-150 加映 — vision 绑到 openai 系通道：图片部件转 image_url（协议缺口补齐）', async () => {
  const calls = [];
  const gw = gatewayWithProfile(
    { id: 'oc', provider: 'openai-compatible', model: 'deepseek-flash', credentialRef: 'provider:deepseek', capabilities: ['chat', 'streaming', 'tools', 'vision'] },
    { chat: async (apiKey, body) => { calls.push({ apiKey, body }); return { ok: true, content: 'ok' }; } },
  );
  const r = await gw.vision({ body: { ...VISION_BODY } });
  assert.equal(r.error, undefined, '不应报错: ' + JSON.stringify(r));
  const parts = calls[0].body.messages[0].content;
  const img = parts.find((p) => p.type === 'image_url');
  assert.ok(img, 'openai 系通道必须收到 image_url 形态: ' + JSON.stringify(parts));
  assert.equal(img.image_url.url, 'data:image/png;base64,AAAA');
  assert.equal(parts.find((p) => p.type === 'image'), undefined, 'dashscope 原生部件不得透传');
  assert.equal(calls[0].body.model, 'deepseek-flash');
});

test('dashscope-vision 通道不转换（原生格式直传）', async () => {
  const calls = [];
  const gw = gatewayWithProfile(
    { id: 'dv', provider: 'dashscope-vision', model: 'qwen-vl-max', credentialRef: 'provider:dashscope', capabilities: ['vision'] },
    { chat: async (apiKey, body) => { calls.push(body); return { ok: true, content: 'ok' }; } },
  );
  const r = await gw.vision({ body: { ...VISION_BODY } });
  assert.equal(r.error, undefined, '不应报错: ' + JSON.stringify(r));
  const parts = calls[0].messages[0].content;
  assert.ok(parts.some((p) => p.type === 'image'), 'dashscope-vision 原生 image 部件应原样保留: ' + JSON.stringify(parts));
});

test('能力门保留：渠道未声明 vision 能力 → 诚实拒绝 model_capability_mismatch（不静默发图）', async () => {
  const gw = gatewayWithProfile(
    { id: 'plain', provider: 'openai-compatible', model: 'x', credentialRef: 'c', capabilities: ['chat'] },
    { chat: async () => ({ ok: true }) },
  );
  const r = await gw.vision({ body: { ...VISION_BODY } });
  assert.equal(r.error, 'model_capability_mismatch');
});

test('BLOCK-150 加映三 — openai 系响应归一化：vision 结果从原始信封取 content（修「消耗 token 却空描述」）', async () => {
  const gw = gatewayWithProfile(
    { id: 'oc', provider: 'openai-compatible', model: 'deepseek-flash', credentialRef: 'c', capabilities: ['vision'] },
    { chat: async () => ({ choices: [{ message: { content: '图里是一个散点图', reasoning_content: 'thinking...' } }], usage: { total_tokens: 10 } }) },
  );
  const r = await gw.vision({ body: { messages: [{ role: 'user', content: [{ type: 'text', text: 't' }, { type: 'image', image: 'data:x' }] }] } });
  assert.equal(r.error, undefined);
  assert.equal(r.content, '图里是一个散点图', 'content 必须从 choices[0].message.content 归一化');
  test2: {
    const gw2 = gatewayWithProfile(
      { id: 'oc', provider: 'openai-compatible', model: 'm', credentialRef: 'c', capabilities: ['vision'] },
      { chat: async () => ({ choices: [{ message: { content: '', reasoning_content: '只有推理时回退推理文本' } }] }) },
    );
    const r2 = await gw2.vision({ body: { messages: [{ role: 'user', content: [{ type: 'text', text: 't' }, { type: 'image', image: 'data:x' }] }] } });
    assert.equal(r2.content, '只有推理时回退推理文本', 'content 空时回退 reasoning_content');
  }
});
