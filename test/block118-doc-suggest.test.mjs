/**
 * BLOCK-118 P1 — doc-suggest 文档回写建议契约（只附加/确定性硬规则/弃权=零建议/降级=零建议）。
 *
 * 契约红线（plan docs/block-118-dev-decision-tooling-plan.md §1.1/§2）：
 *  - 建议是独立附加输出：不替代任何既有门禁/流程语义；
 *  - 确定性前置层（A 型）：docs/acceptance-only → 零建议零出站；frontend/src → uiAudit 硬命中；
 *  - 决策失败/低置信 → 零建议（安全默认），永不 throw；
 *  - 门控=注册表 per-model 解析（configForPoint），doc-suggest 仅 planDoc 有 Jev 证据门控；
 *  - 逐文档专属 instructions（D-修订三回归门：共用 instructions 曾致五道答案同带、排序随机）。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const thresholds = require(path.join(root, 'core', 'petri-server', 'helpers', 'decision-thresholds.js'));
const {
  DOC_TARGETS,
  buildDocSuggestDecisionRequest,
  deterministicHits,
  resolveDocSuggestions,
  resolveGates,
} = require(path.join(root, 'scripts', 'block118-doc-suggest.mjs'));

const NO_SLEEP = async () => {};
const API_KEY_OVERRIDE = { apiKey: 'test-key-do-not-call-real-api' };

/** 组装 mock fetch：answers 的 noul/choice 按 overrides 定制。 */
function okFetch(answers, model = 'jev-1.13.0') {
  let calls = 0;
  const impl = async () => {
    calls++;
    return {
      ok: true, status: 200,
      json: async () => ({ model, answers }),
    };
  };
  return { impl, count: () => calls };
}

function noulAnswers(values) {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { type: 'noul', noul: v }]));
}

test('DOC_TARGETS 钉住：五 canonical 文档 + 每文档专属 question（D-修订三回归门）', () => {
  assert.deepEqual(
    Object.keys(DOC_TARGETS).sort(),
    ['auditLog', 'handoff', 'planDoc', 'roadmap', 'uiAudit']
  );
  const instructions = new Set(Object.values(DOC_TARGETS).map((t) => t.question));
  assert.equal(instructions.size, 5, '五道 question 必须互不相同（共用曾致答案同带、排序随机）');
});

test('deterministicHits：frontend/src UI 面文件 → uiAudit 硬命中；其余为零', () => {
  assert.deepEqual([...deterministicHits(['frontend/src/pages/home.tsx'])], ['uiAudit']);
  assert.deepEqual([...deterministicHits(['frontend/src/components/copilot/simple-chat.css'])], ['uiAudit']);
  assert.equal(deterministicHits(['core/petri-server/agent-runner.js']).size, 0);
  assert.equal(deterministicHits(['scripts/dev-suggest-run.mjs']).size, 0);
  assert.equal(deterministicHits([]).size, 0);
});

test('docs/acceptance-only：零建议零出站（确定性前置层）', async () => {
  const spy = okFetch(noulAnswers({ roadmap: 1, handoff: 1, uiAudit: 1, auditLog: 1, planDoc: 1 }));
  const r = await resolveDocSuggestions(['docs/AUDIT-LOG.md'], { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(r.suggest, false);
  assert.equal(r.reason, 'docs_or_evidence_only');
  assert.deepEqual(r.suggestions, []);
  assert.equal(spy.count(), 0, '前置层命中必须零出站');
});

test('空输入：零建议零出站', async () => {
  const spy = okFetch(noulAnswers({ roadmap: 1, handoff: 1, uiAudit: 1, auditLog: 1, planDoc: 1 }));
  const r = await resolveDocSuggestions([], { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(r.reason, 'no_input');
  assert.equal(spy.count(), 0);
});

test('uiAudit 硬规则独立于模型：模型低分仍建议；其余文档按门控', async () => {
  const spy = okFetch(noulAnswers({ roadmap: 0.1, handoff: 0.1, uiAudit: 0.01, auditLog: 0.1, planDoc: 0.6 }));
  const r = await resolveDocSuggestions(
    ['frontend/src/pages/home.tsx', 'core/petri-server/db.js'],
    { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP }
  );
  assert.equal(r.suggest, true);
  assert.ok(r.suggestions.includes('uiAudit'), 'uiAudit 必命中（硬规则，模型 0.01 不影响）');
  assert.ok(r.suggestions.includes('planDoc'), 'planDoc noul 0.6 ≥ θ0.5 采纳');
  assert.ok(!r.suggestions.includes('roadmap'), '无证据文档 gate=1 永不采纳');
  const per = r.perDoc;
  assert.equal(per.uiAudit.source, 'deterministic');
  assert.equal(per.planDoc.gate, 0.5);
  assert.equal(spy.count(), 1, '五道问题一次调用');
});

test('降级：决策失败 → 零建议（安全默认，永不 throw）', async () => {
  const impl = async () => { const e = new Error('TimeoutError'); e.name = 'TimeoutError'; throw e; };
  const r = await resolveDocSuggestions(['core/petri-server/agent-runner.js'], { ...API_KEY_OVERRIDE, fetchImpl: impl, sleep: NO_SLEEP });
  assert.equal(r.suggest, false);
  assert.equal(r.reason, 'timeout');
  assert.deepEqual(r.suggestions, []);
});

test('门控解析：doc-suggest 仅 planDoc 有 Jev 证据门控；per-model 未登记回落默认', () => {
  assert.equal(resolveGates('jev-1.13.0').planDoc, 0.5);
  assert.equal(resolveGates('laya@typed-decisions').planDoc, 0.5, '未登记模型回落条目默认');
  assert.equal(resolveGates('jev-1.13.0').uiAudit, 1, '无证据文档 gate=1 永不采纳（确定性规则另有硬命中）');
  const c = thresholds.configForPoint('test-suggest', 'laya@typed-decisions');
  assert.equal(c.threshold, 0.8, 'test-suggest Laya 不可采纳（无 thresholdsByModel）→ 回落 0.8=零建议语义');
});

test('注册表：doc-suggest 证据在位 + 负裁决证据钉住（无证据不改阈值红线）', () => {
  assert.ok(thresholds['doc-suggest'], 'doc-suggest 在册');
  assert.ok(fs.existsSync(path.join(root, thresholds['doc-suggest'].evidence)), 'doc-suggest 校准证据在位');
  const v4 = JSON.parse(fs.readFileSync(path.join(root, 'acceptance/block-118/calibration-doc-suggest-cloud.json'), 'utf8'));
  assert.equal(v4.result.perDoc.planDoc.recommended.theta, 0.5, '注册表 θ 必须与证据推荐一致');
  assert.ok(v4.result.perDoc.planDoc.recommended.adoptedPrecision >= 0.8);
  const layaTs = JSON.parse(fs.readFileSync(path.join(root, 'acceptance/block-118/calibration-test-suggest-laya.json'), 'utf8'));
  assert.equal(layaTs.result.gate.passed, false, 'test-suggest Laya 负裁决钉住');
  assert.equal(layaTs.result.confidenceGate.verdict, 'not_adoptable');
  assert.equal(thresholds['test-suggest'].thresholdsByModel, undefined, 'Laya 不可采纳 → 不落 per-model 阈值');
});

test('请求形状：context 进 state；state 不含 docs/acceptance 防泄漏', () => {
  const { state, questions } = buildDocSuggestDecisionRequest(['a.js', 'b.js'], 'feat(BLOCK-118): 双供给建议工具');
  assert.match(state, /feat\(BLOCK-118\)/);
  assert.match(state, /a\.js/);
  const { state: noCtx } = buildDocSuggestDecisionRequest(['a.js']);
  assert.ok(!noCtx.includes('本次改动说明'), '无 context 时无意图行');
  assert.equal(Object.keys(questions).length, 5);
  assert.ok(Object.values(questions).every((q) => q.type === 'noul'));
});
