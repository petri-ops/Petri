/**
 * gate:long-task-kernel 门自身防假绿负测（M1 / BLOCK-427）。
 * 注入篡改后的 modules，验证裁决必红；不改生产文件、不放宽任何基线。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateKernel, collectModules } from '../scripts/m-blueprint-m1-kernel-gate.mjs';

test('门基线：真实 modules 判据全绿', () => {
  const out = adjudicateKernel(collectModules());
  assert.equal(out.issues.length, 0, JSON.stringify(out.issues));
  assert.ok(out.phases >= 9);
});

test('植入「给主循环加步数上限」→ PRODUCT_CONTRACT_BROKEN 必红', () => {
  const modules = collectModules();
  modules.loopControl = { ...modules.loopControl, MAX_AGENT_ITERS: 20 };
  assert.ok(adjudicateKernel(modules).issues.some((i) => i.includes('PRODUCT_CONTRACT_BROKEN')));
});

test('植入「非法转移静默通过」→ ILLEGAL_TRANSITION_NOT_RED 必红', () => {
  const modules = collectModules();
  modules.turnMachine = {
    ...modules.turnMachine,
    createTurnMachine: () => ({ phase: 'Idle', transition: () => 'Completing', cancel: () => ({ type: 'turn_cancelled' }), snapshot: () => ({ transitions: [] }) }),
  };
  assert.ok(adjudicateKernel(modules).issues.some((i) => i.includes('ILLEGAL_TRANSITION_NOT_RED')));
});

test('植入「取消退化成隐式 flag」→ CANCEL_NOT_FIRST_CLASS 必红', () => {
  const modules = collectModules();
  modules.turnMachine = {
    ...modules.turnMachine,
    createTurnMachine: (opts) => {
      const real = collectModules().turnMachine.createTurnMachine(opts);
      return { ...real, cancel: () => ({ cancelled: true }) };
    },
  };
  assert.ok(adjudicateKernel(modules).issues.some((i) => i.includes('CANCEL_NOT_FIRST_CLASS')));
});

test('植入「成本默认改硬停」→ COST_CAP_DEFAULT_CHANGED_TO_HARD 必红', () => {
  const modules = collectModules();
  modules.boundaries = {
    ...modules.boundaries,
    createBoundaryGuard: () => ({ adjudicateCost: () => ({ stop: true }), shouldCircuitBreak: () => true, recordCompactResult: () => ({}) }),
  };
  assert.ok(adjudicateKernel(modules).issues.some((i) => i.includes('COST_CAP_DEFAULT_CHANGED_TO_HARD')));
});

test('植入「模型自报完成即判绿」→ FALSE_COMPLETION_NOT_RED 必红', () => {
  const modules = collectModules();
  modules.verifier = { ...modules.verifier, verifyGoalCompletion: () => ({ ok: true, reasons: [] }) };
  assert.ok(adjudicateKernel(modules).issues.some((i) => i.includes('FALSE_COMPLETION_NOT_RED')));
});
