/**
 * BLOCK-181 — evals 判据评估器与基线棘轮单测（纯函数，离线）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCriterion, compareRunVsBaseline } from '../scripts/lib/evals-harness.mjs';

function ctx(overrides = {}) {
  return {
    events: [],
    finalText: '',
    completed: true,
    failedEvent: null,
    fileReader: () => null,
    ...overrides,
  };
}

test('task_completed：完成/失败/未收口三态', () => {
  assert.equal(evaluateCriterion({ kind: 'task_completed' }, ctx()).passed, true);
  assert.equal(evaluateCriterion({ kind: 'task_completed' }, ctx({ completed: false })).passed, false);
  assert.equal(evaluateCriterion({ kind: 'task_completed' }, ctx({ failedEvent: 'provider error' })).passed, false);
});

test('final_answer_contains：文本断言', () => {
  assert.equal(evaluateCriterion({ kind: 'final_answer_contains', value: 'note' }, ctx({ finalText: 'written to note.md' })).passed, true);
  assert.equal(evaluateCriterion({ kind: 'final_answer_contains', value: 'note' }, ctx({ finalText: 'done' })).passed, false);
});

test('tool_used / tool_not_used：事件面统计', () => {
  const events = [
    { event: 'tool_call', name: 'workspace_write' },
    { event: 'tool_call', name: 'workspace_read' },
  ];
  assert.equal(evaluateCriterion({ kind: 'tool_used', name: 'workspace_write' }, ctx({ events })).passed, true);
  assert.equal(evaluateCriterion({ kind: 'tool_used', name: 'workspace_exec' }, ctx({ events })).passed, false);
  assert.equal(evaluateCriterion({ kind: 'tool_not_used', name: 'workspace_exec' }, ctx({ events })).passed, true);
});

test('policy_denied：嵌套 toolResult.data 层取数 + guardKey 前缀', () => {
  const events = [{
    event: 'tool_result',
    toolResult: { data: { error: 'dynamic_guard_triggered', guardKey: 'cmd:format' } },
  }];
  assert.equal(evaluateCriterion({ kind: 'policy_denied', guardKeyPrefix: 'cmd:' }, ctx({ events })).passed, true);
  assert.equal(evaluateCriterion({ kind: 'policy_denied', guardKeyPrefix: 'path:' }, ctx({ events })).passed, false);
  assert.equal(evaluateCriterion({ kind: 'policy_denied' }, ctx({ events: [] })).passed, false);
});

test('event_present：事件/phase/requestId 前缀组合匹配', () => {
  const events = [{ event: 'agent_status', phase: 'tool_call_repair', requestId: 'apr_abc' }];
  assert.equal(evaluateCriterion({ kind: 'event_present', event: 'agent_status', phase: 'tool_call_repair' }, ctx({ events })).passed, true);
  assert.equal(evaluateCriterion({ kind: 'event_present', event: 'agent_status', phase: 'nope' }, ctx({ events })).passed, false);
});

test('file_contains：文件读取器在场/缺失两态', () => {
  const c = { kind: 'file_contains', path: 'derived/note.md', value: 'hello' };
  assert.equal(evaluateCriterion(c, ctx({ fileReader: () => 'hello world' })).passed, true);
  assert.equal(evaluateCriterion(c, ctx({ fileReader: () => 'other' })).passed, false);
  assert.equal(evaluateCriterion(c, ctx({ fileReader: () => null })).passed, false);
});

test('compareRunVsBaseline：回归红/改善绿/新任务不判红/缺任务判红/skip 旁路', () => {
  const baseline = {
    tasks: [
      { id: 'a', criteriaResults: [{ kind: 'task_completed', passed: true }, { kind: 'final_answer_contains', passed: true }] },
      { id: 'b', criteriaResults: [{ kind: 'task_completed', passed: false }] },
    ],
  };
  const good = { tasks: [
    { id: 'a', criteriaResults: [{ kind: 'task_completed', passed: true }, { kind: 'final_answer_contains', passed: true }] },
    { id: 'b', criteriaResults: [{ kind: 'task_completed', passed: true }] },
  ] };
  const verdictGood = compareRunVsBaseline(good, baseline);
  assert.equal(verdictGood.ok, true);
  assert.deepEqual(verdictGood.improvements, ['b:task_completed']);

  const bad = { tasks: [
    { id: 'a', criteriaResults: [{ kind: 'task_completed', passed: false }, { kind: 'final_answer_contains', passed: true }] },
    { id: 'b', criteriaResults: [{ kind: 'task_completed', passed: true }] },
  ] };
  const verdictBad = compareRunVsBaseline(bad, baseline);
  assert.equal(verdictBad.ok, false);
  assert.deepEqual(verdictBad.regressions, ['a:task_completed']);

  const withNew = { tasks: [...good.tasks, { id: 'c', criteriaResults: [{ kind: 'task_completed', passed: false }] }] };
  assert.equal(compareRunVsBaseline(withNew, baseline).ok, true, '新任务失败不判红');

  const missing = { tasks: [good.tasks[0], good.tasks[1]] };
  assert.equal(compareRunVsBaseline(missing, baseline).ok, true, 'a/b 都在');
  const missingB = { tasks: [good.tasks[0]] };
  assert.equal(compareRunVsBaseline(missingB, baseline).ok, false, '基线任务缺席=回归');

  const withSkip = { tasks: [{ id: 'a', skipped: true, criteriaResults: [] }] };
  const verdictSkip = compareRunVsBaseline(withSkip, baseline);
  assert.deepEqual(verdictSkip.skipped, ['a']);
});
