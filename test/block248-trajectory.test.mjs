import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-trajectory-'));
process.env.PETRI_DB_PATH = path.join(tempDir, 'trajectory.db');

const require = createRequire(import.meta.url);
const store = require('../core/petri-server/agent-task-store');
const {
  TRAJECTORY_GROUPS,
  classifyEvent,
  toTrajectoryEvent,
  resolveTrajectoryQuery,
  clampLimit,
  clampAfterSeq,
} = require('../core/petri-server/helpers/trajectory-events');

test.after(() => {
  // Windows 上 better-sqlite3 可能仍持有句柄（EPERM/EBUSY）：清理失败不阻断套件。
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* best-effort teardown */
  }
});

function row(eventType, payload, seq = 1, createdAt = '2026-10-23T00:00:00.000Z') {
  return { seq, eventType, payload, createdAt };
}

test('8 组分类：delta 按内容细分，未知事件落 system 并保留原名', () => {
  assert.deepEqual([...TRAJECTORY_GROUPS], ['tool', 'text', 'reasoning', 'error', 'compaction', 'user', 'assistant', 'system']);
  assert.equal(classifyEvent('delta', { choices: [{ delta: { content: '你好' } }] }), 'text');
  assert.equal(classifyEvent('delta', { choices: [{ delta: { reasoning_content: '想一下' } }] }), 'reasoning');
  assert.equal(classifyEvent('delta', { choices: [{ delta: { tool_calls: [{ id: 'c1' }] } }] }), 'tool');
  assert.equal(classifyEvent('tool_result', {}), 'tool');
  assert.equal(classifyEvent('error', {}), 'error');
  assert.equal(classifyEvent('context_compacted', {}), 'compaction');
  assert.equal(classifyEvent('input_queued', {}), 'user');
  assert.equal(classifyEvent('run_started', {}), 'assistant');
  const unknown = toTrajectoryEvent(row('future_event', { anything: 1 }));
  assert.equal(unknown.group, 'system');
  assert.equal(unknown.type, 'future_event');
  assert.match(unknown.summary, /future_event/);
});

test('轨迹行只暴露有界摘要：正文截断、工具结果带状态与耗时、未上报耗时不给字段', () => {
  const longText = '长文本'.repeat(200);
  const textRow = toTrajectoryEvent(row('delta', { choices: [{ delta: { content: longText } }] }));
  assert.equal(textRow.group, 'text');
  assert.ok(textRow.summary.length <= 240, `summary length ${textRow.summary.length}`);

  const toolCall = toTrajectoryEvent(row('tool_call', { name: 'workspace_read', args: { path: 'README.md' } }));
  assert.equal(toolCall.group, 'tool');
  assert.match(toolCall.summary, /workspace_read/);

  const toolOk = toTrajectoryEvent(row('tool_result', {
    summary: '已读取 README.md',
    toolResult: { status: 'success', durationMs: 12 },
  }));
  assert.equal(toolOk.status, 'success');
  assert.equal(toolOk.durationMs, 12);

  const toolNoDuration = toTrajectoryEvent(row('tool_result', {
    summary: '工具失败',
    toolResult: { status: 'error' },
  }));
  assert.equal(toolNoDuration.status, 'error');
  assert.equal('durationMs' in toolNoDuration, false, '未上报耗时不得补 0');

  const compacted = toTrajectoryEvent(row('context_compacted', { dropped: 12, summarized: true }));
  assert.equal(compacted.group, 'compaction');
  assert.match(compacted.summary, /12/);
  assert.match(compacted.summary, /摘要/);

  const usage = toTrajectoryEvent(row('usage', { model: 'mock-1', promptTokens: 10, completionTokens: 5 }));
  assert.equal(usage.group, 'system');
  assert.match(usage.summary, /10\+5 tokens/);
});

test('分页参数收敛：limit 1..500、afterSeq 非负整数', () => {
  assert.equal(clampLimit(undefined), 200);
  assert.equal(clampLimit('9999'), 500);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit('abc'), 200);
  assert.equal(clampAfterSeq(-5), 0);
  assert.equal(clampAfterSeq('7'), 7);
  assert.equal(clampAfterSeq('x'), 0);
});

function fakeDb(conversationRow) {
  return {
    prepare() {
      return { get: async () => conversationRow };
    },
  };
}

function fakeStore(overrides = {}) {
  const task = {
    taskId: 'task_1',
    userId: 'user_1',
    params: { conversationId: 'conv_1' },
    status: 'done',
    agentStatus: 'done',
    createdAt: '2026-10-23T00:00:00.000Z',
    finishedAt: '2026-10-23T00:00:10.000Z',
    error: null,
  };
  const events = [
    { seq: 1, eventType: 'run_started', payload: { event: 'run_started' }, createdAt: '2026-10-23T00:00:00.000Z' },
    { seq: 2, eventType: 'tool_result', payload: { summary: '失败', toolResult: { status: 'error' } }, createdAt: '2026-10-23T00:00:01.000Z' },
  ];
  return {
    getAgentTask: (id) => (id === 'task_1' ? task : null),
    getLatestPrimaryTaskForConversation: () => task,
    getAgentTaskEventsSince: (taskId, afterSeq, limit) => events.filter((e) => e.seq > afterSeq).slice(0, limit),
    getRecentAgentTaskEvents: (taskId, limit) => events.slice(Math.max(0, events.length - limit)),
    getAgentTaskEventsBefore: (taskId, beforeSeq, limit) => events.filter((e) => e.seq < beforeSeq).slice(-limit),
    hasAgentTaskEventBefore: (taskId, seq) => events.some((e) => e.seq < seq),
    getAgentTaskTrajectoryStats: () => ({ events: 2, toolCalls: 0, toolFailures: 1, errors: 0, compactions: 0, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, models: [] }),
    ...overrides,
  };
}

test('查询编排：鉴权/归属/任务不存在/会话不匹配/无任务', async () => {
  const denied = await resolveTrajectoryQuery({ store: fakeStore(), db: fakeDb(null) });
  assert.deepEqual({ ok: denied.ok, status: denied.status }, { ok: false, status: 401 });

  const missing = await resolveTrajectoryQuery({ store: fakeStore(), db: fakeDb(null), userId: 'user_1', taskId: 'task_x' });
  assert.equal(missing.status, 404);

  const otherTask = await resolveTrajectoryQuery({
    store: fakeStore({ getAgentTask: () => ({ taskId: 'task_1', userId: 'user_2', params: {} }) }),
    db: fakeDb(null), userId: 'user_1', taskId: 'task_1',
  });
  assert.equal(otherTask.status, 403);

  const mismatch = await resolveTrajectoryQuery({
    store: fakeStore(), db: fakeDb(null), userId: 'user_1', taskId: 'task_1', conversationId: 'conv_other',
  });
  assert.equal(mismatch.status, 400);

  const missingConv = await resolveTrajectoryQuery({
    store: fakeStore(), db: fakeDb(null), userId: 'user_1', conversationId: 'conv_x',
  });
  assert.equal(missingConv.status, 404);

  const foreignConv = await resolveTrajectoryQuery({
    store: fakeStore(), db: fakeDb({ user_id: 'user_2' }), userId: 'user_1', conversationId: 'conv_1',
  });
  assert.equal(foreignConv.status, 403);

  const noTask = await resolveTrajectoryQuery({
    store: fakeStore({ getLatestPrimaryTaskForConversation: () => null }),
    db: fakeDb({ user_id: 'user_1' }), userId: 'user_1', conversationId: 'conv_1',
  });
  assert.equal(noTask.ok, true);
  assert.equal(noTask.availability, 'no_task');
  assert.deepEqual(noTask.events, []);
});

test('查询编排：默认取最新一页、afterSeq 增量、beforeSeq 往更早，统计与 recordedOnly 常驻', async () => {
  const many = Array.from({ length: 5 }, (_, i) => ({
    seq: i + 1,
    eventType: 'delta',
    payload: { choices: [{ delta: { content: `片段${i}` } }] },
    createdAt: '2026-10-23T00:00:00.000Z',
  }));
  const manyStore = fakeStore({
    getAgentTaskEventsSince: (taskId, afterSeq, limit) => many.filter((e) => e.seq > afterSeq).slice(0, limit),
    getRecentAgentTaskEvents: (taskId, limit) => many.slice(-limit),
    getAgentTaskEventsBefore: (taskId, beforeSeq, limit) => many.filter((e) => e.seq < beforeSeq).slice(-limit),
    hasAgentTaskEventBefore: (taskId, seq) => many.some((e) => e.seq < seq),
  });

  const tail = await resolveTrajectoryQuery({
    store: manyStore, db: fakeDb({ user_id: 'user_1' }), userId: 'user_1', conversationId: 'conv_1', limit: 3,
  });
  assert.equal(tail.ok, true);
  assert.equal(tail.availability, 'available');
  assert.equal(tail.recordedOnly, true);
  assert.equal(tail.mode, 'tail');
  assert.deepEqual(tail.events.map((e) => e.seq), [3, 4, 5]);
  assert.equal(tail.truncated, true);
  assert.equal(tail.hasMoreOlder, true);
  assert.equal(tail.nextAfterSeq, 5);
  assert.equal(tail.oldestSeq, 3);
  assert.equal(tail.task.taskId, 'task_1');
  assert.equal(tail.stats.toolFailures, 1);

  const delta = await resolveTrajectoryQuery({
    store: manyStore, db: fakeDb({ user_id: 'user_1' }), userId: 'user_1', conversationId: 'conv_1', afterSeq: 3, limit: 5,
  });
  assert.equal(delta.mode, 'delta');
  assert.deepEqual(delta.events.map((e) => e.seq), [4, 5]);
  assert.equal(delta.truncated, false);

  const older = await resolveTrajectoryQuery({
    store: manyStore, db: fakeDb({ user_id: 'user_1' }), userId: 'user_1', conversationId: 'conv_1', beforeSeq: 3, limit: 2,
  });
  assert.equal(older.mode, 'older');
  assert.deepEqual(older.events.map((e) => e.seq), [1, 2]);
  assert.equal(older.truncated, false);
  assert.equal(older.hasMoreOlder, false);
});

test('存储层：最近主任务解析 + run 级统计（usage/tool_result 真值）', () => {
  store.insertAgentTask({
    taskId: 'task_trace_1',
    userId: 'user_trace',
    params: { conversationId: 'conv_trace', messages: [{ role: 'user', content: '跑一下' }] },
  });
  store.appendAgentTaskEvent('task_trace_1', 1, 'run_started', { event: 'run_started' });
  store.appendAgentTaskEvent('task_trace_1', 2, 'tool_call', { event: 'tool_call', name: 'workspace_read', args: { path: 'a.txt' } });
  store.appendAgentTaskEvent('task_trace_1', 3, 'tool_result', {
    event: 'tool_result',
    summary: '错误: not_found',
    toolResult: { status: 'error', durationMs: 3 },
  });
  store.appendAgentTaskEvent('task_trace_1', 4, 'usage', {
    event: 'usage', model: 'mock-1', promptTokens: 11, completionTokens: 7,
  });
  // 子代理任务：不得成为会话默认轨迹
  store.insertAgentTask({
    taskId: 'task_trace_child',
    userId: 'user_trace',
    params: { conversationId: 'conv_trace', kind: 'subagent', parentTaskId: 'task_trace_1' },
  });
  store.markAgentTaskDone('task_trace_1', []);

  const latest = store.getLatestPrimaryTaskForConversation('user_trace', 'conv_trace');
  assert.equal(latest && latest.taskId, 'task_trace_1');

  const stats = store.getAgentTaskTrajectoryStats('task_trace_1');
  assert.equal(stats.events, 4);
  assert.equal(stats.toolCalls, 1);
  assert.equal(stats.toolFailures, 1);
  assert.equal(stats.promptTokens, 11);
  assert.equal(stats.completionTokens, 7);
  assert.deepEqual(stats.models, ['mock-1']);

  const otherUser = store.getLatestPrimaryTaskForConversation('user_other', 'conv_trace');
  assert.equal(otherUser, null);

  // 分页读法：tail 取最新、before 取更早、hasBefore 判定
  assert.deepEqual(store.getRecentAgentTaskEvents('task_trace_1', 2).map((e) => e.seq), [3, 4]);
  assert.deepEqual(store.getAgentTaskEventsBefore('task_trace_1', 3, 2).map((e) => e.seq), [1, 2]);
  assert.equal(store.hasAgentTaskEventBefore('task_trace_1', 1), false);
  assert.equal(store.hasAgentTaskEventBefore('task_trace_1', 3), true);
});
