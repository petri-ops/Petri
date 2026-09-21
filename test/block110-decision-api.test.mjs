/**
 * BLOCK-110-JEV P0 — decision-api wrapper 契约测试（plan §3 P0 门禁）。
 *
 * 覆盖矩阵：
 *   ① 合法响应放行（choice/noul 混题型、model/usage 透传、attempts=1）
 *   ② 非法响应拒收 → invalid_response（choice 不在 ids / 概率键不完备 / 概率和漂移超 ±0.02 /
 *      choice 非 argmax / noul 越界 / 缺答案键 / 非 JSON 体 / 缺 answers 对象）
 *   ③ 重试：429 后成功（retry-after 尊重）、429 耗尽 → rate_limited、529 耗尽 → overloaded、
 *      指数退避区间断言、超时（TimeoutError）重试耗尽 → timeout
 *   ④ 不重试：401 → auth_failed、422 → invalid_request（attempts=1）
 *   ⑤ 降级契约：缺 key → no_key（零网络）、网络异常 → network_error、调用方取消 → aborted
 *   ⑥ 客户端形状校验：坏题型/空 criteria/score 级数越界 → invalid_request（零网络）
 *   ⑦ D-B provider 可替换性：baseUrl 指向本地 http server（真实 fetch）全链路通——契约不绑域名
 *   ⑧ 配置：默认 pin jev-1.13.0、env 覆盖生效、缺 key → null
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const decisionApi = require('../core/biof3-server/helpers/decision-api.js');

// env 隔离：测试不依赖也不污染真实环境
const savedEnv = {};
test.beforeEach(() => {
  for (const key of ['TYPESAFE_API_KEY', 'TYPESAFE_BASE_URL', 'TYPESAFE_MODEL']) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});
test.afterEach(() => {
  for (const key of Object.keys(savedEnv)) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const BASE_OVERRIDES = { apiKey: 'test-key-not-real', sleep: async () => {} };

function fetchResponse({ status = 200, payload = null, text = null, retryAfter = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? retryAfter : null) },
    json: async () => payload,
    text: async () => (text ?? (payload ? JSON.stringify(payload) : '')),
  };
}

const QUESTIONS = {
  route: { type: 'choice', instructions: '选路由', criteria: { a: '路径A', b: '路径B', other: '都不像' } },
  is_shift: { type: 'noul', instructions: '是否切换话题' },
};

const VALID_ANSWERS = {
  route: { type: 'choice', choice: 'a', confidence: 0.78, probabilities: { a: 0.85, b: 0.1, other: 0.05 } },
  is_shift: { type: 'noul', noul: 0.98 },
};

// ============================================================
// ① 合法响应放行
// ============================================================
test('合法响应放行：混题型答案透传 + model/usage 透传 + attempts=1', async () => {
  let calls = 0;
  const outcome = await decisionApi.askDecision({
    state: '一些评估对象',
    questions: QUESTIONS,
    overrides: {
      ...BASE_OVERRIDES,
      fetchImpl: async () => {
        calls++;
        return fetchResponse({ payload: { model: 'jev-1.13.0', answers: VALID_ANSWERS, usage: { input_tokens: 392 } } });
      },
    },
  });
  assert.equal(outcome.ok, true);
  assert.equal(calls, 1);
  assert.equal(outcome.attempts, 1);
  assert.equal(outcome.model, 'jev-1.13.0');
  assert.equal(outcome.answers.route.choice, 'a');
  assert.equal(outcome.answers.is_shift.noul, 0.98);
  assert.equal(outcome.usage.input_tokens, 392);
});

// ============================================================
// ② 非法响应拒收
// ============================================================
test('非法响应逐类拒收 → invalid_response', async () => {
  const cases = [
    {
      name: 'choice 不在 criteria 内',
      answers: { ...VALID_ANSWERS, route: { ...VALID_ANSWERS.route, choice: 'unknown' } },
    },
    {
      name: '概率键不完备（缺 other）',
      answers: { ...VALID_ANSWERS, route: { ...VALID_ANSWERS.route, probabilities: { a: 0.9, b: 0.1 } } },
    },
    {
      name: '概率和漂移超 ±0.02',
      answers: { ...VALID_ANSWERS, route: { ...VALID_ANSWERS.route, probabilities: { a: 0.9, b: 0.1, other: 0.1 } } },
    },
    {
      name: 'choice 非 argmax',
      answers: { ...VALID_ANSWERS, route: { ...VALID_ANSWERS.route, choice: 'b', probabilities: { a: 0.8, b: 0.15, other: 0.05 } } },
    },
    {
      name: 'confidence 缺失（非有限数值）',
      answers: { ...VALID_ANSWERS, route: { ...VALID_ANSWERS.route, confidence: undefined } },
    },
    {
      name: 'noul 越界',
      answers: { ...VALID_ANSWERS, is_shift: { type: 'noul', noul: 1.5 } },
    },
    {
      name: '缺答案键',
      answers: { route: VALID_ANSWERS.route },
    },
    {
      name: 'score 与 Σ级号×概率 偏差超 0.05',
      questions: { sev: { type: 'score', instructions: 'x', criteria: ['一', '二', '三'] } },
      answers: {
        sev: { type: 'score', score: 2.0, confidence: 1, probabilities: { 0: 0.0, 1: 1.0, 2: 0.0 } },
      },
    },
  ];
  for (const c of cases) {
    const outcome = await decisionApi.askDecision({
      state: 'x',
      questions: c.questions || QUESTIONS,
      overrides: { ...BASE_OVERRIDES, fetchImpl: async () => fetchResponse({ payload: { model: 'jev-1.13.0', answers: c.answers } }) },
    });
    assert.equal(outcome.ok, false, c.name);
    assert.equal(outcome.reason, 'invalid_response', c.name);
  }
});

test('响应非 JSON / 缺 answers → invalid_response', async () => {
  const notJson = await decisionApi.askDecision({
    state: 'x', questions: QUESTIONS,
    overrides: { ...BASE_OVERRIDES, fetchImpl: async () => fetchResponse({ status: 200, text: '<html>oops</html>' }) },
  });
  assert.equal(notJson.reason, 'invalid_response');

  const noAnswers = await decisionApi.askDecision({
    state: 'x', questions: QUESTIONS,
    overrides: { ...BASE_OVERRIDES, fetchImpl: async () => fetchResponse({ payload: { model: 'jev-1.13.0' } }) },
  });
  assert.equal(noAnswers.reason, 'invalid_response');
});

test('score 合法响应放行（级间分 + 归一分布）', async () => {
  const questions = { sev: { type: 'score', instructions: 'x', criteria: ['一', '二', '三'] } };
  const answers = {
    sev: { type: 'score', score: 1.3, confidence: 0.6, probabilities: { 0: 0.0, 1: 0.7, 2: 0.3 } },
  };
  const outcome = await decisionApi.askDecision({
    state: 'x', questions,
    overrides: { ...BASE_OVERRIDES, fetchImpl: async () => fetchResponse({ payload: { answers } }) },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.answers.sev.score, 1.3);
});

// ============================================================
// ③ 重试
// ============================================================
test('429 后重试成功：尊重 retry-after=0（sleep 收 0 而非退避值）', async () => {
  const sleeps = [];
  let calls = 0;
  const outcome = await decisionApi.askDecision({
    state: 'x', questions: QUESTIONS,
    overrides: {
      ...BASE_OVERRIDES,
      fetchImpl: async () => {
        calls++;
        if (calls === 1) return fetchResponse({ status: 429, retryAfter: '0' });
        return fetchResponse({ payload: { answers: VALID_ANSWERS } });
      },
      sleep: async (ms) => sleeps.push(ms),
    },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.attempts, 2);
  assert.equal(sleeps.length, 1);
  assert.equal(sleeps[0], 0);
});

test('默认指数退避落在 0.5s×2^n + jitter(≤0.25s) 区间', async () => {
  const sleeps = [];
  let calls = 0;
  await decisionApi.askDecision({
    state: 'x', questions: QUESTIONS,
    overrides: {
      ...BASE_OVERRIDES,
      fetchImpl: async () => {
        calls++;
        if (calls < 3) return fetchResponse({ status: 429 });
        return fetchResponse({ payload: { answers: VALID_ANSWERS } });
      },
      sleep: async (ms) => sleeps.push(ms),
    },
  });
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[0] >= 500 && sleeps[0] <= 750, `第一次退避 ${sleeps[0]}`);
  assert.ok(sleeps[1] >= 1000 && sleeps[1] <= 1250, `第二次退避 ${sleeps[1]}`);
});

test('429 耗尽 → rate_limited；529 耗尽 → overloaded', async () => {
  const rateLimited = await decisionApi.askDecision({
    state: 'x', questions: QUESTIONS,
    overrides: { ...BASE_OVERRIDES, fetchImpl: async () => fetchResponse({ status: 429 }) },
  });
  assert.equal(rateLimited.reason, 'rate_limited');
  assert.equal(rateLimited.attempts, 3);
  assert.equal(rateLimited.ok, false);

  const overloaded = await decisionApi.askDecision({
    state: 'x', questions: QUESTIONS,
    overrides: { ...BASE_OVERRIDES, fetchImpl: async () => fetchResponse({ status: 529 }) },
  });
  assert.equal(overloaded.reason, 'overloaded');
});

test('超时（TimeoutError）重试耗尽 → timeout；调用方取消（AbortError）立即降级', async () => {
  let timeoutCalls = 0;
  const timeoutOutcome = await decisionApi.askDecision({
    state: 'x', questions: QUESTIONS,
    overrides: {
      ...BASE_OVERRIDES,
      fetchImpl: async () => {
        timeoutCalls++;
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'TimeoutError';
        throw err;
      },
    },
  });
  assert.equal(timeoutOutcome.reason, 'timeout');
  assert.equal(timeoutCalls, 3);

  let abortCalls = 0;
  const abortOutcome = await decisionApi.askDecision({
    state: 'x', questions: QUESTIONS,
    overrides: {
      ...BASE_OVERRIDES,
      fetchImpl: async () => {
        abortCalls++;
        const err = new Error('This operation was aborted');
        err.name = 'AbortError';
        throw err;
      },
    },
  });
  assert.equal(abortOutcome.reason, 'aborted');
  assert.equal(abortCalls, 1);
});

// ============================================================
// ④ 不重试的确定性失败
// ============================================================
test('401 → auth_failed、422 → invalid_request，均不重试', async () => {
  let calls401 = 0;
  const auth = await decisionApi.askDecision({
    state: 'x', questions: QUESTIONS,
    overrides: {
      ...BASE_OVERRIDES,
      fetchImpl: async () => { calls401++; return fetchResponse({ status: 401, text: 'invalid api key' }); },
    },
  });
  assert.equal(auth.reason, 'auth_failed');
  assert.equal(calls401, 1);

  let calls422 = 0;
  const invalid = await decisionApi.askDecision({
    state: 'x', questions: QUESTIONS,
    overrides: {
      ...BASE_OVERRIDES,
      fetchImpl: async () => { calls422++; return fetchResponse({ status: 422, text: 'body validation' }); },
    },
  });
  assert.equal(invalid.reason, 'invalid_request');
  assert.equal(calls422, 1);
});

// ============================================================
// ⑤ 降级契约
// ============================================================
test('缺 key → no_key 且零网络；网络异常重试耗尽 → network_error', async () => {
  const noKey = await decisionApi.askDecision({
    state: 'x', questions: QUESTIONS,
    overrides: {
      fetchImpl: async () => { throw new Error('不该被调用'); },
    },
  });
  assert.equal(noKey.reason, 'no_key');
  assert.equal(noKey.ok, false);

  let calls = 0;
  const network = await decisionApi.askDecision({
    state: 'x', questions: QUESTIONS,
    overrides: {
      ...BASE_OVERRIDES,
      fetchImpl: async () => { calls++; throw new Error('ECONNRESET'); },
    },
  });
  assert.equal(network.reason, 'network_error');
  assert.equal(calls, 3);
  assert.equal(network.ok, false);
});

test('resolveDecisionConfig：缺 key → null；默认 pin jev-1.13.0；env 覆盖生效', () => {
  assert.equal(decisionApi.resolveDecisionConfig(), null);
  const config = decisionApi.resolveDecisionConfig({ apiKey: 'k' });
  assert.equal(config.model, 'jev-1.13.0');
  assert.equal(config.baseUrl, 'https://api.typesafe.ai');
  process.env.TYPESAFE_BASE_URL = 'http://127.0.0.1:9/';
  process.env.TYPESAFE_MODEL = 'jev-1.13.1';
  const overridden = decisionApi.resolveDecisionConfig({ apiKey: 'k' });
  assert.equal(overridden.baseUrl, 'http://127.0.0.1:9');
  assert.equal(overridden.model, 'jev-1.13.1');
  assert.equal(decisionApi.DECISION_MODEL_PIN, 'jev-1.13.0');
});

// ============================================================
// ⑥ 客户端形状校验（零网络）
// ============================================================
test('坏 questions 形状 → invalid_request 零网络', async () => {
  let calls = 0;
  const failingFetch = async () => { calls++; throw new Error('不该被调用'); };
  const badShapes = [
    null,
    {},
    { bad: { type: 'choice', criteria: {} } },
    { bad: { type: 'unknown' } },
    { bad: { type: 'score', criteria: ['只有一级'] } },
    { bad: { type: 'score', criteria: Array.from({ length: 11 }, (_, i) => i) } },
    { bad: { type: 'choice', criteria: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`k${i}`, 'x'])) } },
  ];
  for (const questions of badShapes) {
    const outcome = await decisionApi.askDecision({
      state: 'x', questions,
      overrides: { ...BASE_OVERRIDES, fetchImpl: failingFetch },
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, 'invalid_request', JSON.stringify(questions)?.slice(0, 60));
  }
  assert.equal(calls, 0);
});

// ============================================================
// ⑦ D-B：baseUrl 可配置（本地 http server + 真实 fetch 全链路）
// ============================================================
test('D-B provider 可替换性：baseUrl 指向本地 server 全链路通，契约不绑域名', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: 'jev-1.13.0', answers: VALID_ANSWERS, usage: { input_tokens: 10 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const outcome = await decisionApi.askDecision({
      state: '中文 state 透传',
      questions: QUESTIONS,
      overrides: { ...BASE_OVERRIDES, baseUrl: `http://127.0.0.1:${port}` },
    });
    assert.equal(outcome.ok, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/v1/systemone');
    assert.match(requests[0].auth, /^Bearer .+/);
    assert.equal(requests[0].body.model, 'jev-1.13.0');
    assert.equal(requests[0].body.state, '中文 state 透传');
    assert.deepEqual(Object.keys(requests[0].body.questions), Object.keys(QUESTIONS));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ============================================================
// ⑧ 校验函数直测（边界数学）
// ============================================================
test('validateChoiceAnswer 边界：概率和 1.019 放行 / 1.03 拒收；argmax 并列放行', () => {
  const keys = ['a', 'b'];
  assert.equal(decisionApi.validateChoiceAnswer(
    { choice: 'a', confidence: 0.5, probabilities: { a: 0.619, b: 0.4 } }, keys,
  ).ok, true, '和=1.019 在容差内');
  assert.equal(decisionApi.validateChoiceAnswer(
    { choice: 'a', confidence: 0.5, probabilities: { a: 0.63, b: 0.4 } }, keys,
  ).ok, false, '和=1.03 超容差');
  assert.equal(decisionApi.validateChoiceAnswer(
    { choice: 'a', confidence: 0.5, probabilities: { a: 0.5, b: 0.5 } }, keys,
  ).ok, true, 'argmax 并列放行');
  assert.equal(decisionApi.validateNoulAnswer({ noul: 0 }).ok, true);
  assert.equal(decisionApi.validateNoulAnswer({ noul: 1 }).ok, true);
  assert.equal(decisionApi.validateNoulAnswer({ noul: -0.1 }).ok, false);
  assert.equal(decisionApi.validateNoulAnswer({ noul: Number.NaN }).ok, false);
});

// ============================================================
// ⑨ 校准语料完整性契约（harness 的输入守护；真实校准跑 scripts/block110-calibrate.mjs）
// ============================================================
test('P0 校准语料：形状、规模与标签平衡（topic-shift ≥100 且 100/100 平衡；retrieval ≥60）', () => {
  const topicShift = JSON.parse(fs.readFileSync(path.join(here, '..', 'acceptance/block-110/corpus-topic-shift.json'), 'utf8'));
  assert.equal(topicShift.kind, 'block110-corpus');
  assert.equal(topicShift.domain, 'topic-shift');
  assert.ok(topicShift.samples.length >= 100, `topic-shift 需 ≥100 条，实际 ${topicShift.samples.length}`);
  for (const s of topicShift.samples) {
    assert.equal(s.length, 4, `${s[0]} 形状非法`);
    assert.ok(Array.isArray(s[1]) && s[1].length >= 2, `${s[0]} earlier 需 ≥2 轮`);
    assert.ok(Array.isArray(s[2]) && s[2].length >= 2, `${s[0]} latest 需 ≥2 轮`);
    assert.equal(typeof s[3], 'boolean', `${s[0]} label 需布尔`);
  }
  const t = topicShift.samples.filter((s) => s[3] === true).length;
  const f = topicShift.samples.filter((s) => s[3] === false).length;
  assert.equal(t, f, `topic-shift 标签需平衡，实际 true=${t} false=${f}`);

  const retrieval = JSON.parse(fs.readFileSync(path.join(here, '..', 'acceptance/block-110/corpus-retrieval.json'), 'utf8'));
  assert.equal(retrieval.domain, 'retrieval-relevance');
  assert.ok(retrieval.samples.length >= 60, `retrieval 需 ≥60 条，实际 ${retrieval.samples.length}`);
  for (const s of retrieval.samples) {
    assert.equal(s.length, 4, `${s[0]} 形状非法`);
    assert.equal(typeof s[1], 'string', `${s[0]} query 需字符串`);
    assert.ok(s[1].length > 0, `${s[0]} query 非空`);
    assert.equal(typeof s[3], 'boolean', `${s[0]} label 需布尔`);
  }
  const rTrue = retrieval.samples.filter((s) => s[3] === true).length;
  assert.equal(rTrue, retrieval.samples.length - rTrue, 'retrieval 标签需平衡');
});
