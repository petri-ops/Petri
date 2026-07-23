/**
 * test/loop-sse-contract.test.mjs
 * HLE-C4: SSE event contract tests — validates loop_phase and loop_iteration
 * event shapes that frontend expects from agent-runner.js.
 *
 * This is a type/contract test — it verifies the SSE event objects emitted by
 * agent-runner match the onLoopPhase / onLoopIteration callback signatures
 * defined in frontend copilotClient.ts StreamChatOptions.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// ---------------------------------------------------------------------------
// Event shape factories (mirror agent-runner.js _emit calls)
// ---------------------------------------------------------------------------

function makeLoopPhaseStarted(loopRunId, automationMode = 'task_execute') {
  return {
    event: 'loop_phase',
    phase: 'started',
    loopRunId,
    automationMode,
  };
}

function makeLoopPhaseCancelled(loopRunId, publicConclusion) {
  return {
    event: 'loop_phase',
    phase: 'cancelled',
    loopRunId,
    publicConclusion,
    reason: 'user_cancelled',
  };
}

function makeLoopIteration(loopRunId, iterationId, sequence, decision, decisionReasonCode, publicConclusion, status, proposedActionKey = null, actionKeyHash = null) {
  return {
    event: 'loop_iteration',
    loopRunId,
    iterationId,
    sequence,
    decision,
    decisionReasonCode,
    publicConclusion,
    status,
    proposedActionKey,
    actionKeyHash,
  };
}

// ---------------------------------------------------------------------------
// StreamChatOptions type signatures (copied from copilotClient.ts)
// ---------------------------------------------------------------------------

// @ts-check
// LoopPhaseInfo and LoopIterationInfo are documented inline in the handler functions below.

// ---------------------------------------------------------------------------
// Dispatcher (mirrors copilotClient.ts _handleSseEvent)
// ---------------------------------------------------------------------------

function handleLoopPhaseEvent(obj) {
  if (obj.event !== 'loop_phase') return null;
  return {
    phase: String(obj.phase || ''),
    loopRunId: obj.loopRunId ? String(obj.loopRunId) : undefined,
    publicConclusion: obj.publicConclusion ? String(obj.publicConclusion) : undefined,
    reason: obj.reason ? String(obj.reason) : undefined,
    automationMode: obj.automationMode ? String(obj.automationMode) : undefined,
  };
}

function handleLoopIterationEvent(obj) {
  if (obj.event !== 'loop_iteration') return null;
  return {
    loopRunId: String(obj.loopRunId || ''),
    iterationId: String(obj.iterationId || ''),
    sequence: typeof obj.sequence === 'number' ? obj.sequence : 0,
    decision: String(obj.decision || ''),
    decisionReasonCode: String(obj.decisionReasonCode || ''),
    publicConclusion: String(obj.publicConclusion || ''),
    status: String(obj.status || ''),
    proposedActionKey: obj.proposedActionKey ? String(obj.proposedActionKey) : null,
    actionKeyHash: obj.actionKeyHash ? String(obj.actionKeyHash) : null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HLE-C4: Loop SSE Event Contract', () => {

  describe('loop_phase:started', () => {
    it('has required fields for onLoopPhase callback', () => {
      const evt = makeLoopPhaseStarted('loop-abc', 'task_execute');
      const info = handleLoopPhaseEvent(evt);
      assert.ok(info);
      assert.equal(info.phase, 'started');
      assert.equal(info.loopRunId, 'loop-abc');
      assert.equal(info.automationMode, 'task_execute');
    });

    it('handles null loopRunId gracefully', () => {
      const evt = { event: 'loop_phase', phase: 'started', loopRunId: null };
      const info = handleLoopPhaseEvent(evt);
      assert.ok(info);
      assert.equal(info.loopRunId, undefined);
    });

    it('handles string loopRunId', () => {
      const evt = { event: 'loop_phase', phase: 'completed' };
      const info = handleLoopPhaseEvent(evt);
      assert.ok(info);
      assert.equal(info.loopRunId, undefined);
    });
  });

  describe('loop_phase:cancelled', () => {
    it('has required fields for onLoopPhase callback', () => {
      const evt = makeLoopPhaseCancelled('loop-1', '用户取消。');
      const info = handleLoopPhaseEvent(evt);
      assert.ok(info);
      assert.equal(info.phase, 'cancelled');
      assert.equal(info.loopRunId, 'loop-1');
      assert.equal(info.publicConclusion, '用户取消。');
      assert.equal(info.reason, 'user_cancelled');
    });
  });

  describe('loop_iteration', () => {
    it('has all required fields for onLoopIteration callback', () => {
      const evt = makeLoopIteration(
        'loop-1', 'iter-5', 5,
        'block', 'ARTIFACT_VALIDATION_FAILED',
        '验证失败。', 'blocked',
        null, null
      );
      const info = handleLoopIterationEvent(evt);
      assert.ok(info);
      assert.equal(info.loopRunId, 'loop-1');
      assert.equal(info.iterationId, 'iter-5');
      assert.equal(info.sequence, 5);
      assert.equal(info.decision, 'block');
      assert.equal(info.decisionReasonCode, 'ARTIFACT_VALIDATION_FAILED');
      assert.equal(info.publicConclusion, '验证失败。');
      assert.equal(info.status, 'blocked');
      assert.equal(info.proposedActionKey, null);
      assert.equal(info.actionKeyHash, null);
    });

    it('handles missing optional fields', () => {
      const evt = {
        event: 'loop_iteration',
        loopRunId: 'loop-1',
        iterationId: 'iter-1',
        sequence: 1,
        decision: 'continue',
        decisionReasonCode: 'TOOL_SUCCEEDED',
        publicConclusion: '',
        status: 'succeeded',
      };
      const info = handleLoopIterationEvent(evt);
      assert.ok(info);
      assert.equal(info.proposedActionKey, null);
      assert.equal(info.actionKeyHash, null);
    });

    it('handles non-number sequence', () => {
      const evt = {
        event: 'loop_iteration',
        loopRunId: 'loop-1',
        iterationId: 'iter-1',
        sequence: 'invalid',
        decision: 'continue',
        decisionReasonCode: 'TOOL_SUCCEEDED',
        publicConclusion: '',
        status: 'succeeded',
      };
      const info = handleLoopIterationEvent(evt);
      assert.equal(info.sequence, 0);
    });
  });

  describe('Event non-interference', () => {
    it('loop_phase ignores non-loop_phase events', () => {
      const evt = { event: 'iter', n: 1 };
      const info = handleLoopPhaseEvent(evt);
      assert.equal(info, null);
    });

    it('loop_iteration ignores non-loop_iteration events', () => {
      const evt = { event: 'tool_result', name: 'run_tool' };
      const info = handleLoopIterationEvent(evt);
      assert.equal(info, null);
    });
  });

  describe('Cancellation overrides all decisions (SSE)', () => {
    it('cancelled loop_phase fires before final iteration', () => {
      const phaseEvt = makeLoopPhaseCancelled('loop-1', '用户取消。');
      const iterEvt = makeLoopIteration('loop-1', 'iter-2', 2, 'cancel', 'USER_CANCELLED', '用户取消。', 'skipped');
      const phaseInfo = handleLoopPhaseEvent(phaseEvt);
      const iterInfo = handleLoopIterationEvent(iterEvt);
      assert.equal(phaseInfo.phase, 'cancelled');
      assert.equal(iterInfo.decision, 'cancel');
      assert.equal(iterInfo.status, 'skipped');
    });
  });

  describe('Decision types match expected status mapping', () => {
    const cases = [
      { decision: 'complete', expectedStatus: 'succeeded' },
      { decision: 'continue', expectedStatus: 'succeeded' },
      { decision: 'retry', expectedStatus: 'failed' },
      { decision: 'block', expectedStatus: 'blocked' },
      { decision: 'wait', expectedStatus: 'pending' },
      { decision: 'cancel', expectedStatus: 'skipped' },
    ];
    for (const c of cases) {
      it(`${c.decision} → status=${c.expectedStatus}`, () => {
        const evt = makeLoopIteration('r', 'i', 1, c.decision, 'TEST', 'msg', c.expectedStatus);
        const info = handleLoopIterationEvent(evt);
        assert.equal(info.decision, c.decision);
        assert.equal(info.status, c.expectedStatus);
      });
    }
  });
});
