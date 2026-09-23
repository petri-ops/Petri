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

const thresholds = require(path.join(root, 'core', 'biof3-server', 'helpers', 'decision-thresholds.js'));
const {
  FIT_RUBRIC,
  buildJudgeRequest,
  parseDimensionStatuses,
  aggregateVerdict,
  retryHints,
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
  assert.equal(g.faithfulPass, undefined, 'faithful 未校准=observe-only（缺键红线）');
  assert.equal(g.goalPass, undefined, 'goal 未校准=observe-only（缺键红线）');
  const ev = JSON.parse(fs.readFileSync(path.join(root, thresholds['output-judge'].evidence), 'utf8'));
  assert.equal(ev.recommended.theta, 3, '注册表 θ 必须与证据推荐一致');
  assert.ok(ev.recommended.adoptedPrecision >= 0.8);
  assert.ok(ev.caveat && ev.caveat.includes('下界'), '配对语料下界 caveat 必须在证据中留痕');
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
