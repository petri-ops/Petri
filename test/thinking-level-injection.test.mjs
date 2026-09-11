/**
 * thinking-level-injection.test.mjs — BLOCK-81 P1 网关级门禁：思考档位真身进请求体 + 容错。
 *
 * 用假 provider 构造真实 ModelGateway（注入 getSettings/getProvider/…），
 * 断言**实际发给上游的 requestBody**：
 *   1. high 档且在能力位内 → 请求体带 reasoning_effort（协议映射生效）
 *   2. standard / 缺省 → 请求体无任何思考参数（零行为变化）
 *   3. 未声明 capabilities.reasoning 的渠道 → 即便档位为 high 也不发参（D3 双保险①）
 *   4. 上游 400「未知参数」→ 去参重试一次成功（D3 双保险②）
 *   5. 非参数类 400（如鉴权失败）→ **不**去参重试，错误如实上抛（避免误剥参数掩盖真因）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ModelGateway } = require('../core/shared-backend/llm-providers/model-gateway.js');

/** 构造一个只含所需渠道的 settings（真实 normalizeModelConfig 形状）。 */
function makeSettings({ capabilities }) {
  return {
    model_profiles: [{
      id: 'p-test',
      provider: 'openai-compatible',
      protocol: 'openai-compatible',
      model: 'gpt-test',
      baseUrl: 'http://127.0.0.1:9/v1',
      credentialRef: 'test-cred',
      capabilities,
    }],
    model_role_bindings: { agent: 'p-test', chat: 'p-test' },
  };
}

function makeGateway(provider, capabilities) {
  return new ModelGateway({
    getSettings: () => makeSettings({ capabilities }),
    getCredential: () => 'test-key',
    getProvider: () => provider,
    recordRouting: () => {},
    recordTranscript: () => {},
  });
}

const REASONING = ['chat', 'streaming', 'tools', 'reasoning'];
const NO_REASONING = ['chat', 'streaming', 'tools'];

test('high 档 + 声明 reasoning → 请求体带 reasoning_effort（协议映射生效）', async () => {
  const seen = [];
  const gateway = makeGateway({
    async chat(apiKey, body) { seen.push(body); return { choices: [{ message: { content: 'ok' } }] }; },
  }, REASONING);

  const result = await gateway.chat({
    role: 'agent',
    profileId: 'p-test',
    body: { messages: [{ role: 'user', content: 'hi' }] },
    thinkingLevel: 'high',
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].reasoning_effort, 'high', '请求体应带 reasoning_effort=high');
  assert.equal(result.error, undefined);
});

test('off 档 + 声明 reasoning → 发最小档（协议无真关闭档时的诚实降级）', async () => {
  const seen = [];
  const gateway = makeGateway({
    async chat(apiKey, body) { seen.push(body); return { choices: [{ message: { content: 'ok' } }] }; },
  }, REASONING);

  await gateway.chat({ role: 'agent', profileId: 'p-test', body: { messages: [] }, thinkingLevel: 'off' });
  assert.equal(seen[0].reasoning_effort, 'minimal');
});

test('standard / 缺省 / 非法档位 → 请求体无任何思考参数（零行为变化）', async () => {
  const seen = [];
  const gateway = makeGateway({
    async chat(apiKey, body) { seen.push(body); return { choices: [{ message: { content: 'ok' } }] }; },
  }, REASONING);

  await gateway.chat({ role: 'agent', profileId: 'p-test', body: { messages: [] }, thinkingLevel: 'standard' });
  await gateway.chat({ role: 'agent', profileId: 'p-test', body: { messages: [] } });
  await gateway.chat({ role: 'agent', profileId: 'p-test', body: { messages: [] }, thinkingLevel: 'ultra' });

  assert.equal(seen.length, 3);
  for (const body of seen) {
    assert.equal('reasoning_effort' in body, false);
    assert.equal('thinking' in body, false);
    assert.equal('enable_thinking' in body, false);
  }
});

test('未声明 capabilities.reasoning → 即便 high 也不发参（D3 双保险①）', async () => {
  const seen = [];
  const gateway = makeGateway({
    async chat(apiKey, body) { seen.push(body); return { choices: [{ message: { content: 'ok' } }] }; },
  }, NO_REASONING);

  await gateway.chat({ role: 'agent', profileId: 'p-test', body: { messages: [] }, thinkingLevel: 'high' });
  assert.equal('reasoning_effort' in seen[0], false, '未声明能力位的渠道不得被注入思考参数');
});

test('上游 400「未知参数」→ 去参重试一次并成功（D3 双保险②）', async () => {
  const seen = [];
  const gateway = makeGateway({
    async chat(apiKey, body) {
      seen.push(JSON.parse(JSON.stringify(body)));
      if (body.reasoning_effort) {
        return { error: 'http_error', message: 'Unknown parameter: reasoning_effort', status: 400 };
      }
      return { choices: [{ message: { content: 'retried-ok' } }] };
    },
  }, REASONING);

  const result = await gateway.chat({
    role: 'agent',
    profileId: 'p-test',
    body: { messages: [] },
    thinkingLevel: 'high',
  });

  assert.equal(seen.length, 2, '应发生一次去参重试（共两次调用）');
  assert.equal(seen[0].reasoning_effort, 'high', '首次带思考参数');
  assert.equal('reasoning_effort' in seen[1], false, '重试时剥掉思考参数');
  assert.equal(
    result.choices?.[0]?.message?.content,
    'retried-ok',
    '重试结果应作为最终结果上抛'
  );
});

test('非参数类 400（鉴权失败）→ 不去参重试，错误如实上抛', async () => {
  const seen = [];
  const gateway = makeGateway({
    async chat(apiKey, body) {
      seen.push(JSON.parse(JSON.stringify(body)));
      return { error: 'http_error', message: 'Invalid API-key provided.', status: 400 };
    },
  }, REASONING);

  const result = await gateway.chat({
    role: 'agent',
    profileId: 'p-test',
    body: { messages: [] },
    thinkingLevel: 'high',
  });

  assert.equal(seen.length, 1, '鉴权失败不得触发去参重试');
  assert.equal(result.error, 'http_error');
  assert.match(String(result.message), /Invalid API-key/);
});
