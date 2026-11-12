/**
 * M1（BLOCK-427）长任务内核行为契约 · HK-01 红绿先行。
 *
 * 与既有 test/agent-runner-loop-orchestrator.test.mjs（只断言 async function + 源码字符串扫描）
 * 不同：本文件**真实执行**状态机、边界族、goal verifier 与可注入 provider 的 30 轮 mock loop。
 *
 * 首跑在实现落盘前 → ERR_MODULE_NOT_FOUND 必红；实现后 → 全绿。两轮输出摘要随 M1 收口笔录留痕。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TURN_PHASES,
  TURN_CANCELLED,
  createTurnMachine,
} from '../core/petri-server/agent-tools/turn-machine.js';
import {
  createBoundaryGuard,
  authoritativeTokenCount,
} from '../core/petri-server/agent-tools/loop-boundaries.js';
import { verifyGoalCompletion } from '../core/petri-server/agent-tools/goal-verifier.js';
import { MAX_AGENT_ITERS } from '../core/petri-server/agent-tools/agent-loop-control.js';

test('M1-1 状态枚举 ≥9 态，且 MAX_AGENT_ITERS 产品契约保持 Infinity', () => {
  assert.ok(Object.keys(TURN_PHASES).length >= 9);
  assert.equal(MAX_AGENT_ITERS, Number.POSITIVE_INFINITY, 'goal-terminated, not round-terminated');
});

test('M1-1 合法转移表：正常轨迹 Idle→…→Completing 全绿', () => {
  const m = createTurnMachine({ traceId: 'm1-ok' });
  m.transition('AwaitingModel');
  m.transition('Streaming');
  m.transition('SchedulingTools');
  m.transition('ExecutingTools');
  m.transition('Aggregating');
  m.transition('AwaitingModel');
  m.transition('Completing');
  assert.equal(m.phase, 'Completing');
  assert.ok(m.snapshot().transitions.length >= 7, '转移必须 append-only 可重放');
  assert.equal(m.snapshot().traceId, 'm1-ok');
});

test('M1-1 非法转移 fail-closed：Implanted 必红', () => {
  const m = createTurnMachine({ traceId: 'm1-illegal' });
  assert.throws(() => m.transition('Completing'), /INVALID_TURN_TRANSITION/, 'Idle 直跳 Completing 必须抛错');
  assert.equal(m.phase, 'Idle', '失败转移不得改动当前态');
  assert.throws(() => m.transition('Nonexistent'), /INVALID_TURN_TRANSITION/);
});

test('M1-1 每 model/tool 边界 throwIfAborted；取消成为一等结果', () => {
  let aborted = false;
  const m = createTurnMachine({ shouldAbort: () => aborted, traceId: 'm1-abort' });
  m.transition('AwaitingModel');
  m.throwIfAborted('model');
  aborted = true;
  assert.throws(() => m.throwIfAborted('model'), /TURN_ABORTED/);
  const result = m.cancel({ reason: 'user_cancelled' });
  assert.equal(result.type, TURN_CANCELLED, '取消必须是稳定一等结果，不是隐式 flag');
  assert.equal(m.phase, 'Cancelled');
  assert.equal(m.snapshot().transitions.at(-1).to, 'Cancelled');
});

test('M1-1 权限等待是显式态，审批可追溯', () => {
  const m = createTurnMachine({ traceId: 'm1-perm' });
  m.transition('AwaitingModel');
  m.transition('Streaming');
  m.transition('SchedulingTools');
  m.transition('AwaitingPermission');
  m.transition('ExecutingTools');
  assert.ok(m.snapshot().transitions.some((t) => t.to === 'AwaitingPermission'));
});

test('M1-2 provider usage 为权威 token 源，本地估算只作兜底', () => {
  assert.equal(authoritativeTokenCount({ usage: { total_tokens: 4200 } }, 9999), 4200);
  assert.equal(authoritativeTokenCount({ usage: null }, 9999), 9999);
  assert.equal(authoritativeTokenCount({ usage: { total_tokens: 0 } }, 9999), 9999, '0 视为缺席，不冒充权威');
});

test('M1-2 compact 双熔断：连续失败 / 压缩后快速回填', () => {
  const g = createBoundaryGuard({ config: { compactFailureLimit: 3, rapidRefillTokenLimit: 1000 } });
  g.recordCompactResult({ ok: false });
  g.recordCompactResult({ ok: false });
  assert.equal(g.shouldCircuitBreak(), false);
  g.recordCompactResult({ ok: false });
  assert.equal(g.shouldCircuitBreak(), true, '连续 3 次失败必须熔断');
  const g2 = createBoundaryGuard({ config: { compactFailureLimit: 3, rapidRefillTokenLimit: 1000 } });
  g2.recordCompactResult({ ok: true, tokensAfter: 20000 });
  assert.equal(g2.shouldCircuitBreak(), true, '压缩后快速回填到 20k 必须熔断');
});

test('M1-2 成本超限默认软提示；硬收尾必须显式配置且事件链不丢', () => {
  const soft = createBoundaryGuard({ config: { costCapCny: 10 } });
  assert.equal(soft.adjudicateCost({ spentCny: 11 }).stop, false, '默认保持软提示，不改用户裁决');
  const hard = createBoundaryGuard({ config: { costCapCny: 10, costCapPolicy: 'hard' } });
  assert.equal(hard.adjudicateCost({ spentCny: 11 }).stop, true);
  assert.ok(hard.events.some((e) => e.type === 'cost_cap_exceeded'), 'cost_cap_exceeded 事件链不丢');
});

test('M1-2 工具超时/输出预算单源：越界可被判定', () => {
  const g = createBoundaryGuard({ config: { toolTimeoutMs: 300, maxOutputBytes: 4096 } });
  assert.equal(g.isToolBoundaryExceeded({ elapsedMs: 301 }).exceeded, true);
  assert.equal(g.isToolBoundaryExceeded({ elapsedMs: 299 }).exceeded, false);
  assert.equal(g.isToolBoundaryExceeded({ outputBytes: 4097 }).exceeded, true);
  assert.equal(g.resolveToolBudget().timeoutMs, 300);
});

test('M1-3 goal verifier 独立 no-tool：模型自报完成但无产物必红', () => {
  const out = verifyGoalCompletion({
    goal: { status: 'active', title: '产出报告' },
    artifacts: [],
    todos: [],
    backgroundTasks: [],
  });
  assert.equal(out.ok, false, '无产物不得判完成');
  assert.ok(out.reasons.some((r) => r.code === 'ARTIFACTS_ABSENT'));
});

test('M1-3 todo 未全终态 / 后台未 settle 必 defer', () => {
  const base = { goal: { status: 'active' }, artifacts: [{ path: 'a.md', bytes: 10 }], backgroundTasks: [] };
  assert.equal(verifyGoalCompletion({ ...base, todos: [{ status: 'in_progress' }] }).ok, false);
  assert.equal(verifyGoalCompletion({ ...base, todos: [], backgroundTasks: [{ settled: false }] }).ok, false);
  assert.equal(verifyGoalCompletion({ ...base, todos: [{ status: 'done' }], backgroundTasks: [{ settled: true }] }).ok, true);
});

test('M1-5 可注入 provider 的 ≥30 轮 mock loop：状态轨迹与终态可断言', () => {
  const machine = createTurnMachine({ traceId: 'm1-loop-30' });
  const provider = (i) => ({ done: i >= 30, toolCalls: i < 30 ? ['noop'] : [] });
  machine.transition('AwaitingModel');
  let iter = 0;
  for (; iter < 40; iter += 1) {
    machine.throwIfAborted('model');
    machine.transition('Streaming');
    const reply = provider(iter);
    machine.transition('SchedulingTools');
    if (reply.toolCalls.length) {
      machine.transition('ExecutingTools');
      machine.throwIfAborted('tool');
      machine.transition('Aggregating');
    }
    if (reply.done) {
      machine.transition('Completing');
      break;
    }
    machine.transition('AwaitingModel');
  }
  assert.equal(iter, 30, '真实跑满 30 轮，不是只断言 async function');
  assert.equal(machine.phase, 'Completing');
  const snap = machine.snapshot();
  assert.ok(snap.transitions.length > 30, '每轮状态轨迹可重放');
  assert.ok(snap.transitions.every((t, i) => t.seq === i + 1), 'append-only seq 连续');
});
