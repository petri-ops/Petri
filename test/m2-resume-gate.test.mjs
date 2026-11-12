/**
 * gate:long-task-resume 门自身防假绿负测（M2 / BLOCK-428）。
 * 注入篡改模块，验证 5 类判据必红；不改生产文件、不放宽基线。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateResume, collectResumeModule } from '../scripts/m-blueprint-m2-resume-gate.mjs';

test('门基线：真实模块判据全绿', () => {
  assert.equal(adjudicateResume(collectResumeModule()).length, 0);
});

test('植入「半截 tool call 不合成」→ DANGLING_TOOL_CALL_NOT_SYNTHESIZED 必红', () => {
  const M = { ...collectResumeModule(), hydrateTranscript: () => ({ messages: [], interruptedToolCount: 0, danglingToolCalls: [{ callId: 'x' }] }) };
  assert.ok(adjudicateResume(M).some((i) => i.includes('DANGLING_TOOL_CALL_NOT_SYNTHESIZED')));
});

test('植入「损坏 checkpoint 静默通过」→ CHECKPOINT_SILENT_CORRUPTION 必红', () => {
  const M = { ...collectResumeModule(), readCheckpoint: () => ({ checkpoint: {} }) };
  assert.ok(adjudicateResume(M).some((i) => i.includes('CHECKPOINT_SILENT_CORRUPTION')));
});

test('植入「恢复后节点回退」→ RESUME_NODE_STATE_ROLLED_BACK 必红', () => {
  const M = { ...collectResumeModule(), createTaskGraph: (opts) => {
    const real = collectResumeModule().createTaskGraph(opts);
    return { ...real, nodeState: () => 'pending', redispatch: () => ({}) };
  } };
  const issues = adjudicateResume(M);
  assert.ok(issues.some((i) => i.includes('RESUME_NODE_STATE_ROLLED_BACK')));
});

test('植入「重复投递被应用」→ IDEMPOTENCY_ACK_DRIFT 必红', () => {
  const M = { ...collectResumeModule(), createCommandInbox: () => ({ admit: () => ({ ack: 'applied' }) }) };
  assert.ok(adjudicateResume(M).some((i) => i.includes('IDEMPOTENCY_ACK_DRIFT')));
});

test('植入「非 owner 也能取消」→ NON_OWNER_CANCEL_ALLOWED 必红', () => {
  const real = collectResumeModule();
  const M = {
    ...real,
    createLeaseTable: (opts) => {
      const r = real.createLeaseTable(opts);
      return { ...r, cancel: () => ({ ok: true }) };
    },
  };
  assert.ok(adjudicateResume(M).some((i) => i.includes('NON_OWNER_CANCEL_ALLOWED')));
});

test('植入「租约 API 残缺」→ LEASE_API_INCOMPLETE 必红（门不抛 TypeError）', () => {
  const M = { ...collectResumeModule(), createLeaseTable: () => ({ acquire: () => ({}), cancel: () => ({ ok: true }) }) };
  assert.ok(adjudicateResume(M).some((i) => i.includes('LEASE_API_INCOMPLETE')));
});
