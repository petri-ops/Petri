/**
 * BLOCK-114 W1-4 — 测试失败归因三层管线契约（指纹先行/环境词表/低置信转人工/零容忍）。
 *
 * 契约红线（plan docs/block-114-test-failure-triage-plan.md §1.1/§5）：
 *  - L1 指纹命中 → known_existing，零模型调用（A 型：确定性层永不模型化）；
 *  - L2 环境词表命中 → environment，零模型调用；
 *  - L3 决策失败（缺 key/超时/校验失败）→ needs_human（工具失效不产生错误归类）；
 *  - defect 采纳（保守方向）；environment/flaky 需 conf ≥ TRIAGE_THRESHOLD=0.70；
 *  - new_regression 误放行零容忍：L3 判 defect 即输出 new_regression（保守交人工）。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const {
  TRIAGE_THRESHOLD,
  ENVIRONMENT_PATTERNS,
  fingerprintOf,
  matchesEnvironmentPattern,
  buildTriageDecisionRequest,
  triageFailure,
} = require(path.join(root, 'scripts', 'lib', 'block114-triage-core.mjs'));

const REGISTER = require(path.join(root, 'acceptance', 'block-114', 'known-failures.json')).entries;

const NO_SLEEP = async () => {};
const API_KEY_OVERRIDE = { apiKey: 'test-key-do-not-call-real-api' };

function useEnv(t, env) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  t.after(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

function okFetch(answer) {
  let calls = 0;
  const impl = async () => {
    calls++;
    return { ok: true, status: 200, json: async () => ({ model: 'jev-1.13.0', answers: { attribution: answer } }) };
  };
  return { impl, count: () => calls };
}

function errorFetch(name) {
  let calls = 0;
  const impl = async () => {
    calls++;
    const err = new Error(name);
    err.name = name;
    throw err;
  };
  return { impl, count: () => calls };
}

test('指纹规范：sha1(file::testName) 前 12 位', () => {
  assert.equal(fingerprintOf('a.test.mjs', 'case 1').length, 12);
  assert.equal(fingerprintOf('a.test.mjs', 'case 1'), fingerprintOf('a.test.mjs', 'case 1'));
  assert.notEqual(fingerprintOf('a.test.mjs', 'case 1'), fingerprintOf('a.test.mjs', 'case 2'));
});

test('L1 指纹命中：known_existing 零模型调用（A 型）', async () => {
  const entry = REGISTER[0];
  const failure = { testFile: entry.testFile, testName: entry.testName, errorText: '任意文本' };
  // 反向构造 fingerprint 一致的合成条目（种子表的 fingerprint 是语义占位，测试用真指纹）
  const register = [{ fingerprint: fingerprintOf(entry.testFile, entry.testName), classifiedAs: 'known_existing' }];
  const spy = errorFetch('TimeoutError');
  const r = await triageFailure(failure, register, { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(r.classifiedAs, 'known_existing');
  assert.equal(r.layer, 'L1');
  assert.equal(r.confidence, 1);
  assert.equal(spy.count(), 0, 'L1 命中必须零模型调用');
});

test('L2 环境词表：ECONNREFUSED 等确定性命中，零模型调用', async () => {
  for (const text of ['Error: connect ECONNREFUSED 127.0.0.1:3001', 'listen EADDRINUSE :::3001', 'EPERM: operation not permitted, rename']) {
    assert.ok(matchesEnvironmentPattern(text), `词表应命中：${text}`);
  }
  assert.ok(!matchesEnvironmentPattern('AssertionError: expected 1 to be 2'));
  const spy = errorFetch('TimeoutError');
  const r = await triageFailure(
    { testFile: 'test/a.test.mjs', testName: 'x', errorText: 'Error: connect ECONNREFUSED 127.0.0.1:3001' },
    [],
    { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP }
  );
  assert.equal(r.classifiedAs, 'environment');
  assert.equal(r.layer, 'L2');
  assert.equal(spy.count(), 0, 'L2 命中必须零模型调用');
});

test('词表钉住：核心环境模式在册（契约固化，防悄悄删词）', () => {
  const joined = ENVIRONMENT_PATTERNS.map((re) => re.source).join('|');
  for (const needle of ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOSPC', 'EPERM', 'EADDRINUSE']) {
    assert.ok(joined.includes(needle), `词表须含 ${needle}`);
  }
});

test('L3：defect 保守采纳 → 输出 new_regression（D-3 零容忍方向）', async () => {
  const spy = okFetch({ choice: 'defect', probabilities: { defect: 1, environment: 0, flaky: 0 }, confidence: 0.4 });
  const r = await triageFailure(
    { testFile: 'test/a.test.mjs', testName: 'x', errorText: 'AssertionError: expected 5 to equal 4' },
    [],
    { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP }
  );
  assert.equal(r.classifiedAs, 'new_regression');
  assert.equal(r.reason, 'adopted_conservative');
});

test('L3：environment conf=0.99 ≥ θ=0.70 → 采纳', async () => {
  const spy = okFetch({ choice: 'environment', probabilities: { defect: 0, environment: 1, flaky: 0 }, confidence: 0.99 });
  const r = await triageFailure(
    { testFile: 'test/a.test.mjs', testName: 'x', errorText: '上游渠道过载' },
    [],
    { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP }
  );
  assert.equal(r.classifiedAs, 'environment');
  assert.equal(r.reason, 'adopted');
});

test('低置信：flaky conf < θ=0.70 → needs_human 转人工', async () => {
  const spy = okFetch({ choice: 'flaky', probabilities: { defect: 0.2, environment: 0.2, flaky: 0.6 }, confidence: 0.6 });
  const r = await triageFailure(
    { testFile: 'test/a.test.mjs', testName: 'x', errorText: '偶发超时' },
    [],
    { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP }
  );
  assert.equal(r.classifiedAs, 'needs_human');
  assert.equal(r.reason, 'below_threshold');
});

test('L3 决策失败：缺 key → needs_human（不产生错误归类）', async (t) => {
  useEnv(t, { TYPESAFE_API_KEY: undefined });
  const r = await triageFailure(
    { testFile: 'test/a.test.mjs', testName: 'x', errorText: 'AssertionError: boom' },
    [],
    {}
  );
  assert.equal(r.classifiedAs, 'needs_human');
  assert.equal(r.reason, 'no_key');
});

test('L3 决策失败：超时 → needs_human', async () => {
  const spy = errorFetch('TimeoutError');
  const r = await triageFailure(
    { testFile: 'test/a.test.mjs', testName: 'x', errorText: 'boom' },
    [],
    { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP }
  );
  assert.equal(r.classifiedAs, 'needs_human');
  assert.equal(r.reason, 'timeout');
});

test('L3 请求形状：state 含文件/用例/摘要（校准同形）', () => {
  const { state, questions } = buildTriageDecisionRequest({ testFile: 't/x.test.mjs', testName: 'case', errorText: 'boom' });
  assert.match(state, /x\.test\.mjs/);
  assert.match(state, /case/);
  assert.match(state, /boom/);
  assert.equal(questions.attribution.type, 'choice');
  assert.deepEqual(Object.keys(questions.attribution.criteria).sort(), ['defect', 'environment', 'flaky']);
  assert.ok(TRIAGE_THRESHOLD === 0.7, 'θ=0.70（P0 校准证据绑定）');
});
