/**
 * BLOCK-181 — evals 判据评估器与基线棘轮单测（纯函数，离线）。
 * 批次B 加映：审批消耗语义/子任务终态/GenUI 路径自愈判据 + mock 定向投递。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evaluateCriterion, compareRunVsBaseline, startMockProvider } from '../scripts/lib/evals-harness.mjs';

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

test('policy_denied requireRequestId：审批资源形态拦截（无 requestId 不算）', () => {
  const withReq = [{ event: 'tool_result', toolResult: { data: { error: 'dynamic_guard_triggered', guardKey: 'cmd:vssadmin', requestId: 'apr_x' } } }];
  const noReq = [{ event: 'tool_result', toolResult: { data: { error: 'dynamic_guard_triggered', guardKey: 'cmd:vssadmin' } } }];
  assert.equal(evaluateCriterion({ kind: 'policy_denied', requireRequestId: true }, ctx({ events: withReq })).passed, true);
  assert.equal(evaluateCriterion({ kind: 'policy_denied', requireRequestId: true }, ctx({ events: noReq })).passed, false);
});

test('tool_succeeded / deny_after_success：放行一次=指纹消耗（新请求重拦才算）', () => {
  const events = [
    { event: 'tool_result', name: 'workspace_exec', toolResult: { status: 'error', data: { error: 'dynamic_guard_triggered', requestId: 'apr_1' } } },
    { event: 'tool_result', name: 'workspace_exec', toolResult: { status: 'success', data: { ok: true } } },
    { event: 'tool_result', name: 'workspace_exec', toolResult: { status: 'error', data: { error: 'dynamic_guard_triggered', requestId: 'apr_1' } } },
    { event: 'tool_result', name: 'workspace_exec', toolResult: { status: 'error', data: { error: 'dynamic_guard_triggered', requestId: 'apr_2' } } },
  ];
  assert.equal(evaluateCriterion({ kind: 'tool_succeeded', tool: 'workspace_exec' }, ctx({ events })).passed, true);
  assert.equal(evaluateCriterion({ kind: 'deny_after_success', tool: 'workspace_exec' }, ctx({ events })).passed, true, 'apr_2 新请求重拦=已消耗');
  assert.equal(
    evaluateCriterion({ kind: 'deny_after_success', tool: 'workspace_exec' }, ctx({ events: events.slice(0, 3) })).passed,
    false,
    '同 apr_1 重拦=决策未落地，非消耗',
  );
  assert.equal(
    evaluateCriterion({ kind: 'deny_after_success', tool: 'workspace_exec' }, ctx({ events: [events[0], events[3]] })).passed,
    false,
    '无成功执行在前=消耗语义无从谈起',
  );
});

test('subagent_completed / task_terminal_status：终态计数与终态断言', () => {
  assert.equal(evaluateCriterion({ kind: 'subagent_completed', minTimes: 1 }, ctx({ subagentDoneCount: 1 })).passed, true);
  assert.equal(evaluateCriterion({ kind: 'subagent_completed', minTimes: 2 }, ctx({ subagentDoneCount: 1 })).passed, false);
  assert.equal(evaluateCriterion({ kind: 'task_terminal_status', status: 'cancelled' }, ctx({ terminalStatus: 'cancelled' })).passed, true);
  assert.equal(evaluateCriterion({ kind: 'task_terminal_status', status: 'cancelled' }, ctx({ terminalStatus: 'done' })).passed, false);
});

test('genui_fragment_resolves：直调生产 resolver（临时目录播种，截断目录自愈改名）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'genui-eval-'));
  const truncDir = path.join(dir, '.petri', 'gen-ui', 'conv_3c15-3c1');
  fs.mkdirSync(truncDir, { recursive: true });
  fs.writeFileSync(path.join(truncDir, 'chart.html'), '<h1>销售柱状图</h1>');
  const hit = evaluateCriterion(
    { kind: 'genui_fragment_resolves', conversationId: 'conv_full_sim', basename: 'chart.html', expectRepaired: true, contains: '销售柱状图' },
    ctx({ workspacePath: dir }),
  );
  assert.equal(hit.passed, true, JSON.stringify(hit.detail));
  assert.ok(fs.existsSync(path.join(dir, '.petri', 'gen-ui', 'conv_full_sim', 'chart.html')), '自愈改名后规范目录在');
  const miss = evaluateCriterion(
    { kind: 'genui_fragment_resolves', conversationId: 'conv_x', basename: 'nope.html' },
    ctx({ workspacePath: dir }),
  );
  assert.equal(miss.passed, false, '无候选=红');
  const noWs = evaluateCriterion({ kind: 'genui_fragment_resolves', conversationId: 'c', basename: 'a.html' }, ctx());
  assert.equal(noWs.passed, false, 'workspacePath 缺失=红');
});

test('startMockProvider：whenIncludes 定向投递（标记回合不被无匹配请求消费）', async () => {
  const mock = startMockProvider();
  const port = await mock.ready;
  mock.push(
    { whenIncludes: 'PARENT_TOKEN', content: '给父回合的内容' },
    { whenIncludes: 'CHILD_TOKEN', content: '给子回合的内容' },
  );
  const post = async (content) => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content }] }),
    });
    return await r.text();
  };
  // mock 按中点拆两帧流式下发——拼 delta 还原正文再断言。
  const readContent = (sse) => sse.split('\n')
    .filter((l) => l.startsWith('data: ') && l.trim() !== 'data: [DONE]')
    .map((l) => { try { const j = JSON.parse(l.slice(6)); return (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || ''; } catch { return ''; } })
    .join('');
  const stray = readContent(await post('无关请求'));
  assert.ok(stray.includes('无匹配回合'), '无匹配请求不消费标记回合');
  const child = readContent(await post('带 CHILD_TOKEN 的子请求'));
  assert.ok(child.includes('给子回合'), `child=${child}`);
  const parent = readContent(await post('带 PARENT_TOKEN 的父请求'));
  assert.ok(parent.includes('给父回合'), `parent=${parent}`);
  await mock.close();
});

test('startMockProvider：无标记回合保持 FIFO 旧行为（既有套件零漂移）', async () => {
  const mock = startMockProvider();
  const port = await mock.ready;
  mock.push({ content: '第一回合的正文' }, { content: '第二回合的正文' });
  const post = async () => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }),
    });
    const sse = await r.text();
    return sse.split('\n')
      .filter((l) => l.startsWith('data: ') && l.trim() !== 'data: [DONE]')
      .map((l) => { try { const j = JSON.parse(l.slice(6)); return (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || ''; } catch { return ''; } })
      .join('');
  };
  assert.ok((await post()).includes('第一回合'));
  assert.ok((await post()).includes('第二回合'));
  await mock.close();
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
