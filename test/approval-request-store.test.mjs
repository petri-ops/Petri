/**
 * BLOCK-180 P0 — approval-request-store 单测（红绿先行）。
 * 钉住：资源生命周期（注册幂等/TTL 惰性过期/决策终态）、指纹放行语义
 * （once 登记消耗/al always 维度级）、任务内隔离与释放。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const store = require(resolve(root, 'core/petri-server/helpers/approval-request-store.js'));

const ARGS = { command: 'format C: /q' };

function freshTask(taskId = 't1') {
  const s = store.createApprovalRequests(taskId);
  // 同一 Set 双挂（loop 接线同款）：ctx 读侧与路由写侧共享
  const ctx = { approvedFingerprints: s.approvedFingerprints };
  return { s, ctx, cleanup: () => store.releaseApprovalRequests(taskId) };
}

test('注册审批请求：requestId/指纹/span/过期时间齐备', () => {
  const { s, cleanup } = freshTask();
  const r = store.registerApprovalRequest(s, {
    toolName: 'workspace_exec',
    args: ARGS,
    guardKey: 'cmd:format',
    dimension: 'command',
    detail: '命中系统级破坏命令维度',
  });
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  assert.ok(r.request.requestId.startsWith('apr_'));
  assert.equal(r.request.fingerprint, store.callFingerprint('workspace_exec', ARGS));
  assert.equal(r.request.status, 'pending');
  assert.ok(r.request.expiresAt > r.request.createdAt);
  assert.equal(r.request.command, ARGS.command);
  assert.ok(Array.isArray(r.request.spans) && r.request.spans.length === 1, '风险 span 随请求');
  cleanup();
});

test('同指纹+guardKey 重试幂等复用（requestId 不漂移）', () => {
  const { s, cleanup } = freshTask();
  const first = store.registerApprovalRequest(s, { toolName: 'workspace_exec', args: ARGS, guardKey: 'cmd:format' });
  const second = store.registerApprovalRequest(s, { toolName: 'workspace_exec', args: ARGS, guardKey: 'cmd:format' });
  assert.equal(second.created, false);
  assert.equal(second.request.requestId, first.request.requestId);
  cleanup();
});

test('once 决策：指纹登记（approveTaskFingerprint 共享集）→拦截层消耗后失效', () => {
  const { s, ctx, cleanup } = freshTask();
  const reg = store.registerApprovalRequest(s, { toolName: 'workspace_exec', args: ARGS, guardKey: 'cmd:format' });
  const fp = reg.request.fingerprint;
  const decision = store.decideApprovalRequest({ taskId: 't1', requestId: reg.request.requestId, decision: 'approve', mode: 'once' });
  assert.equal(decision.ok, true);
  assert.equal(decision.consumeOnUse, true);
  assert.equal(decision.fingerprint, fp);
  assert.equal(reg.request.status, 'approved');

  assert.equal(store.approveTaskFingerprint('t1', fp).ok, true, '路由侧指纹登记（共享集）');
  assert.equal(store.isFingerprintApproved(ctx, fp), true, '指纹放行在场');
  store.consumeFingerprint(ctx, fp);
  assert.equal(store.isFingerprintApproved(ctx, fp), false, '消耗后放行失效（一次=一次执行尝试）');
  cleanup();
});

test('always 决策：状态 approved 且经 ackGuardKey 写维度级确认集', () => {
  const { s, cleanup } = freshTask();
  const acked = new Set();
  const reg = store.registerApprovalRequest(s, { toolName: 'workspace_exec', args: ARGS, guardKey: 'cmd:format' });
  const decision = store.decideApprovalRequest({
    taskId: 't1', requestId: reg.request.requestId, decision: 'approve', mode: 'always',
    ackGuardKey: (key) => { acked.add(key); return { ok: true }; },
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.consumeOnUse, false);
  assert.ok(acked.has('cmd:format'), '维度级 guardKey 经回调写入');
  cleanup();
});

test('deny 决策：终态 denied，重复决策拒绝', () => {
  const { s, cleanup } = freshTask();
  const reg = store.registerApprovalRequest(s, { toolName: 'workspace_exec', args: ARGS, guardKey: 'cmd:format' });
  assert.equal(store.decideApprovalRequest({ taskId: 't1', requestId: reg.request.requestId, decision: 'deny', mode: 'once' }).ok, true);
  const again = store.decideApprovalRequest({ taskId: 't1', requestId: reg.request.requestId, decision: 'approve', mode: 'once' });
  assert.equal(again.ok, false);
  assert.equal(again.error, 'request_already_decided');
  cleanup();
});

test('TTL 惰性过期：过期后查询转 expired、决策拒绝、重试注册新请求', () => {
  const taskId = 't-exp';
  const s = store.createApprovalRequests(taskId);
  const reg = store.registerApprovalRequest(s, { toolName: 'workspace_exec', args: ARGS, guardKey: 'cmd:format' });
  // 手工把过期时间拨到过去（不依赖定时器）
  reg.request.expiresAt = Date.now() - 1;
  const fetched = store.getApprovalRequest(taskId, reg.request.requestId);
  assert.equal(fetched.status, 'expired', '查询时惰性转 expired');
  const decision = store.decideApprovalRequest({ taskId, requestId: reg.request.requestId, decision: 'approve', mode: 'once' });
  assert.equal(decision.ok, false);
  assert.equal(decision.error, 'request_expired');
  const retry = store.registerApprovalRequest(s, { toolName: 'workspace_exec', args: ARGS, guardKey: 'cmd:format' });
  assert.equal(retry.created, true, '过期后重试注册新请求');
  assert.notEqual(retry.request.requestId, reg.request.requestId);
  store.releaseApprovalRequests(taskId);
});

test('任务内隔离与释放', () => {
  const s1 = store.createApprovalRequests('task-a');
  store.registerApprovalRequest(s1, { toolName: 'workspace_exec', args: ARGS, guardKey: 'cmd:format' });
  const orphan = store.decideApprovalRequest({ taskId: 'task-b', requestId: 'whatever', decision: 'approve', mode: 'once' });
  assert.equal(orphan.ok, false);
  assert.equal(orphan.error, 'task_required');
  store.releaseApprovalRequests('task-a');
  assert.equal(store.getApprovalRequests('task-a'), null, '释放后资源清空');
});

test('决策入参与边界：非法 decision/缺任务/未知请求', () => {
  const { s, cleanup } = freshTask('t-edge');
  const reg = store.registerApprovalRequest(s, { toolName: 'workspace_exec', args: ARGS, guardKey: 'cmd:format' });
  assert.equal(store.decideApprovalRequest({ taskId: 't-edge', requestId: reg.request.requestId, decision: 'maybe', mode: 'once' }).error, 'invalid_decision');
  assert.equal(store.decideApprovalRequest({ taskId: 'nope', requestId: 'x', decision: 'approve', mode: 'once' }).error, 'task_required');
  assert.equal(store.getApprovalRequest('t-edge', 'apr_missing'), null);
  cleanup();
});
