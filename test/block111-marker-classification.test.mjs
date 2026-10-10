/**
 * BLOCK-111 W1-1 — marker→细胞类型判别二跳契约（候选生成 / 请求形状 / 门控 / 降级 / 红线）。
 *
 * 契约红线（plan docs/block-111-jev-w1-marker-classification-plan.md §2.2/§6）：
 *   - CELL_MARKERS 规则表唯一候选生成，模型只挑不造（choice∉criteria 由 decision-api 校验拒收）；
 *   - 候选集为空 → 零出站直返 null（A 型边界：无候选不问模型）；
 *   - 默认关（PETRI_JEV_MARKER_GUARD=1 显式开）= 零出站零行为变化；
 *   - 任何失败形态（缺 key/超时/校验失败/网络失败/HTTP 错误）回退 lookupCellType 现行结果，永不 throw；
 *   - 单阈值门控（D-5：MARKER_DECISION_THRESHOLD=0.55，P0 校准证据 acceptance/block-111/calibration.json）。
 *
 * 降级注入走 decision-api 既有 overrides 通道（fetchImpl/sleep/apiKey），生产路径零传参。
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
  MARKER_DECISION_THRESHOLD,
  lookupCellType,
  deriveMarkerCandidates,
  buildMarkerDecisionRequest,
  isMarkerGuardEnabled,
  lookupCellTypeWithConfidence,
} = require(path.join(root, 'core', 'petri-server', 'helpers', 'interpret.js'));

const NO_SLEEP = async () => {};

/** 临时 env；测试结束恢复。 */
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

/** 成功响应桩：计数 + 固定 answers.cell_type。 */
function okFetch(answer) {
  let calls = 0;
  const impl = async () => {
    calls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ model: 'jev-1.13.0', answers: { cell_type: answer } }),
    };
  };
  return { impl, count: () => calls };
}

/** 失败响应桩（非 2xx）。 */
function failFetch(status) {
  let calls = 0;
  const impl = async () => {
    calls++;
    return { ok: false, status, text: async () => `HTTP ${status}`, headers: { get: () => null } };
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

const GUARD_ON = { PETRI_JEV_MARKER_GUARD: '1' };
const API_KEY_OVERRIDE = { apiKey: 'test-key-do-not-call-real-api' };

test('lookupCellType 现行契约零变化（legacy 回退目标）', () => {
  assert.equal(lookupCellType(['CD3E', 'CD3D']), 'T 细胞 (T cell)');
  assert.equal(lookupCellType(['cd3e', 'CD3D', 'CD3G', 'cd2']), 'T 细胞 (T cell)');
  assert.equal(lookupCellType(['MS4A1', 'CD79A', 'CD79B', 'CD19']), 'B 细胞');
  assert.equal(lookupCellType(['CD3E', 'LYZ']), null, '单基因命中不足 2 → null');
  assert.equal(lookupCellType(['ACTB', 'GAPDH']), null);
  assert.equal(lookupCellType([]), null);
});

test('deriveMarkerCandidates：空集/单候选/双候选/命中数降序/大小写', () => {
  assert.deepEqual(deriveMarkerCandidates([]), []);
  assert.deepEqual(deriveMarkerCandidates(['ACTB', 'GAPDH']), []);

  const single = deriveMarkerCandidates(['CD3E', 'CD3D']);
  assert.equal(single.length, 1);
  assert.equal(single[0].type, 'T 细胞 (T cell)');
  assert.equal(single[0].matches, 2);

  const doublet = deriveMarkerCandidates(['CD3E', 'CD3D', 'MS4A1', 'CD79A']);
  assert.equal(doublet.length, 2);
  assert.deepEqual(doublet.map((c) => c.type).sort(), ['B 细胞', 'T 细胞 (T cell)'].sort());

  const bFull = deriveMarkerCandidates(['MS4A1', 'CD79A', 'CD79B', 'CD19', 'CD3E', 'CD3D']);
  assert.equal(bFull[0].type, 'B 细胞', '命中数多的候选排前');
  assert.equal(bFull[0].matches, 4);
  assert.equal(bFull[1].matches, 2);

  const cd8 = deriveMarkerCandidates(['cd8a', 'Cd8B']);
  assert.equal(cd8.length, 1);
  assert.equal(cd8[0].type, 'CD8+ T 细胞', '两基因规则 + 大小写不敏感');
});

test('buildMarkerDecisionRequest：请求形状钉（P0 校准同形）', () => {
  const candidates = deriveMarkerCandidates(['CD3E', 'CD3D', 'MS4A1', 'CD79A']);
  const { state, questions } = buildMarkerDecisionRequest(['CD3E', 'CD3D', 'MS4A1', 'CD79A'], candidates);

  assert.match(state, /CD3E, CD3D, MS4A1, CD79A/);
  assert.match(state, /候选细胞类型/);
  for (const c of candidates) {
    assert.ok(state.includes(c.type), `state 含候选 ${c.type}`);
    assert.ok(state.includes(`命中参考基因 ${c.matches}/${c.total}`));
  }
  const q = questions.cell_type;
  assert.equal(q.type, 'choice');
  assert.deepEqual(Object.keys(q.criteria), candidates.map((c) => c.type));
  for (const c of candidates) assert.equal(q.criteria[c.type], `参考 marker 组合：${c.key}`);
  assert.match(q.instructions, /confidence/);
});

test('默认关：零出站 + 零行为变化（D-4）', async (t) => {
  useEnv(t, { PETRI_JEV_MARKER_GUARD: undefined });
  const fetchSpy = errorFetch('TimeoutError'); // 若被误调立即暴露
  const r = await lookupCellTypeWithConfidence(['CD3E', 'CD3D'], { ...API_KEY_OVERRIDE, fetchImpl: fetchSpy.impl, sleep: NO_SLEEP });
  assert.equal(isMarkerGuardEnabled(), false);
  assert.equal(r.type, 'T 细胞 (T cell)');
  assert.equal(r.adopted, false);
  assert.equal(r.confidence, null);
  assert.equal(r.reason, 'guard_disabled');
  assert.equal(fetchSpy.count(), 0, 'guard 关必须零出站');
});

test('guard 开 + 零候选：不出站直返 null（A 型边界）', async (t) => {
  useEnv(t, GUARD_ON);
  const fetchSpy = errorFetch('TimeoutError');
  const r = await lookupCellTypeWithConfidence(['ACTB', 'GAPDH'], { ...API_KEY_OVERRIDE, fetchImpl: fetchSpy.impl, sleep: NO_SLEEP });
  assert.equal(r.type, null);
  assert.equal(r.adopted, false);
  assert.equal(r.reason, 'no_candidates');
  assert.equal(fetchSpy.count(), 0, '候选集为空必须零出站');
});

test('guard 开 + 缺 key：no_key 回退现行', async (t) => {
  useEnv(t, { ...GUARD_ON, TYPESAFE_API_KEY: undefined });
  const r = await lookupCellTypeWithConfidence(['CD3E', 'CD3D'], {});
  assert.equal(r.reason, 'no_key');
  assert.equal(r.type, 'T 细胞 (T cell)');
  assert.equal(r.adopted, false);
});

test('guard 开 + 超时重试耗尽：timeout 回退现行', async (t) => {
  useEnv(t, GUARD_ON);
  const fetchSpy = errorFetch('TimeoutError');
  const r = await lookupCellTypeWithConfidence(['CD3E', 'CD3D'], { ...API_KEY_OVERRIDE, fetchImpl: fetchSpy.impl, sleep: NO_SLEEP });
  assert.equal(r.reason, 'timeout');
  assert.equal(r.type, 'T 细胞 (T cell)');
  assert.equal(r.adopted, false);
  assert.equal(fetchSpy.count(), 3, 'wrapper 默认重试 3 次');
});

test('guard 开 + HTTP 500：http_error 回退现行', async (t) => {
  useEnv(t, GUARD_ON);
  const fetchSpy = failFetch(500);
  const r = await lookupCellTypeWithConfidence(['CD3E', 'CD3D'], { ...API_KEY_OVERRIDE, fetchImpl: fetchSpy.impl, sleep: NO_SLEEP });
  assert.equal(r.reason, 'http_error');
  assert.equal(r.type, 'T 细胞 (T cell)');
});

test('guard 开 + 网络失败：network_error 回退现行', async (t) => {
  useEnv(t, GUARD_ON);
  const fetchSpy = errorFetch('TypeError');
  const r = await lookupCellTypeWithConfidence(['CD3E', 'CD3D'], { ...API_KEY_OVERRIDE, fetchImpl: fetchSpy.impl, sleep: NO_SLEEP });
  assert.equal(r.reason, 'network_error');
  assert.equal(r.type, 'T 细胞 (T cell)');
});

test('红线：choice 不在候选集内必拒（模型只挑不造）', async (t) => {
  useEnv(t, GUARD_ON);
  const candidates = deriveMarkerCandidates(['CD3E', 'CD3D', 'MS4A1', 'CD79A']);
  const probs = {};
  for (const c of candidates) probs[c.type] = 0.5;
  const fetchSpy = okFetch({ choice: '不属于候选的虚构类型', probabilities: probs, confidence: 0.99 });
  const r = await lookupCellTypeWithConfidence(['CD3E', 'CD3D', 'MS4A1', 'CD79A'], { ...API_KEY_OVERRIDE, fetchImpl: fetchSpy.impl, sleep: NO_SLEEP });
  assert.equal(r.reason, 'invalid_response', '伪造候选须被 wrapper 响应校验拒收');
  assert.equal(r.adopted, false);
  assert.equal(r.type, 'T 细胞 (T cell)', '拒收后回退现行字符串');
});

test('门控采纳：confidence ≥ 0.55 → adopted + probabilities 透传', async (t) => {
  useEnv(t, GUARD_ON);
  const probabilities = { 'B 细胞': 0.72, 'T 细胞 (T cell)': 0.28 };
  const fetchSpy = okFetch({ choice: 'B 细胞', probabilities, confidence: 0.9 });
  const r = await lookupCellTypeWithConfidence(['CD3E', 'CD3D', 'MS4A1', 'CD79A'], { ...API_KEY_OVERRIDE, fetchImpl: fetchSpy.impl, sleep: NO_SLEEP });
  assert.equal(r.reason, 'adopted');
  assert.equal(r.adopted, true);
  assert.equal(r.type, 'B 细胞');
  assert.equal(r.confidence, 0.9);
  assert.deepEqual(r.probabilities, probabilities);
});

test('门控回退：confidence < 0.55 → 现行字符串 + 实测 confidence 透传', async (t) => {
  useEnv(t, GUARD_ON);
  const fetchSpy = okFetch({ choice: 'T 细胞 (T cell)', probabilities: { 'T 细胞 (T cell)': 1 }, confidence: 0.3 });
  const r = await lookupCellTypeWithConfidence(['CD3E', 'CD3D'], { ...API_KEY_OVERRIDE, fetchImpl: fetchSpy.impl, sleep: NO_SLEEP });
  assert.equal(r.reason, 'below_threshold');
  assert.equal(r.adopted, false);
  assert.equal(r.type, 'T 细胞 (T cell)', '回退态 type=现行规则表结果');
  assert.equal(r.confidence, 0.3, '回退态仍透传实测 confidence（可观测）');
});

test('阈值边界：confidence 恰等于 0.55 采纳', async (t) => {
  useEnv(t, GUARD_ON);
  assert.equal(MARKER_DECISION_THRESHOLD, 0.55, 'D-5 阈值定版（调整须先重校准）');
  const fetchSpy = okFetch({ choice: 'T 细胞 (T cell)', probabilities: { 'T 细胞 (T cell)': 1 }, confidence: 0.55 });
  const r = await lookupCellTypeWithConfidence(['CD3E', 'CD3D'], { ...API_KEY_OVERRIDE, fetchImpl: fetchSpy.impl, sleep: NO_SLEEP });
  assert.equal(r.reason, 'adopted');
});

test('guard 开 + P0 校准语料歧义陷阱样本：低置信回退路径端到端', async (t) => {
  useEnv(t, GUARD_ON);
  // mc-amb-02 实测：模型选 cytotoxic conf 0.11 → 回退 legacy（legacy 首个最高分 = CD8）
  const fetchSpy = okFetch({ choice: '细胞毒性 T/NK 细胞', probabilities: { 'CD8+ T 细胞': 0.3, '细胞毒性 T/NK 细胞': 0.7 }, confidence: 0.11 });
  const r = await lookupCellTypeWithConfidence(['CD8A', 'CD8B', 'GZMB', 'GNLY'], { ...API_KEY_OVERRIDE, fetchImpl: fetchSpy.impl, sleep: NO_SLEEP });
  assert.equal(r.reason, 'below_threshold');
  assert.equal(r.adopted, false);
  assert.equal(r.type, 'CD8+ T 细胞');
});
