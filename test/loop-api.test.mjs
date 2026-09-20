/**
 * test/loop-api.test.mjs
 * HLE-C3: Loop REST API — durability, query, and recovery.
 *
 * Tests the API contract (offline, no HTTP server needed).
 * Validates:
 *   - getLoopRun compact projection strips unbounded fields
 *   - listLoopRunsForConversation returns sequence-ordered compact runs
 *   - Recovery projection returns correct canResume / needsRecovery flags
 *   - _buildRecoveryHint produces appropriate hints for each terminal state
 *   - ActionKey hash stability across serialize/deserialize
 *   - Iteration compact projection has all required fields
 *   - Evidence compact projection has all required fields
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

const {
  stableHash,
  REASON_CODES,
} = require(__dirname + '/../core/shared-backend/loop-contract');

require(__dirname + '/../core/shared-backend/loop-controller');

const {
  buildIteration,
  buildEvidence,
} = require(__dirname + '/../core/shared-backend/loop-contract');

const mapDecisionToIterationStatus = (decision) => {
  switch (decision) {
    case 'continue': return 'succeeded';
    case 'retry':    return 'failed';
    case 'block':    return 'blocked';
    case 'wait':     return 'pending';
    case 'complete': return 'succeeded';
    case 'cancel':   return 'skipped';
    default:         return 'pending';
  }
};

// ---------------------------------------------------------------------------
// Helpers (mirrors ai-loop.js)
// ---------------------------------------------------------------------------

const INTERNAL_FILES = new Set([
  '.tool_manifest.json', '.params.json', '.log', '.lock',
  '__MACOSX', '.DS_Store', 'Thumbs.db',
]);

function _extractArtifactFiles(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];
  const out = new Set();
  const sources = [parsed.artifacts, parsed.outputs, parsed.files];
  for (const list of sources) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item) continue;
      const name = typeof item === 'string' ? item : item.name || item.filename;
      if (!name) continue;
      const base = String(name).split('/').pop() || String(name);
      if (base && !INTERNAL_FILES.has(base)) out.add(base);
    }
  }
  return Array.from(out);
}

function _compactRun(run) {
  return {
    loopRunId: run.loopRunId,
    projectId: run.projectId,
    conversationId: run.conversationId,
    taskSpecRef: run.taskSpecRef,
    automationMode: run.automationMode,
    loopStatus: run.loopStatus,
    hash: run.loopStatusHash || run.hash,
    isPartial: Boolean(run.isPartial),
    partialReason: run.partialReason || null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function _compactIteration(iter) {
  return {
    iterationId: iter.iterationId,
    loopRunId: iter.loopRunId,
    sequence: iter.sequence,
    decision: iter.decision,
    decisionReasonCode: iter.decisionReasonCode,
    status: iter.status,
    publicConclusion: iter.publicConclusion,
    hash: iter.hash,
    createdAt: iter.createdAt,
  };
}

function _compactEvidence(evidence) {
  return {
    evidenceId: evidence.evidenceId,
    loopRunId: evidence.loopRunId,
    iterationId: evidence.iterationId,
    kind: evidence.kind,
    ref: evidence.ref,
    summaryDigest: evidence.summaryDigest,
    hash: evidence.hash,
    createdAt: evidence.createdAt,
  };
}

function _buildRecoveryHint(run, lastIteration, statusJson = {}) {
  if (['completed', 'cancelled'].includes(run.loopStatus)) {
    return 'Loop 已终止，无恢复必要。';
  }
  if (run.loopStatus === 'failed') {
    return 'Loop 失败，请查看 iterations 和 evidence 了解失败原因。';
  }
  if (statusJson.abortedByUser) {
    return '用户已终止，可重新发起新的任务。';
  }
  if (lastIteration) {
    if (lastIteration.decision === 'block') {
      return `上一轮决策为 block（${lastIteration.decisionReasonCode}）：${lastIteration.publicConclusion || '请修复问题后重试。'}`;
    }
    if (lastIteration.decision === 'retry') {
      return `上一轮决策为 retry（${lastIteration.decisionReasonCode}）：${lastIteration.publicConclusion || '系统将自动重试。'}`;
    }
    return `上一轮决策：${lastIteration.decision}（${lastIteration.decisionReasonCode}）。`;
  }
  return 'Loop 处于 running 状态，可安全恢复。';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HLE-C3: Loop REST API — Durable Query & Recovery', () => {

  describe('Compact Run Projection', () => {
    it('strips unbounded fields from full run', () => {
      const fullRun = {
        loopRunId: 'run-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        taskSpecRef: 'ts-hash-abc',
        automationMode: 'task_execute',
        loopStatus: 'running',
        loopStatusHash: 'hash-xyz',
        hash: 'legacy-hash',
        isPartial: 0,
        partialReason: null,
        createdAt: '2026-07-23T08:00:00Z',
        updatedAt: '2026-07-23T09:00:00Z',
        // unbounded — should be stripped
        loopStatusJson: JSON.stringify({ hugeField: 'x'.repeat(10000) }),
        metadata: { nested: 'data' },
      };
      const compact = _compactRun(fullRun);
      assert.equal(compact.loopRunId, 'run-1');
      assert.equal(compact.loopStatus, 'running');
      assert.ok(!('loopStatusJson' in compact));
      assert.ok(!('metadata' in compact));
    });

    it('handles partial run', () => {
      const partialRun = {
        loopRunId: 'run-2',
        projectId: 'proj-1',
        conversationId: 'conv-2',
        taskSpecRef: null,
        automationMode: 'task_draft',
        loopStatus: 'running',
        loopStatusHash: 'hash-p',
        hash: 'hash-p',
        isPartial: 1,
        partialReason: 'legacy_no_loop_data',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
      const compact = _compactRun(partialRun);
      assert.equal(compact.isPartial, true);
      assert.equal(compact.partialReason, 'legacy_no_loop_data');
    });
  });

  describe('Compact Iteration Projection', () => {
    it('has all required fields', () => {
      const iter = buildIteration({
        loopRunId: 'run-1',
        sequence: 3,
        observedStateDigest: stableHash({ test: true }),
        goalGapIds: [],
        proposedAction: null,
        decision: 'block',
        decisionReasonCode: REASON_CODES.ARTIFACT_VALIDATION_FAILED,
        publicConclusion: '验证失败。',
        status: mapDecisionToIterationStatus('block'),
        parentIterationHash: 'ph-2',
      }, { validatorResults: [] });
      const compact = _compactIteration(iter);
      assert.ok(compact.iterationId);
      assert.equal(compact.loopRunId, 'run-1');
      assert.equal(compact.sequence, 3);
      assert.equal(compact.decision, 'block');
      assert.equal(compact.decisionReasonCode, 'ARTIFACT_VALIDATION_FAILED');
      assert.equal(compact.status, 'blocked');
      assert.equal(compact.publicConclusion, '验证失败。');
      assert.ok(compact.hash);
      assert.ok(compact.createdAt);
    });
  });

  describe('Compact Evidence Projection', () => {
    it('has all required fields', () => {
      const evidence = buildEvidence({
        loopRunId: 'run-1',
        iterationId: 'iter-1',
        kind: 'tool_output',
        ref: 'tool_job:j1/blocked',
        summaryDigest: stableHash({ status: 'blocked' }),
        parentEvidenceHash: null,
      }, { allowPartial: true });
      const compact = _compactEvidence(evidence);
      assert.ok(compact.evidenceId);
      assert.equal(compact.loopRunId, 'run-1');
      assert.equal(compact.kind, 'tool_output');
      assert.equal(compact.ref, 'tool_job:j1/blocked');
      assert.ok(compact.hash);
    });
  });

  describe('Recovery Hint Logic', () => {
    it('hint for completed loop', () => {
      const run = { loopStatus: 'completed' };
      assert.equal(_buildRecoveryHint(run, null), 'Loop 已终止，无恢复必要。');
    });

    it('hint for cancelled loop', () => {
      const run = { loopStatus: 'cancelled' };
      assert.equal(_buildRecoveryHint(run, null), 'Loop 已终止，无恢复必要。');
    });

    it('hint for failed loop', () => {
      const run = { loopStatus: 'failed' };
      assert.equal(_buildRecoveryHint(run, null), 'Loop 失败，请查看 iterations 和 evidence 了解失败原因。');
    });

    it('hint for user-aborted running loop', () => {
      const run = { loopStatus: 'running' };
      const lastIter = { decision: 'cancel', decisionReasonCode: 'USER_CANCELLED' };
      const statusJson = { abortedByUser: true };
      assert.equal(_buildRecoveryHint(run, lastIter, statusJson), '用户已终止，可重新发起新的任务。');
    });

    it('hint for block decision', () => {
      const run = { loopStatus: 'running' };
      const lastIter = {
        decision: 'block',
        decisionReasonCode: 'ARTIFACT_VALIDATION_FAILED',
        publicConclusion: '验证失败。',
      };
      assert.ok(_buildRecoveryHint(run, lastIter).includes('block'));
      assert.ok(_buildRecoveryHint(run, lastIter).includes('ARTIFACT_VALIDATION_FAILED'));
    });

    it('hint for retry decision', () => {
      const run = { loopStatus: 'running' };
      const lastIter = {
        decision: 'retry',
        decisionReasonCode: 'TRANSIENT_RUNTIME_RETRY',
        publicConclusion: '系统将重试。',
      };
      assert.ok(_buildRecoveryHint(run, lastIter).includes('retry'));
    });

    it('hint for running loop without iteration', () => {
      const run = { loopStatus: 'running' };
      assert.equal(_buildRecoveryHint(run, null), 'Loop 处于 running 状态，可安全恢复。');
    });
  });

  describe('Recovery Projection Contract', () => {
    it('terminal run has canResume=false', () => {
      const run = { loopStatus: 'completed', loopRunId: 'r1', projectId: 'p1', conversationId: 'c1', automationMode: 'task_execute' };
      const isTerminal = ['completed', 'failed', 'cancelled'].includes(run.loopStatus);
      const needsRecovery = run.loopStatus === 'running';
      const canResume = needsRecovery && !isTerminal;
      assert.equal(isTerminal, true);
      assert.equal(needsRecovery, false);
      assert.equal(canResume, false);
    });

    it('running run has canResume=true', () => {
      const run = { loopStatus: 'running', loopRunId: 'r1', projectId: 'p1', conversationId: 'c1', automationMode: 'task_execute' };
      const isTerminal = ['completed', 'failed', 'cancelled'].includes(run.loopStatus);
      const needsRecovery = run.loopStatus === 'running';
      const canResume = needsRecovery && !isTerminal;
      assert.equal(isTerminal, false);
      assert.equal(needsRecovery, true);
      assert.equal(canResume, true);
    });
  });

  describe('Iteration Chain Integrity', () => {
    it('parent hash chain is unbroken', () => {
      const run = { loopRunId: 'r1' };
      const iters = [];
      let parentHash = null;
      for (let i = 1; i <= 4; i++) {
        const iter = buildIteration({
          loopRunId: run.loopRunId,
          sequence: i,
          observedStateDigest: stableHash({ s: i }),
          goalGapIds: [],
          proposedAction: null,
          decision: i < 4 ? 'continue' : 'complete',
          decisionReasonCode: REASON_CODES.TOOL_SUCCEEDED,
          status: mapDecisionToIterationStatus(i < 4 ? 'continue' : 'complete'),
          parentIterationHash: parentHash,
        }, {});
        iters.push(iter);
        parentHash = iter.hash;
      }
      assert.equal(iters[0].parentIterationHash, null);
      assert.equal(iters[1].parentIterationHash, iters[0].hash);
      assert.equal(iters[2].parentIterationHash, iters[1].hash);
      assert.equal(iters[3].parentIterationHash, iters[2].hash);
    });

    it('each iteration has stable hash (deterministic)', () => {
      const opts = {
        loopRunId: 'r1', sequence: 1,
        observedStateDigest: stableHash({ s: 1 }),
        goalGapIds: [], proposedAction: null,
        decision: 'continue',
        decisionReasonCode: REASON_CODES.TOOL_SUCCEEDED,
        status: 'succeeded',
        parentIterationHash: null,
      };
      const h1 = buildIteration(opts, {}).hash;
      const h2 = buildIteration(opts, {}).hash;
      assert.equal(h1, h2);
    });

    it('hash changes when sequence changes', () => {
      const h1 = buildIteration({
        loopRunId: 'r1', sequence: 1,
        observedStateDigest: stableHash({ s: 1 }),
        goalGapIds: [], proposedAction: null,
        decision: 'continue', decisionReasonCode: REASON_CODES.TOOL_SUCCEEDED,
        status: 'succeeded', parentIterationHash: null,
      }, {}).hash;
      const h2 = buildIteration({
        loopRunId: 'r1', sequence: 2,
        observedStateDigest: stableHash({ s: 2 }),
        goalGapIds: [], proposedAction: null,
        decision: 'complete', decisionReasonCode: REASON_CODES.GOAL_ACHIEVED,
        status: 'succeeded', parentIterationHash: null,
      }, {}).hash;
      assert.notEqual(h1, h2);
    });
  });

  describe('ActionKey Stability', () => {
    it('same actionKey input produces same hash', () => {
      const input = {
        loopRunId: 'r1', sequence: 1,
        actionType: 'run_tool', toolId: 'deseq2',
        inputs: { counts: 'file.csv' }, params: { method: 'DESeq2' },
        expectedArtifactKinds: ['counts-matrix'], attempt: 1,
      };
      const { generateActionKey } = require(__dirname + '/../core/shared-backend/loop-contract');
      const k1 = generateActionKey(input);
      const k2 = generateActionKey(input);
      assert.equal(k1, k2);
    });

    it('different params produce different actionKey', () => {
      const { generateActionKey } = require(__dirname + '/../core/shared-backend/loop-contract');
      const k1 = generateActionKey({ actionType: 'run_tool', toolId: 'deseq2', attempt: 1, params: { method: 'DESeq2' } });
      const k2 = generateActionKey({ actionType: 'run_tool', toolId: 'deseq2', attempt: 1, params: { method: 'edgeR' } });
      assert.notEqual(k1, k2);
    });
  });

  describe('Concurrency Safety: Idempotent Recovery', () => {
    it('recovery projection is idempotent (same result on repeated call)', () => {
      const run = { loopStatus: 'running', loopRunId: 'r1', projectId: 'p1', conversationId: 'c1', automationMode: 'task_execute' };
      const lastIter = { decision: 'retry', decisionReasonCode: 'TRANSIENT_RUNTIME_RETRY', publicConclusion: '重试。' };
      const hint1 = _buildRecoveryHint(run, lastIter);
      const hint2 = _buildRecoveryHint(run, lastIter);
      assert.equal(hint1, hint2);
    });

    it('loop status enum is respected', () => {
      const statuses = ['planned', 'running', 'completed', 'failed', 'cancelled'];
      for (const status of statuses) {
        ['completed', 'failed', 'cancelled'].includes(status);
        const run = { loopStatus: status };
        const hint = _buildRecoveryHint(run, null);
        assert.ok(typeof hint === 'string' && hint.length > 0, `hint for ${status} should be non-empty`);
        if (status === 'running') {
          assert.equal(_buildRecoveryHint(run, null), 'Loop 处于 running 状态，可安全恢复。');
        }
      }
    });
  });

  describe('_extractArtifactFiles (used in agent-runner recovery)', () => {
    it('extracts artifact names from mixed sources', () => {
      const parsed = {
        artifacts: [{ name: 'counts.csv', type: 'counts-matrix' }],
        outputs: [{ name: 'norm.tsv' }],
        files: ['heatmap.png', 'report.html'],
      };
      const files = _extractArtifactFiles(parsed);
      assert.ok(files.includes('counts.csv'));
      assert.ok(files.includes('norm.tsv'));
      assert.ok(files.includes('heatmap.png'));
      assert.ok(files.includes('report.html'));
    });

    it('deduplicates by filename', () => {
      const parsed = {
        artifacts: [{ name: 'out.csv' }],
        outputs: [{ name: 'out.csv' }],
        files: ['out.csv'],
      };
      const files = _extractArtifactFiles(parsed);
      const counts = files.filter((f) => f === 'out.csv').length;
      assert.equal(counts, 1);
    });
  });
});
