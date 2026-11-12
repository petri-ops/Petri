/**
 * M2（BLOCK-428）崩溃续跑 / 任务图 / 幂等行为契约 · HK-01 红绿先行。
 * 首跑实现未落盘 → ERR_MODULE_NOT_FOUND 必红；实现后 → 全绿。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTranscript,
  hydrateTranscript,
  writeCheckpoint,
  readCheckpoint,
  createTaskGraph,
  createCommandInbox,
  createLeaseTable,
} from '../core/petri-server/agent-tools/long-task-resume.js';

test('M2-1 append-only：message/part 只追加，hydrate 重建逐字对齐', () => {
  const t = createTranscript({ traceId: 'm2-t1' });
  t.appendMessage({ role: 'user', content: '做 A' });
  t.appendPart({ type: 'text', text: '开始' });
  t.appendMessage({ role: 'assistant', content: '好' });
  const hydrated = hydrateTranscript(t.snapshot());
  assert.equal(hydrated.messages.length, 2);
  assert.equal(hydrated.parts.length, 1);
  assert.equal(hydrated.messages[0].content, '做 A');
  assert.equal(hydrated.traceId, 'm2-t1');
});

test('M2-1 半截 tool call 合成 interrupted result，消除 dangling tool call', () => {
  const t = createTranscript();
  t.appendMessage({ role: 'assistant', content: '' });
  t.appendPart({ type: 'tool_call', callId: 'c1', state: 'running' });
  t.appendPart({ type: 'tool_call', callId: 'c2', state: 'pending' });
  const h = hydrateTranscript(t.snapshot());
  assert.equal(h.interruptedToolCount, 2);
  assert.ok(h.danglingToolCalls.length === 0, '不得留悬挂 tool call');
  assert.ok(h.interrupted.every((r) => r.interrupted === true && r.callId));
});

test('M2-2 checkpoint 写/读/校验三段；损坏必红不静默吞错', () => {
  const snap = { traceId: 'm2-c1', messagesHash: 'abc123', turnPhase: 'ExecutingTools', todo: [{ id: 'T1', status: 'done' }] };
  const cp = writeCheckpoint(snap);
  assert.equal(cp.ok, true);
  assert.equal(readCheckpoint(cp.payload).checkpoint.messagesHash, 'abc123');
  assert.throws(() => readCheckpoint({ ...cp.payload, digest: 'deadbeef' }), /CHECKPOINT_DAMAGED/);
  assert.throws(() => readCheckpoint({ ...cp.payload, payload: null }), /CHECKPOINT_DAMAGED/);
});

test('M2-3 8 阶段任务图：节点转移落盘 + kill/resume 不回退', () => {
  const g = createTaskGraph({ stages: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] });
  assert.equal(g.stages.length, 8);
  g.transition('a', 'done');
  g.transition('b', 'done');
  const persisted = g.persist();
  const restored = createTaskGraph({ persisted });
  assert.equal(restored.nodeState('a'), 'done', '恢复后节点状态不得回退');
  assert.equal(restored.nodeState('c'), 'pending');
});

test('M2-3 maxConsecutiveErrors 暂停 + 失败节点重派', () => {
  const g = createTaskGraph({ stages: ['a', 'b'], maxConsecutiveErrors: 2 });
  g.transition('a', 'failed');
  assert.equal(g.paused, false);
  g.transition('b', 'failed');
  assert.equal(g.paused, true, '连续 2 次失败必须暂停');
  g.redispatch('a');
  assert.equal(g.nodeState('a'), 'dispatched');
  assert.equal(g.paused, false);
});

test('M2-4 commandId CAS + ACK duplicate/stale/noop', () => {
  const inbox = createCommandInbox({ revision: 5 });
  assert.equal(inbox.admit({ commandId: 'c1', baseRevision: 5, payload: { do: 'step-a' } }).ack, 'applied');
  assert.equal(inbox.admit({ commandId: 'c1', baseRevision: 6, payload: { do: 'step-a' } }).ack, 'duplicate');
  assert.equal(inbox.admit({ commandId: 'c2', baseRevision: 4, payload: { do: 'step-b' } }).ack, 'stale');
  assert.equal(inbox.admit({ commandId: 'c3', baseRevision: 6, payload: null }).ack, 'noop');
  assert.equal(inbox.revision, 6);
});

test('M2-5 取消单一 owner + 后台进程租约持久化', () => {
  const leases = createLeaseTable();
  leases.acquire({ taskId: 'T1', owner: 'backend:3001', pid: 42 });
  assert.equal(leases.ownerOf('T1'), 'backend:3001');
  assert.equal(leases.cancel('T1', { from: 'backend:3001' }).ok, true);
  assert.equal(leases.cancel('T1', { from: 'backend:3005' }).ok, false, '非 owner 取消必拒');
  const restored = createLeaseTable({ persisted: leases.persist() });
  assert.equal(restored.pidOf('T1'), 42, '重启后孤儿进程可识别');
});
