/**
 * thinking-level-injection.test.mjs — BLOCK-81 P1 网关级门禁 + BLOCK-518 声明面退役。
 *
 * 用假 provider 构造真实 ModelGateway（注入 getSettings/getProvider/…），
 * 断言**实际发给上游的 requestBody**：
 *   1. BLOCK-518 — reasoning 不再是声明位（能力数组只载 tools[+embedding]）：
 *      旧数据里残留的 reasoning 声明经归一收窄 → 网关 D3 ① 门恒不发思考参数
 *      （思考档位控件默认隐藏；上游诚实报错优于假开关）。
 *   2. standard / 缺省 / 非法档位 → 请求体无任何思考参数（零行为变化）。
 *   3. 上游 400「未知参数」→ 未注入思考参数时不触发去参重试（D3 ② 门不误触）。
 *   4. 非参数类 400（如鉴权失败）→ 不去参重试，错误如实上抛。
 *
 * 注：D3 ② 去参重试代码仍在网关内（其他参数来源的法律路径保留），
 * 但 reasoning 声明位退役后经 thinkingLevel 注入的路径已不可达；本文件据实钉门行为。
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

test('BLOCK-518 — high 档 + 旧 reasoning 声明（归一时收窄）→ 请求体不带思考参数', async () => {
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
  assert.equal('reasoning_effort' in seen[0], false, 'reasoning 位退役后能力门恒不发参');
  assert.equal('thinking' in seen[0], false);
  assert.equal(result.error, undefined);
});

test('BLOCK-518 — off 档 + 旧 reasoning 声明 → 请求体不带思考参数', async () => {
  const seen = [];
  const gateway = makeGateway({
    async chat(apiKey, body) { seen.push(body); return { choices: [{ message: { content: 'ok' } }] }; },
  }, REASONING);

  await gateway.chat({ role: 'agent', profileId: 'p-test', body: { messages: [] }, thinkingLevel: 'off' });
  assert.equal('reasoning_effort' in seen[0], false);
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

test('上游 400「未知参数」+ 无注入思考参数 → 不去参重试，错误如实上抛（不误触 D3 ②）', async () => {
  const seen = [];
  const gateway = makeGateway({
    async chat(apiKey, body) {
      seen.push(JSON.parse(JSON.stringify(body)));
      return { error: 'http_error', message: 'Unknown parameter: reasoning_effort', status: 400 };
    },
  }, REASONING);

  const result = await gateway.chat({
    role: 'agent',
    profileId: 'p-test',
    body: { messages: [] },
    thinkingLevel: 'high',
  });

  assert.equal(seen.length, 1, '未注入思考参数 → 不触发去参重试');
  assert.equal('reasoning_effort' in seen[0], false, '首次即不带思考参数');
  assert.equal(result.error, 'http_error');
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
