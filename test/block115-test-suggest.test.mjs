/**
 * BLOCK-115 W1-5 — 增量式测试选择建议契约（只加不减/弃权=零建议/降级=零建议）。
 *
 * 契约红线（plan docs/block-115-test-suggest-plan.md §1.1/§2）：
 *  - 建议是独立附加输出：静态 impact-map 下限不经本工具，任何分支都不可能减少它（D-5）；
 *  - 确定性前置层（A 型）：改动全为 docs/**、acceptance/** → 零建议零出站；
 *  - 决策失败/低置信/none 弃权 → 零建议（安全默认），永不 throw；
 *  - D-3 θ=0.80（P0 校准证据 acceptance/block-115/calibration.json）。
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
  SUGGEST_THRESHOLD,
  TEST_AREAS,
  buildSuggestDecisionRequest,
  docsOrEvidenceOnly,
  resolveSuggestion,
} = require(path.join(root, 'scripts', 'block115-test-suggest.mjs'));

const NO_SLEEP = async () => {};
const API_KEY_OVERRIDE = { apiKey: 'test-key-do-not-call-real-api' };

/** 按 criteria 键生成完备概率分布（wrapper 校验要求键完备/和≈1/argmax 一致）。 */
function fullProbs(choice, confidence) {
  const others = Object.keys(TEST_AREAS).filter((k) => k !== choice);
  const rest = (1 - confidence) / Math.max(others.length, 1);
  const probs = { [choice]: confidence };
  for (const k of others) probs[k] = rest;
  return probs;
}

function okFetch(answer) {
  let calls = 0;
  const impl = async () => {
    calls++;
    return { ok: true, status: 200, json: async () => ({ model: 'jev-1.13.0', answers: { area: answer } }) };
  };
  return { impl, count: () => calls };
}

test('类目集钉住：6 域 + none（P0 粗化定版）', () => {
  assert.deepEqual(
    Object.keys(TEST_AREAS).sort(),
    ['agent-backend', 'conversation-copilot', 'infra-platform', 'ipc-preload', 'knowledge-result', 'none', 'ui-shell-frontend']
  );
  assert.ok(TEST_AREAS['agent-backend'].tests.length >= 3);
  assert.equal(typeof TEST_AREAS.none, 'string', 'none 是弃权语义不是域');
});

test('docsOrEvidenceOnly：docs/acceptance 确定性判定', () => {
  assert.equal(docsOrEvidenceOnly(['docs/AUDIT-LOG.md']), true);
  assert.equal(docsOrEvidenceOnly(['acceptance/block-111/calibration.json', 'docs/README.md']), true);
  assert.equal(docsOrEvidenceOnly(['core/biof3-server/agent-runner.js']), false);
  assert.equal(docsOrEvidenceOnly(['docs/A.md', 'core/biof3-server/db.js']), false, '混合改动不判 docs-only');
  assert.equal(docsOrEvidenceOnly([]), false);
});

test('docs/acceptance-only：零建议零出站（确定性前置层）', async () => {
  const spy = okFetch({ choice: 'knowledge-result', probabilities: {}, confidence: 1 });
  const r = await resolveSuggestion(['docs/AUDIT-LOG.md'], { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(r.suggest, false);
  assert.equal(r.reason, 'docs_or_evidence_only');
  assert.deepEqual(r.suggestions, []);
  assert.equal(spy.count(), 0, '前置层命中必须零出站');
});

test('决策失败：缺 key → 零建议（安全默认）', async (t) => {
  useEnv(t, { TYPESAFE_API_KEY: undefined });
  const r = await resolveSuggestion(['core/biof3-server/agent-runner.js'], {});
  assert.equal(r.suggest, false);
  assert.equal(r.reason, 'no_key');
  assert.deepEqual(r.suggestions, []);
});

test('决策失败：超时 → 零建议', async () => {
  const impl = async () => { const e = new Error('TimeoutError'); e.name = 'TimeoutError'; throw e; };
  const r = await resolveSuggestion(['core/biof3-server/agent-runner.js'], { ...API_KEY_OVERRIDE, fetchImpl: impl, sleep: NO_SLEEP });
  assert.equal(r.reason, 'timeout');
  assert.equal(r.suggest, false);
});

test('弃权：area=none 高置信 → 零建议', async () => {
  const spy = okFetch({ choice: 'none', probabilities: fullProbs('none', 0.99), confidence: 0.99 });
  const r = await resolveSuggestion(['docs/x.md', 'core/biof3-server/db.js'], { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(r.suggest, false);
  assert.equal(r.reason, 'area_none');
});

test('低置信：conf < θ=0.80 → 零建议', async () => {
  const spy = okFetch({ choice: 'agent-backend', probabilities: fullProbs('agent-backend', 0.6), confidence: 0.6 });
  const r = await resolveSuggestion(['core/biof3-server/agent-runner.js'], { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(r.suggest, false);
  assert.equal(r.reason, 'below_threshold');
});

test('采纳：conf ≥ 0.80 → 展开该域测试建议（只加不减结构：建议来自展开表）', async () => {
  const spy = okFetch({ choice: 'agent-backend', probabilities: fullProbs('agent-backend', 0.9), confidence: 0.9 });
  const r = await resolveSuggestion(['core/biof3-server/agent-runner.js'], { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(r.suggest, true);
  assert.equal(r.area, 'agent-backend');
  assert.deepEqual(r.suggestions, TEST_AREAS['agent-backend'].tests, '建议=域展开表（结构化只加）');
});

test('空输入：零建议零出站', async () => {
  const spy = okFetch({ choice: 'none', probabilities: {}, confidence: 1 });
  const r = await resolveSuggestion([], { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(r.reason, 'no_input');
  assert.equal(spy.count(), 0);
});

test('请求形状：state 含改动清单 + criteria 不含 none（校准同形）', () => {
  const { state, questions } = buildSuggestDecisionRequest(['a.js', 'b.js']);
  assert.match(state, /a\.js/);
  assert.match(state, /b\.js/);
  assert.equal(questions.area.type, 'choice');
  assert.ok('none' in questions.area.criteria, 'none 显式弃权选项在候选内（D-1）');
  assert.equal(SUGGEST_THRESHOLD, 0.8, 'D-3 θ=0.80（P0 校准证据绑定）');
});

function useEnv(t, env) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  t.after(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}
