/**
 * BLOCK-119 P0 — 输出评判门契约（三态路由/降级 fail-open/observe-only/语料隐私/稳定性探针）。
 *
 * 契约红线（plan docs/block-119-output-judge-harness-plan.md §1/§2/§5）：
 *  - 三态路由：任一 fail→ESCALATE；任一 retry（无 fail）→RETRY；否则 PASS；全 observe=observe；
 *  - 降级 fail-open：决策失败=放行（PASS+degraded），永不 throw；
 *  - faithful 仅当 reference 提供才出题；未校准维度（faithfulPass/goalPass 缺键）=observe-only 不参与路由；
 *  - 注册表门控=校准证据绑定（fitPass=3 与证据推荐一致）；
 *  - 语料隐私：corpus-judge-fit.json 只存指针（conv/recordIdx/gold/kind），零原文键；
 *  - probeStability：k 重放多数一致率，2/3 阈，异常样本不中断。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const thresholds = require(path.join(root, 'core', 'petri-server', 'helpers', 'decision-thresholds.js'));
const {
  FIT_RUBRIC,
  buildJudgeRequest,
  parseDimensionStatuses,
  aggregateVerdict,
  retryHints,
  median,
  fitNearThreshold,
  judgeOutput,
} = require(path.join(root, 'scripts', 'lib', 'harness', 'judge-core.mjs'));
const { probeStability } = require(path.join(root, 'scripts', 'lib', 'harness', 'stability-core.mjs'));

const NO_SLEEP = async () => {};
const API_KEY_OVERRIDE = { apiKey: 'test-key-do-not-call-real-api' };

function okFetch(answers, model = 'jev-1.13.0') {
  return async () => ({
    ok: true, status: 200,
    json: async () => ({ model, answers }),
  });
}

function fitAnswer(score) {
  // score 题型 mock：以就近级号为中心的合规分布，score=Σ级号×概率（满足 ±0.05 校验）
  const levels = 5;
  const center = Math.min(levels - 1, Math.max(0, Math.round(score)));
  const probs = Array.from({ length: levels }, () => 0);
  probs[center] = 0.8;
  for (let i = 0; i < levels; i++) if (i !== center) probs[i] = 0.2 / (levels - 1);
  const expected = probs.reduce((a, p, i) => a + i * p, 0);
  return { type: 'score', score: expected, probabilities: Object.fromEntries(probs.map((p, i) => [String(i), p])) };
}

test('请求形状：fit 必出；faithful 仅 reference 提供才出；goals 逐条出题', () => {
  const bare = buildJudgeRequest({ output: 'o', request: 'r' });
  assert.equal(Object.keys(bare.questions).length, 1);
  assert.equal(bare.questions.fit.type, 'score');
  assert.equal(FIT_RUBRIC.length, 5);

  const withRef = buildJudgeRequest({ output: 'o', request: 'r', reference: '材料' });
  assert.ok(withRef.questions.faithful);
  assert.equal(withRef.questions.faithful.type, 'noul');

  const withGoals = buildJudgeRequest({ output: 'o', request: 'r', goals: ['目标一', '目标二'] });
  assert.ok(withGoals.questions.goal_0 && withGoals.questions.goal_1);
  assert.match(withGoals.questions.goal_1.instructions, /目标二/);
});

test('三态路由：fail>retry>pass 聚合（parseDimensionStatuses + aggregateVerdict）', () => {
  const gates = { fitPass: 3, fitRetry: 2.5 };
  const sPass = parseDimensionStatuses({ fit: fitAnswer(3.6) }, gates);
  assert.equal(sPass.fit.status, 'pass');
  assert.equal(aggregateVerdict(sPass), 'PASS');

  const sRetry = parseDimensionStatuses({ fit: fitAnswer(2.7) }, gates);
  assert.equal(sRetry.fit.status, 'retry');
  assert.equal(aggregateVerdict(sRetry), 'RETRY');

  const sFail = parseDimensionStatuses({ fit: fitAnswer(1.8) }, gates);
  assert.equal(sFail.fit.status, 'fail');
  assert.equal(aggregateVerdict(sFail), 'ESCALATE');

  // fit 过但 goal fail → ESCALATE（最差维度主导）
  const sGoal = parseDimensionStatuses(
    { fit: fitAnswer(4), goal_0: { type: 'noul', noul: 0.2 }, goal_1: { type: 'noul', noul: 0.9 } },
    { fitPass: 3, fitRetry: 2.5, goalPass: 0.6 }
  );
  assert.equal(sGoal.goals[0].status, 'fail');
  assert.equal(sGoal.goals[1].status, 'pass');
  assert.equal(aggregateVerdict(sGoal), 'ESCALATE');

  // 未校准维度缺键 → observe-only，不参与路由
  const sObserve = parseDimensionStatuses(
    { fit: fitAnswer(4), faithful: { type: 'noul', noul: 0.1 }, goal_0: { type: 'noul', noul: 0.05 } },
    gates
  );
  assert.equal(sObserve.faithful.status, 'observe');
  assert.equal(sObserve.goals[0].status, 'observe');
  assert.equal(aggregateVerdict(sObserve), 'PASS', 'observe 维度不影响路由');
});

test('retryHints：未过维度出判词，观察维度不出', () => {
  const statuses = parseDimensionStatuses(
    { fit: fitAnswer(2.6), goal_0: { type: 'noul', noul: 0.1 } },
    { fitPass: 3, fitRetry: 2.5, goalPass: 0.6 }
  );
  const hints = retryHints(statuses, ['列出文件清单']);
  assert.ok(hints.some((h) => h.includes('契合度')));
  assert.ok(hints.some((h) => h.includes('列出文件清单')));
  const observeOnly = retryHints(parseDimensionStatuses({ faithful: { type: 'noul', noul: 0.1 } }, {}), []);
  assert.equal(observeOnly.length, 0);
});

test('judgeOutput：采纳路径带 model/statuses；降级=fail-open 放行永不 throw', async () => {
  const r = await judgeOutput({
    output: '已按请求列出全部文件。', request: '列出文件',
    overrides: { ...API_KEY_OVERRIDE, fetchImpl: okFetch({ fit: fitAnswer(3.8) }), sleep: NO_SLEEP },
  });
  assert.equal(r.verdict, 'PASS');
  assert.equal(r.degraded, false);
  assert.equal(r.model, 'jev-1.13.0');
  assert.equal(r.statuses.fit.status, 'pass');

  const impl = async () => { const e = new Error('TimeoutError'); e.name = 'TimeoutError'; throw e; };
  const degraded = await judgeOutput({
    output: 'x', request: 'y',
    overrides: { ...API_KEY_OVERRIDE, fetchImpl: impl, sleep: NO_SLEEP },
  });
  assert.equal(degraded.verdict, 'PASS', '降级=放行（fail-open）');
  assert.equal(degraded.degraded, true);
  assert.equal(degraded.reason, 'timeout');
});

test('注册表：output-judge 证据在位 + 门控=校准推荐一致', () => {
  assert.ok(thresholds['output-judge']);
  const g = thresholds['output-judge'].gates;
  assert.equal(g.fitPass, 3);
  assert.equal(g.fitRetry, 2.5);
  // BLOCK-119 加映 2（2026-09-23）— faithful/goal 校准达标落键，升级为可门控；
  // 键值必须与证据推荐一致（改键必先重校准红线）。
  assert.equal(g.faithfulPass, 0.3, 'faithful 校准 θ（加映 2 证据）');
  assert.equal(g.goalPass, 0.5, 'goal 校准 θ（加映 2 证据）');
  const ev = JSON.parse(fs.readFileSync(path.join(root, thresholds['output-judge'].evidence), 'utf8'));
  assert.equal(ev.recommended.theta, 3, '注册表 θ 必须与证据推荐一致');
  assert.ok(ev.recommended.adoptedPrecision >= 0.8);
  assert.ok(ev.caveat && ev.caveat.includes('下界'), '配对语料下界 caveat 必须在证据中留痕');
  const evFG = JSON.parse(fs.readFileSync(path.join(root, thresholds['output-judge'].evidenceFaithfulGoal), 'utf8'));
  assert.equal(evFG.gate.faithfulPassed, true);
  assert.equal(evFG.gate.goalPassed, true);
  assert.equal(evFG.faithful.recommended.theta, g.faithfulPass, 'faithfulPass 必须与证据推荐一致');
  assert.ok(evFG.faithful.recommended.adoptedPrecision >= 0.85);
  assert.equal(evFG.goal.recommended.theta, g.goalPass, 'goalPass 必须与证据推荐一致');
  assert.ok(evFG.goal.recommended.adoptedPrecision >= 0.85);
  // BLOCK-119 加映 4（2026-09-24）— fitReviewBand 证据绑定（同 θ 红线：改带必先重盘点）。
  assert.equal(g.fitReviewBand, 0.5, '邻域复核带（加映 4 证据）');
  const evVol = JSON.parse(fs.readFileSync(path.join(root, thresholds['output-judge'].evidenceFitVolatility), 'utf8'));
  assert.equal(evVol.recommended.fitReviewBand, g.fitReviewBand, 'fitReviewBand 必须与盘点证据推荐一致');
  assert.ok(evVol.fiveFoldExperiment.spread >= 0.5, '波动带证据在位（同一文本 spread ≥ band）');
  assert.ok(evVol.trueNegatives.max < 1, '真负例远离阈值的事实必须留痕（无漏放路径）');
});

test('语料隐私：corpus-judge-fit.json 只存指针零原文', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(root, 'acceptance', 'block-119', 'corpus-judge-fit.json'), 'utf8'));
  assert.ok(doc.samples.length >= 100);
  const banned = ['request', 'output', 'content', 'messages', 'text'];
  for (const s of doc.samples) {
    for (const key of Object.keys(s)) {
      assert.ok(!banned.includes(key), `样本 ${s.id} 含违禁原文键 ${key}（隐私红线）`);
    }
    assert.ok(s.conv || (s.requestFrom && s.outputFrom), '指针字段在位');
  }
});

test('probeStability：多数一致率与 2/3 阈；异常样本不中断', async () => {
  let i = 0;
  const seq = [{ a: 1 }, { a: 1 }, { a: 2 }];
  const r1 = await probeStability(async () => seq[i++ % 3], 3);
  assert.equal(r1.k, 3);
  assert.equal(r1.agreementRate, 0.6667);
  assert.equal(r1.verdict, 'stable');

  const r2 = await probeStability(async (n) => (n === 1 ? Promise.reject(new Error('boom')) : { a: 1 }), 3);
  assert.equal(r2.successCount, 2);
  assert.equal(r2.errorCount, 1);
  assert.equal(r2.agreementRate, 1);
  assert.equal(r2.verdict, 'stable');

  let j = 0;
  const r3 = await probeStability(async () => [1, 2, 3][j++], 3);
  assert.equal(r3.verdict, 'unstable');
});

// ── BLOCK-119 加映 4 — fit 阈值邻域复核（band + median-of-3）──

/** 精确分数 mock：两点分布使期望严格等于 score（Σ级号×概率±0.05 校验内）。 */
function fitAnswerExact(score) {
  const lo = Math.max(0, Math.min(4, Math.floor(score)));
  const hi = Math.min(4, lo + 1);
  const w = Math.max(0, Math.min(1, score - lo));
  const probabilities = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i), 0]));
  probabilities[String(lo)] += 1 - w;
  if (hi !== lo) probabilities[String(hi)] += w;
  return { type: 'score', score, probabilities };
}

/** 按调用序返回不同 answers 的 fetch mock（首判→重放→复判共用一个计数器）。 */
function seqFetch(scoreFn, model = 'jev-1.13.0') {
  let n = 0;
  const calls = { count: 0 };
  const fetchImpl = async () => {
    calls.count++;
    const score = scoreFn(n++);
    return { ok: true, status: 200, json: async () => ({ model, answers: { fit: fitAnswerExact(score) } }) };
  };
  return { fetchImpl, calls };
}

test('加映 4：median 与 fitNearThreshold 纯函数（边界含等号、band=0/缺门不复核）', () => {
  assert.equal(median([3.1, 2.7, 3.1]), 3.1);
  assert.equal(median([1, 2, 3, 4]), 2.5, '偶数取均值');
  assert.equal(median(['x', null]), null, '非数值全滤掉=null');
  const gates = { fitPass: 3, fitRetry: 2.5, fitReviewBand: 0.5 };
  assert.equal(fitNearThreshold(2.5, gates), true, '带下界含等号');
  assert.equal(fitNearThreshold(3.5, gates), true, '带上界含等号');
  assert.equal(fitNearThreshold(2.49, gates), false);
  assert.equal(fitNearThreshold(3.51, gates), false);
  assert.equal(fitNearThreshold(2.7, { fitPass: 3, fitRetry: 2.5 }), false, '无 band 键=不复核');
  assert.equal(fitNearThreshold(2.7, { fitPass: 3, fitRetry: 2.5, fitReviewBand: 0 }), false, 'band=0=显式关闭');
  assert.equal(fitNearThreshold('x', gates), false);
});

test('加映 4：邻域首判触发 fit-only 重放，中位数重建路由（RETRY 区→PASS 翻转）', async () => {
  // 首判 2.7（RETRY 区，|2.7−3|=0.3 落带内）→ 重放 2 次 3.1 → median(2.7,3.1,3.1)=3.1=PASS
  const { fetchImpl, calls } = seqFetch((n) => (n === 0 ? 2.7 : 3.1));
  const r = await judgeOutput({
    output: 'o', request: 'r',
    overrides: { ...API_KEY_OVERRIDE, fetchImpl, sleep: NO_SLEEP },
  });
  assert.equal(calls.count, 3, '首判 1 + fit-only 重放 2');
  assert.equal(r.verdict, 'PASS', '中位数 3.1 ≥ fitPass=3 → 翻转 RETRY');
  assert.equal(r.statuses.fit.value, 3.1, 'fit 值=中位数');
  assert.deepEqual(
    { triggered: r.statuses.fit.replay.triggered, k: r.statuses.fit.replay.k, fits: r.statuses.fit.replay.fits, median: r.statuses.fit.replay.median, band: r.statuses.fit.replay.band, replayErrors: r.statuses.fit.replay.replayErrors },
    { triggered: true, k: 3, fits: [2.7, 3.1, 3.1], median: 3.1, band: 0.5, replayErrors: 0 }
  );
});

test('加映 4：反方向同样成立（首判 PASS 区落带内，中位数拉回 RETRY——防单侧偏置）', async () => {
  // 首判 3.2（|3.2−3|=0.2 落带内）→ 重放 2.6×2 → median(3.2,2.6,2.6)=2.6=RETRY 区
  const { fetchImpl, calls } = seqFetch((n) => (n === 0 ? 3.2 : 2.6));
  const r = await judgeOutput({
    output: 'o', request: 'r',
    overrides: { ...API_KEY_OVERRIDE, fetchImpl, sleep: NO_SLEEP },
  });
  assert.equal(calls.count, 3);
  assert.equal(r.verdict, 'RETRY', '中位数 2.6 < fitPass → 复核不偏袒放行');
  assert.equal(r.statuses.fit.value, 2.6);
  assert.ok(r.hints.length > 0, 'RETRY 带判词');
});

test('加映 4：带外零开销——高分区与 fail 区都不触发重放', async () => {
  const hi = seqFetch(() => 3.8);
  const rHi = await judgeOutput({
    output: 'o', request: 'r',
    overrides: { ...API_KEY_OVERRIDE, fetchImpl: hi.fetchImpl, sleep: NO_SLEEP },
  });
  assert.equal(hi.calls.count, 1, '3.8 距 θ=0.8 出带，零额外调用');
  assert.equal(rHi.verdict, 'PASS');
  assert.equal(rHi.statuses.fit.replay, undefined, '未触发时无 replay 键');

  const lo = seqFetch(() => 1.8);
  const rLo = await judgeOutput({
    output: 'o', request: 'r',
    overrides: { ...API_KEY_OVERRIDE, fetchImpl: lo.fetchImpl, sleep: NO_SLEEP },
  });
  assert.equal(lo.calls.count, 1, '1.8 距 θ=1.2 出带，零额外调用');
  assert.equal(rLo.verdict, 'ESCALATE');
});

test('加映 4：重放全败沿用首判（fail-open 不变，replayErrors 留痕）', async () => {
  let n = 0;
  const fetchImpl = async () => {
    if (n++ === 0) return { ok: true, status: 200, json: async () => ({ model: 'jev-1.13.0', answers: { fit: fitAnswerExact(2.7) } }) };
    throw new Error('replay down');
  };
  const r = await judgeOutput({
    output: 'o', request: 'r',
    overrides: { ...API_KEY_OVERRIDE, fetchImpl, sleep: NO_SLEEP },
  });
  assert.equal(r.verdict, 'RETRY', '沿用首判路由');
  assert.equal(r.statuses.fit.value, 2.7);
  assert.equal(r.statuses.fit.replay.replayErrors, 2);
  assert.match(r.statuses.fit.replay.note, /沿用首判/);
});

test('加映 4：band=0（注册表临时置 0）→ 邻域不复核', async () => {
  const entry = thresholds['output-judge'];
  const saved = entry.gates.fitReviewBand;
  entry.gates.fitReviewBand = 0;
  try {
    const { fetchImpl, calls } = seqFetch(() => 2.7);
    const r = await judgeOutput({
      output: 'o', request: 'r',
      overrides: { ...API_KEY_OVERRIDE, fetchImpl, sleep: NO_SLEEP },
    });
    assert.equal(calls.count, 1, 'band=0 邻域不重放');
    assert.equal(r.verdict, 'RETRY');
  } finally {
    entry.gates.fitReviewBand = saved;
  }
});
