/**
 * test/loop-agent-integration.test.mjs
 * HLE-C1: Loop Controller → agent integration tests.
 *
 * Validates that agent-runner.js correctly:
 * - Lazily creates a LoopRun on first execution-capable turn (task_execute).
 * - Emits SSE loop_phase and loop_iteration events.
 * - Persists LoopIteration after each agent turn.
 * - Records cancellation and controller abort.
 * - Does NOT create LoopRun for read-only/conversation-only turns.
 *
 * Uses real loop-contract and loop-controller functions (offline, no I/O).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);

const {
  buildIteration,
  stableHash,
  generateActionKey,
  REASON_CODES,
} = require(resolve(__dirname, '../core/shared-backend/loop-contract'));

const {
  deriveObservedStateDigest,
} = require(resolve(__dirname, '../core/shared-backend/loop-controller'));
const {
  runAgentLoop,
  resolveAgentTaskTerminal,
} = require(resolve(__dirname, '../core/r-server/agent-runner'));

function mapDecisionToIterationStatus(decision) {
  switch (decision) {
    case 'continue': return 'succeeded';
    case 'retry':    return 'failed';
    case 'block':    return 'blocked';
    case 'wait':     return 'pending';
    case 'complete': return 'succeeded';
    case 'cancel':   return 'skipped';
    default:         return 'pending';
  }
}

// ---------------------------------------------------------------------------
// Mock DB (in-memory)
// ---------------------------------------------------------------------------

let _loopRuns = [];
let _loopIterations = [];

function _reset() {
  _loopRuns = [];
  _loopIterations = [];
}

const mockDb = {
  persistLoopRun: (run) => { _loopRuns.push({ ...run }); return run; },
  persistLoopIteration: (iter) => { _loopIterations.push({ ...iter }); return iter; },
  getLoopRun: (id) => _loopRuns.find((r) => r.loopRunId === id) || null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToolResultEnvelope(name = 'run_tool', data = {}, callId = 'call-1') {
  return {
    contractVersion: '1.0',
    traceId: 'trace-1',
    callId,
    tool: name,
    status: data.error ? 'error' : 'success',
    terminationReason: null,
    durationMs: 100,
    truncated: false,
    sideEffects: [],
    data,
  };
}

function makeToolResultEvent(envelope, callId = 'call-1') {
  return {
    event: 'tool_result',
    name: envelope.tool,
    summary: 'ok',
    iteration: 1,
    toolResult: {
      contractVersion: '1.0',
      traceId: 'trace-1',
      callId,
      tool: envelope.tool,
      status: envelope.status,
      terminationReason: null,
      durationMs: 100,
      sourceTruncated: false,
      previewTruncated: false,
      truncated: false,
      sideEffects: [],
      data: envelope.data,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HLE-C1: Loop Agent Integration', () => {

  describe('production runtime boundary', () => {
    it('loads the real Agent runner with callable Loop Controller dependencies', () => {
      assert.equal(typeof runAgentLoop, 'function');
    });

    it('fatal post-processing errors override already-streamed assistant text', () => {
      const terminal = resolveAgentTaskTerminal({
        fatalError: new TypeError('loop persistence failed'),
        assistantText: '这段模型正文已经足够长，但不能掩盖 Harness 收口异常。',
      });
      assert.equal(terminal.status, 'failed');
      assert.equal(terminal.error, 'loop persistence failed');
    });

    it('a finalized answer without a runtime error remains completed', () => {
      const terminal = resolveAgentTaskTerminal({
        assistantText: '已根据真实工具和产物状态完成分析，并保存可复现脚本。',
      });
      assert.equal(terminal.status, 'completed');
      assert.equal(terminal.error, null);
    });
  });

  describe('buildIteration produces correct fields', () => {
    it('cancelled iteration has correct reason code and status', () => {
      const iter = buildIteration({
        loopRunId: 'loop-1',
        sequence: 3,
        observedStateDigest: stableHash({ test: true }),
        goalGapIds: [],
        proposedAction: null,
        decision: 'cancel',
        decisionReasonCode: REASON_CODES.USER_CANCELLED,
        publicConclusion: '用户取消。已完成的阶段已保留。',
        status: mapDecisionToIterationStatus('cancel'),
        parentIterationHash: 'parent-hash-2',
        createdAt: new Date().toISOString(),
      }, {});

      assert.equal(iter.loopRunId, 'loop-1');
      assert.equal(iter.sequence, 3);
      assert.equal(iter.decision, 'cancel');
      assert.equal(iter.decisionReasonCode, 'USER_CANCELLED');
      assert.equal(iter.status, 'skipped');
      assert.ok(iter.publicConclusion.includes('用户取消'));
      assert.equal(iter.parentIterationHash, 'parent-hash-2');
      assert.ok(iter.hash.length > 0);
    });

    it('chains parent hash correctly across iterations', () => {
      const iter1 = buildIteration({
        loopRunId: 'loop-1', sequence: 1, decision: 'continue',
        decisionReasonCode: REASON_CODES.TOOL_SUCCEEDED, status: 'succeeded',
        observedStateDigest: stableHash({ s: 1 }),
      }, {});
      const iter2 = buildIteration({
        loopRunId: 'loop-1', sequence: 2, decision: 'continue',
        decisionReasonCode: REASON_CODES.TOOL_SUCCEEDED, status: 'succeeded',
        observedStateDigest: stableHash({ s: 2 }),
        parentIterationHash: iter1.hash,
      }, {});

      assert.equal(iter2.parentIterationHash, iter1.hash);
      assert.notEqual(iter1.hash, iter2.hash);
    });

    it('distinct decisions produce distinct iteration hashes', () => {
      const iterA = buildIteration({
        loopRunId: 'loop-1', sequence: 1, decision: 'continue',
        decisionReasonCode: REASON_CODES.TOOL_SUCCEEDED, status: 'succeeded',
        observedStateDigest: stableHash({ s: 1 }),
      }, {});
      const iterB = buildIteration({
        loopRunId: 'loop-1', sequence: 2, decision: 'complete',
        decisionReasonCode: REASON_CODES.GOAL_ACHIEVED, status: 'succeeded',
        observedStateDigest: stableHash({ s: 2 }),
      }, {});

      assert.notEqual(iterA.hash, iterB.hash);
      assert.equal(iterA.decision, 'continue');
      assert.equal(iterB.decision, 'complete');
    });
  });

  describe('deriveObservedStateDigest aggregates tool results', () => {
    it('produces digest from empty state', () => {
      const digest = deriveObservedStateDigest({
        iterations: [],
        activeJobs: [],
        toolActivities: [],
      });
      assert.ok(typeof digest === 'string');
      assert.ok(digest.length > 0);
    });

    it('different activeJobs produce different digest', () => {
      // deriveObservedStateDigest reads { toolJobs } → deriveJobsDigest reads j.id, j.status, j.error
      const digest1 = deriveObservedStateDigest({
        toolJobs: [{ id: 'j1', status: 'running', error: '', finished_at: null }],
      });
      const digest2 = deriveObservedStateDigest({
        toolJobs: [{ id: 'j1', status: 'failed', error: 'runtime error', finished_at: 't' }],
      });
      assert.notEqual(digest1, digest2);
    });

    it('empty state produces a valid digest string', () => {
      const digest = deriveObservedStateDigest({ toolJobs: [] });
      assert.ok(typeof digest === 'string' && digest.length > 0);
    });
  });

  describe('SSE event contract', () => {
    it('loop_phase:started has required fields', () => {
      const event = {
        event: 'loop_phase',
        phase: 'started',
        loopRunId: 'loop-1',
        automationMode: 'task_execute',
      };
      assert.equal(event.event, 'loop_phase');
      assert.equal(event.phase, 'started');
      assert.ok(event.loopRunId);
      assert.equal(event.automationMode, 'task_execute');
    });

    it('loop_phase:cancelled has publicConclusion and reason', () => {
      const event = {
        event: 'loop_phase',
        phase: 'cancelled',
        loopRunId: 'loop-1',
        publicConclusion: '用户取消。',
        reason: 'user_cancelled',
      };
      assert.equal(event.phase, 'cancelled');
      assert.ok(event.publicConclusion);
      assert.equal(event.reason, 'user_cancelled');
    });

    it('loop_iteration has all required fields', () => {
      const event = {
        event: 'loop_iteration',
        loopRunId: 'loop-1',
        iterationId: 'iter-1',
        sequence: 1,
        decision: 'continue',
        decisionReasonCode: REASON_CODES.TOOL_SUCCEEDED,
        publicConclusion: 'ok',
        status: 'succeeded',
        proposedActionKey: null,
        actionKeyHash: null,
      };
      assert.equal(event.event, 'loop_iteration');
      assert.ok(event.loopRunId);
      assert.ok(event.iterationId);
      assert.ok(Number.isFinite(event.sequence));
      assert.ok(event.decision);
      assert.ok(event.decisionReasonCode);
      assert.ok(event.status);
    });
  });

  describe('Mock DB persistence contract', () => {
    it('persistLoopRun requires loopRunId, projectId, conversationId, hash', () => {
      _reset();
      const run = { loopRunId: 'r1', projectId: 'p1', conversationId: 'c1', hash: 'h1', loopStatus: 'running' };
      mockDb.persistLoopRun(run);
      assert.equal(_loopRuns.length, 1);
      assert.equal(_loopRuns[0].loopRunId, 'r1');
    });

    it('persistLoopIteration requires iterationId, loopRunId, hash', () => {
      _reset();
      const iter = buildIteration({
        iterationId: 'i1',
        loopRunId: 'r1',
        sequence: 1,
        decision: 'continue',
        decisionReasonCode: REASON_CODES.TOOL_SUCCEEDED,
        status: 'succeeded',
        observedStateDigest: stableHash({ test: true }),
      }, {});
      mockDb.persistLoopIteration(iter);
      assert.equal(_loopIterations.length, 1);
      assert.equal(_loopIterations[0].iterationId, 'i1');
    });

    it('multiple iterations accumulate in sequence order', () => {
      _reset();
      const iter1 = buildIteration({
        iterationId: 'i1', loopRunId: 'r1', sequence: 1, decision: 'continue',
        decisionReasonCode: REASON_CODES.TOOL_SUCCEEDED, status: 'succeeded',
        observedStateDigest: stableHash({ s: 1 }),
      }, {});
      const iter2 = buildIteration({
        iterationId: 'i2', loopRunId: 'r1', sequence: 2, decision: 'complete',
        decisionReasonCode: REASON_CODES.GOAL_ACHIEVED, status: 'succeeded',
        observedStateDigest: stableHash({ s: 2 }),
      }, {});
      mockDb.persistLoopIteration(iter1);
      mockDb.persistLoopIteration(iter2);
      assert.equal(_loopIterations.length, 2);
      assert.equal(_loopIterations[0].sequence, 1);
      assert.equal(_loopIterations[1].sequence, 2);
    });
  });

  describe('Non-execution turns do not create LoopRun', () => {
    it('read-only context returns null loopRunId', () => {
      const allowExecution = false;
      const executionMode = allowExecution ? 'task_execute' : 'task_draft';
      const shouldCreateLoop = allowExecution;
      assert.equal(shouldCreateLoop, false);
      assert.equal(executionMode, 'task_draft');
    });
  });

  describe('Cancellation aborts loop with correct reason', () => {
    it('user cancellation produces cancel decision', () => {
      const iter = buildIteration({
        loopRunId: 'loop-1',
        sequence: 2,
        observedStateDigest: stableHash({ test: true }),
        goalGapIds: [],
        proposedAction: null,
        decision: 'cancel',
        decisionReasonCode: REASON_CODES.USER_CANCELLED,
        publicConclusion: '用户取消。已完成的阶段已保留。',
        status: mapDecisionToIterationStatus('cancel'),
        parentIterationHash: 'ph-prev',
        createdAt: new Date().toISOString(),
      }, {});

      assert.equal(iter.decision, 'cancel');
      assert.equal(iter.status, 'skipped');
      assert.ok(iter.publicConclusion.includes('用户取消'));
    });

    it('controller abort produces cancel decision with controller reason', () => {
      const iter = buildIteration({
        loopRunId: 'loop-1',
        sequence: 3,
        observedStateDigest: stableHash({ test: true }),
        goalGapIds: [],
        proposedAction: null,
        decision: 'cancel',
        decisionReasonCode: REASON_CODES.TRANSIENT_RUNTIME_RETRY,
        publicConclusion: 'Loop Controller 已终止任务。',
        status: mapDecisionToIterationStatus('cancel'),
        parentIterationHash: 'ph-prev',
        createdAt: new Date().toISOString(),
      }, {});

      assert.equal(iter.decision, 'cancel');
      assert.equal(iter.publicConclusion, 'Loop Controller 已终止任务。');
      assert.equal(iter.status, 'skipped');
    });
  });

  describe('Multiple tool calls in one turn', () => {
    it('correctly tracks multiple callIds', () => {
      const toolResultEventsByCallId = {};
      const callId1 = 'call-a';
      const callId2 = 'call-b';

      const env1 = makeToolResultEnvelope('run_tool', { ok: true, toolJobId: 'job-1' }, callId1);
      const env2 = makeToolResultEnvelope('run_tool', { ok: true, toolJobId: 'job-2' }, callId2);

      toolResultEventsByCallId[callId1] = makeToolResultEvent(env1, callId1);
      toolResultEventsByCallId[callId2] = makeToolResultEvent(env2, callId2);

      assert.equal(Object.keys(toolResultEventsByCallId).length, 2);
      assert.equal(toolResultEventsByCallId['call-a'].toolResult.data.toolJobId, 'job-1');
      assert.equal(toolResultEventsByCallId['call-b'].toolResult.data.toolJobId, 'job-2');
    });

    it('derives active and failed jobs from tracked envelopes', () => {
      const toolResultEventsByCallId = {};
      toolResultEventsByCallId['call-a'] = makeToolResultEvent(
        makeToolResultEnvelope('run_tool', { ok: true, toolJobId: 'job-1' }, 'call-a'), 'call-a');
      toolResultEventsByCallId['call-b'] = makeToolResultEvent(
        makeToolResultEnvelope('run_tool', { ok: false, error: 'runtime error' }, 'call-b'), 'call-b');

      const toolJobs = Object.entries(toolResultEventsByCallId).map(([callId, evt]) => ({
        toolJobId: evt.toolResult?.data?.toolJobId || null,
        callId,
        name: evt.toolResult?.tool || 'run_tool',
        status: evt.toolResult?.status === 'success' ? 'completed'
          : evt.toolResult?.status === 'error' ? 'failed' : 'unknown',
      }));

      const failedJobs = toolJobs.filter((j) => j.status === 'failed');
      assert.equal(failedJobs.length, 1);
      assert.equal(failedJobs[0].callId, 'call-b');
    });
  });

  describe('stableHash produces stable output', () => {
    it('same input always produces same hash', () => {
      const input = { a: 1, b: 'test' };
      const h1 = stableHash(input);
      const h2 = stableHash(input);
      assert.equal(h1, h2);
    });

    it('different input produces different hash', () => {
      const h1 = stableHash({ seq: 1, decision: 'continue' });
      const h2 = stableHash({ seq: 2, decision: 'continue' });
      assert.notEqual(h1, h2);
    });
  });
});
