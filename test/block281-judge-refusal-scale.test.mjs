import test from 'node:test';
import assert from 'node:assert/strict';
import { FIT_RUBRIC, buildJudgeRequest, parseDimensionStatuses } from '../core/petri-server/helpers/judge-core.js';

// BLOCK-281 — C-27 清偿：judge 拒绝读数口径（量表与指令拒绝条款钉扎）。
// 行为级红绿证据（Jev cloud probe，2026-10-28）：同一教科书级拒绝，
// 旧口径 fit=2.38 → ESCALATE；新口径 fit=3.73 → PASS。

test('C-27 — 量表仍为五级（既有锚不破）', () => {
  assert.equal(FIT_RUBRIC.length, 5);
});

test('C-27 — 3 级含恰当拒绝条款；4 级含不可执行分支', () => {
  assert.match(FIT_RUBRIC[3], /恰当拒绝/);
  assert.match(FIT_RUBRIC[3], /贴近真实目标的可行替代/);
  assert.match(FIT_RUBRIC[4], /不可执行/);
});

test('C-27 — fit 指令含拒绝评分指引（生硬拒绝按 2 评，有效拒绝 3~4）', () => {
  const { questions } = buildJudgeRequest({ output: 'x', request: 'y' });
  assert.match(questions.fit.instructions, /不可执行或不安全/);
  assert.match(questions.fit.instructions, /按 3~4 评分/);
  assert.match(questions.fit.instructions, /只说不行、无替代.*按 2/);
});

test('C-27 — 门限解析不受影响（3/2.5 配对语义保持）', () => {
  const gates = { fitPass: 3, fitRetry: 2.5 };
  assert.equal(parseDimensionStatuses({ fit: { score: 3.73 } }, gates).fit.status, 'pass');
  assert.equal(parseDimensionStatuses({ fit: { score: 2.6 } }, gates).fit.status, 'retry');
  assert.equal(parseDimensionStatuses({ fit: { score: 2.38 } }, gates).fit.status, 'fail');
});
