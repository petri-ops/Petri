/**
 * BLOCK-194 — LLM-as-judge real 模式契约测（**全离线**：judge 依赖注入，零网络零真模型）。
 *
 * 本包的命门是「质量读数不得变成第二个假绿来源」，所以红绿对都测：
 *  · degraded（judge-core 的 fail-open=调用失败也给 PASS）在评测层**必须判红**；
 *  · observe（无门控阈值）必须判红——没有校准读数的绿不是绿；
 *  · 棘轮只比 verdict 不比 fit 数值：真模型正文每次都变，拿分数差判红必然假红；
 *  · 读数不得含正文/判词原文（沿用 BLOCK-192 入库脱敏纪律）；
 *  · 源码守卫：本层不得自己出题算分（第二套评分器=第二真相）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  collectJudgeReading, judgeGate, compareJudgeVsBaseline, assertJudgeTier, buildJudgeBaseline,
} from '../scripts/lib/evals-judge.mjs';
import { lastAnswerText, sanitizeEvalTasksForStorage } from '../scripts/lib/evals-harness.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PASS_VERDICT = {
  verdict: 'PASS',
  degraded: false,
  reason: null,
  model: 'jev-test-1.0',
  statuses: { fit: { value: 3.05, status: 'pass', gates: { pass: 3, retry: 2.5 } } },
  hints: [],
};

function stubJudge(over = {}) {
  const calls = [];
  const judge = async (input) => {
    calls.push(input);
    return { ...PASS_VERDICT, ...over };
  };
  return { judge, calls };
}

test('读数采集：形状映射齐备，且 request/goals 走任务 judge 配置（缺省回落 prompt）', async () => {
  const task = { id: 'real-x', prompt: '仓库自写 prompt', judge: { goals: ['目标一', '目标二'] } };
  const { judge, calls } = stubJudge({ statuses: { ...PASS_VERDICT.statuses, goals: [{ goalIndex: 0, value: 0.9, status: 'pass' }, { goalIndex: 1, value: 0.2, status: 'fail' }] } });
  const reading = await collectJudgeReading({ task, finalText: '真模型答卷正文', judge });
  assert.equal(reading.id, 'real-x');
  assert.equal(reading.verdict, 'PASS');
  assert.equal(reading.fit, 3.05);
  assert.equal(reading.model, 'jev-test-1.0');
  assert.equal(reading.goals.length, 2);
  assert.deepEqual(reading.goals[1], { index: 1, value: 0.2, status: 'fail' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].output, '真模型答卷正文', '被判文本必须是本次运行的答卷');
  assert.equal(calls[0].request, '仓库自写 prompt', '无 judge.request 时回落任务 prompt');
  assert.deepEqual(calls[0].goals, ['目标一', '目标二']);
  assert.equal(calls[0].reference, '', '无 reference 时忠实性维度不出题（单源纪律在 judge-core）');
});

test('读数采集：judge.request 覆盖生效，邻域复核元数据如实带入', async () => {
  const task = { id: 'real-y', prompt: 'P', judge: { request: '原始请求（与注入 prompt 不同）' } };
  const { judge, calls } = stubJudge({ statuses: { fit: { ...PASS_VERDICT.statuses.fit, replay: { k: 3, median: 3.05, replayErrors: 0, band: 0.5 } } } });
  const reading = await collectJudgeReading({ task, finalText: '答', judge });
  assert.equal(calls[0].request, '原始请求（与注入 prompt 不同）');
  assert.deepEqual(reading.fitReplay, { k: 3, median: 3.05, replayErrors: 0 });
});

test('诚实边界：空答卷不调用 judge，读数标 not_measured（不编造质量证据）', async () => {
  const { judge, calls } = stubJudge();
  const reading = await collectJudgeReading({ task: { id: 'z', prompt: 'P' }, finalText: '   ', judge });
  assert.equal(calls.length, 0, '空正文不得花一次 judge 调用');
  assert.equal(reading.measured, false);
  assert.equal(reading.verdict, 'not_measured');
});

test('judge 抛错如实降级为未测量，不冒绿', async () => {
  const reading = await collectJudgeReading({ task: { id: 'z', prompt: 'P' }, finalText: '答', judge: async () => { throw new Error('boom'); } });
  assert.equal(reading.measured, false);
  assert.equal(reading.verdict, 'judge_exception');
  assert.equal(judgeGate([reading]).ok, false);
});

test('反假绿主测：degraded（fail-open 给 PASS）在评测层=测量不成立，判红', async () => {
  const { judge } = stubJudge({ verdict: 'PASS', degraded: true, reason: 'no_key', model: null, statuses: {} });
  const reading = await collectJudgeReading({ task: { id: 'real-x', prompt: 'P' }, finalText: '答', judge });
  assert.equal(reading.verdict, 'PASS', 'judge-core 的 fail-open 语义未被本层改写');
  assert.equal(reading.degraded, true);
  const gate = judgeGate([reading]);
  assert.equal(gate.ok, false, '降级=未测量，不得当绿');
  assert.equal(gate.invalid.length, 1);
  assert.match(gate.invalid[0].why, /降级|未测量/);
});

test('两层语义：RETRY/ESCALATE 是「质量缺口」（记录+棘轮守），不是测量故障', () => {
  const ok = judgeGate([{ id: 'a', measured: true, degraded: false, verdict: 'PASS' }]);
  assert.equal(ok.ok, true);
  assert.equal(ok.gaps.length, 0);
  const gap = judgeGate([{ id: 'a', measured: true, degraded: false, verdict: 'RETRY', fit: 2.9, fitStatus: 'retry', hintsCount: 1 }]);
  assert.equal(gap.ok, true, '读数成立但落非达标区=缺口信号，不把命令变成永久红');
  assert.deepEqual(gap.gaps, [{ id: 'a', verdict: 'RETRY', fit: 2.9, fitStatus: 'retry', hintsCount: 1 }]);
  for (const verdict of ['observe', 'not_measured', 'judge_exception', 'judge_no_response', 'WEIRD']) {
    const r = judgeGate([{ id: 'a', measured: true, degraded: false, verdict }]);
    assert.equal(r.ok, false, `${verdict} 属测量不成立，必须红`);
    assert.equal(r.invalid.length, 1);
  }
  assert.equal(judgeGate([]).ok, false, '零读数=没测，不得静默绿');
});

test('读数不含正文与判词：入库面只有元数据', async () => {
  const secretBody = '机密答卷正文-勿入库';
  const { judge } = stubJudge({ hints: ['判词提示-勿入库', '另一条'] });
  const reading = await collectJudgeReading({ task: { id: 'real-x', prompt: 'P' }, finalText: secretBody, judge });
  const blob = JSON.stringify(reading);
  assert.equal(blob.includes(secretBody), false);
  assert.equal(blob.includes('判词提示'), false);
  assert.equal(reading.hintsCount, 2, '判词只计数不入库');
});

test('质量棘轮按严重度守「不得后退」：PASS<RETRY<ESCALATE，且不比 fit 数值', () => {
  const greenBase = { readings: [{ id: 'a', measured: true, degraded: false, verdict: 'PASS', fit: 4 }, { id: 'b', measured: true, degraded: false, verdict: 'PASS', fit: 3 }] };
  assert.equal(compareJudgeVsBaseline([{ id: 'a', measured: true, degraded: false, verdict: 'PASS', fit: 3.05 }, { id: 'b', measured: true, degraded: false, verdict: 'PASS', fit: 3 }], greenBase).ok, true, 'fit 数值差不是回归条件（真模型正文每次都变）');
  const fell = compareJudgeVsBaseline([{ id: 'a', measured: true, degraded: false, verdict: 'RETRY', fit: 2.6 }, { id: 'b', measured: true, degraded: false, verdict: 'PASS', fit: 3 }], greenBase);
  assert.equal(fell.ok, false);
  assert.match(fell.regressions.join('|'), /a:judge_verdict PASS→RETRY/);
  const degraded = compareJudgeVsBaseline([{ id: 'a', measured: false, degraded: true, verdict: 'PASS' }, { id: 'b', measured: true, degraded: false, verdict: 'PASS' }], greenBase);
  assert.equal(degraded.ok, false, '降级不得继承基线的绿');
  assert.match(degraded.regressions.join('|'), /a:judge_verdict PASS→invalid/);
  // 非达标基线也有下界：持平=不红，恶化=红，转好=改善。
  const gapBase = { readings: [{ id: 'p', measured: true, degraded: false, verdict: 'RETRY', fit: 2.9 }] };
  assert.equal(compareJudgeVsBaseline([{ id: 'p', measured: true, degraded: false, verdict: 'RETRY', fit: 2.8 }], gapBase).ok, true, '持平（含 fit 微降）不算回归');
  assert.equal(compareJudgeVsBaseline([{ id: 'p', measured: true, degraded: false, verdict: 'ESCALATE', fit: 1 }], gapBase).ok, false, 'RETRY→ESCALATE=恶化必须红');
  const better = compareJudgeVsBaseline([{ id: 'p', measured: true, degraded: false, verdict: 'PASS', fit: 3.2 }], gapBase);
  assert.equal(better.ok, true);
  assert.match(better.improvements.join('|'), /p:judge_verdict RETRY→PASS/);
  const bothBroken = compareJudgeVsBaseline([{ id: 'p', measured: false, degraded: true }], { readings: [{ id: 'p', measured: false, degraded: true }] });
  assert.equal(bothBroken.improvements.length, 0, '坏→坏不得记成改善');
  const missing = compareJudgeVsBaseline([{ id: 'a', measured: true, degraded: false, verdict: 'PASS' }], greenBase);
  assert.equal(missing.ok, false, '基线在册而本次无读数=红');
  assert.match(missing.regressions.join('|'), /b:judge_reading_missing/);
  const fresh = compareJudgeVsBaseline([{ id: 'new', measured: true, degraded: false, verdict: 'PASS' }], greenBase);
  assert.deepEqual(fresh.newTasks, ['new'], '新读数不判红');
  assert.equal(fresh.ok, false, '但基线在册任务缺读数仍红');
});

test('层界：--judge 只对 real 开放，mock/replay 直接拒（伪读数与零 API 属性）', () => {
  assert.equal(assertJudgeTier({ provider: 'real', judgeEnabled: true }).ok, true);
  assert.equal(assertJudgeTier({ provider: 'mock', judgeEnabled: true }).ok, false);
  assert.equal(assertJudgeTier({ provider: 'replay', judgeEnabled: true }).ok, false);
  assert.equal(assertJudgeTier({ provider: 'mock', judgeEnabled: false }).ok, true, '不开判读时零行为变更');
  assert.match(assertJudgeTier({ provider: 'replay', judgeEnabled: true }).reason, /伪读数/);
});

test('基线载荷：记录 judge 模型与「只 gate verdict」口径说明', () => {
  const b = buildJudgeBaseline({ suite: 'real', readings: [{ id: 'a', verdict: 'PASS', model: 'jev-test-1.0', fit: 3 }] });
  assert.equal(b.suite, 'real');
  assert.equal(b.judgeModel, 'jev-test-1.0');
  assert.equal(b.readings.length, 1);
  assert.match(b.note, /verdict/);
  assert.equal(JSON.stringify(b).includes('id'), true);
});

test('设计不漂移守卫：评测层不得自己出题算分（judge 单源在 BLOCK-119）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'evals-judge.mjs'), 'utf8');
  assert.match(src, /from '.\/harness\/judge-supply.mjs'/, '必须经供给单源调 judge（不在评测层碰密钥与模型钉）');
  const supply = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'harness', 'judge-supply.mjs'), 'utf8');
  assert.match(supply, /judge-core\.mjs/, '供给单源仍指回 BLOCK-119 canonical judge-core');
  for (const forbidden of ['完全契合', '答非所问', 'fitPass', 'askDecision', 'systemone']) {
    assert.equal(new RegExp(forbidden).test(src), false, `评测层不得出现出题/阈值/供给细节：${forbidden}`);
  }
  const core = require('../core/petri-server/helpers/judge-core.js');
  const shell = require('../scripts/lib/harness/judge-core.mjs');
  assert.equal(shell.judgeOutput, core.judgeOutput, '薄壳与 canonical 单源同引用（防形状漂移）');
});

test('测量定义：终点答案=最后一次 tool_call 之后的正文帧（不是全程独白拼接）', () => {
  const ev = (content) => ({ choices: [{ delta: { content } }] });
  const events = [ev('我先读一下文件。'), { event: 'tool_call', name: 'workspace_read' }, ev('现在改好了：'), ev('上界改成 i < items.length'), { event: 'done' }];
  assert.equal(lastAnswerText(events), '现在改好了：上界改成 i < items.length');
  assert.equal(lastAnswerText([ev('a'), ev('b')]), 'ab', '无工具轮时等于全拼接（不退化为空）');
  assert.equal(lastAnswerText([]), '', '空事件流诚实返回空（读数层据此标 not_measured）');
  const whole = events.filter((e) => e.choices).map((e) => e.choices[0].delta.content).join('');
  assert.notEqual(lastAnswerText(events), whole, '终点答案必须区别于全程拼接（否则本修复无意义）');
});

test('入库脱敏：finalText 与新增的 finalAnswerText 都不进报告（192 红线不因 194 开口）', () => {
  const stripped = sanitizeEvalTasksForStorage([{ id: 'a', passed: true, criteriaResults: [], finalText: '全程独白原文', finalAnswerText: '终点答案原文' }]);
  const blob = JSON.stringify(stripped);
  assert.equal(blob.includes('全程独白原文'), false);
  assert.equal(blob.includes('终点答案原文'), false, '新正文键漏剥=脱敏红线破口');
  assert.equal(stripped[0].passed, true, '判定字段不受影响');
});

test('套件在册：real 三任务都带 judge 配置（读数有目标可判）', () => {
  const dir = path.join(ROOT, 'evals', 'suites', 'real');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const task = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(task.judge && Array.isArray(task.judge.goals) && task.judge.goals.length > 0, `${f} 缺 judge.goals`);
    for (const g of task.judge.goals) assert.equal(typeof g, 'string');
  }
});
