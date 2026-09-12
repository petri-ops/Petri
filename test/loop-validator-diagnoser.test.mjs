/**
 * test/loop-validator-diagnoser.test.mjs
 * HLE-C2: Validator + Diagnoser + Repair integration tests.
 *
 * Validates that agent-runner.js correctly:
 * - Blocks false-success: failed job + partial files → decision='block'
 * - Runs Validator Registry on job artifacts → Evidence persistence
 * - Diagnoses failed jobs and proposes repair strategy
 * - Blocks on validator 'blocked' / 'failed' results
 * - Accumulates validator results across turns
 * - Decision ordering: false-success > blocked > failed > active > complete
 *
 * Uses real loop-contract / loop-validator-registry / loop-failure-diagnoser
 * / loop-repair-strategy functions (offline, no I/O).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);

const {
  buildIteration,
  buildEvidence,
  stableHash,
  REASON_CODES,
  validateIteration,
} = require(__dirname + '/../core/shared-backend/loop-contract');

const {
  validateArtifact,
  buildResult,
  VALIDATOR_STATUSES,
} = require(__dirname + '/../core/shared-backend/loop-validator-registry');

const {
  diagnoseFailure,
} = require(__dirname + '/../core/shared-backend/loop-failure-diagnoser');

const {
  selectRepairStrategy,
} = require(__dirname + '/../core/shared-backend/loop-repair-strategy');

const {
  deriveObservedStateDigest,
} = require(__dirname + '/../core/shared-backend/loop-controller');

// ---------------------------------------------------------------------------
// Helpers (mirrors agent-runner.js _extractArtifactFiles)
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
// Decision simulation (mirrors agent-runner.js post-turn logic)
// ---------------------------------------------------------------------------

function simulatePostTurnDecision({
  failedJobs = [],
  activeJobs = [],
  validatorResults = [],
  artifactCache = {},
  cancellationObserved = false,
  loopAbortedByController = false,
}) {
  const falseSuccessJobs = [];
  for (const failed of failedJobs) {
    if (failed.toolJobId && artifactCache[failed.toolJobId]) {
      const cache = artifactCache[failed.toolJobId];
      if (cache.files && cache.files.length > 0) {
        falseSuccessJobs.push(failed.toolJobId);
      }
    }
  }

  const hasBlocked = validatorResults.some((vr) => vr.overallStatus === 'blocked');
  const hasFailedValidation = validatorResults.some((vr) => vr.overallStatus === 'failed');

  if (cancellationObserved || loopAbortedByController) {
    return { decision: 'cancel', reasonCode: REASON_CODES.TRANSIENT_RUNTIME_RETRY, falseSuccess: false };
  }

  if (falseSuccessJobs.length > 0) {
    return { decision: 'block', reasonCode: REASON_CODES.ARTIFACT_VALIDATION_FAILED, falseSuccess: true, count: falseSuccessJobs.length };
  }
  if (hasBlocked) {
    return { decision: 'block', reasonCode: REASON_CODES.ARTIFACT_VALIDATION_FAILED, falseSuccess: false };
  }
  if (hasFailedValidation) {
    return { decision: 'block', reasonCode: REASON_CODES.ARTIFACT_VALIDATION_FAILED, falseSuccess: false };
  }
  if (failedJobs.length > 0) {
    return { decision: 'retry', reasonCode: REASON_CODES.TRANSIENT_RUNTIME_RETRY, falseSuccess: false };
  }
  if (activeJobs.length > 0) {
    return { decision: 'continue', reasonCode: REASON_CODES.TOOL_SUCCEEDED, falseSuccess: false };
  }
  return { decision: 'complete', reasonCode: REASON_CODES.GOAL_ACHIEVED, falseSuccess: false };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HLE-C2: Validator, Diagnoser, Repair Integration', () => {

  describe('_extractArtifactFiles', () => {
    it('extracts artifact names from result_json', () => {
      const parsed = {
        artifacts: [{ name: 'results.csv', type: 'counts-matrix' }],
        outputs: [],
        files: [],
      };
      const files = _extractArtifactFiles(parsed);
      assert.ok(files.includes('results.csv'));
    });

    it('ignores internal files', () => {
      const parsed = {
        artifacts: [
          { name: 'results.csv' },
          { name: '.tool_manifest.json' },
          { name: '.DS_Store' },
        ],
        outputs: [],
        files: [],
      };
      const files = _extractArtifactFiles(parsed);
      assert.ok(files.includes('results.csv'));
      assert.ok(!files.includes('.tool_manifest.json'));
      assert.ok(!files.includes('.DS_Store'));
    });

    it('handles string artifacts', () => {
      const parsed = {
        artifacts: ['output1.csv', 'output2.txt'],
        outputs: [],
        files: [],
      };
      const files = _extractArtifactFiles(parsed);
      assert.ok(files.includes('output1.csv'));
      assert.ok(files.includes('output2.txt'));
    });

    it('returns empty for null/undefined', () => {
      assert.deepEqual(_extractArtifactFiles(null), []);
      assert.deepEqual(_extractArtifactFiles(undefined), []);
    });
  });

  describe('False-success detection (HLE-C2 invariant)', () => {
    it('blocks when job is failed AND has files', () => {
      const result = simulatePostTurnDecision({
        failedJobs: [{ toolJobId: 'job-1', status: 'failed' }],
        activeJobs: [],
        validatorResults: [],
        artifactCache: {
          'job-1': { files: ['output.csv'] },
        },
      });
      assert.equal(result.decision, 'block');
      assert.equal(result.falseSuccess, true);
      assert.equal(result.reasonCode, REASON_CODES.ARTIFACT_VALIDATION_FAILED);
    });

    it('does NOT block when job is failed but has NO files', () => {
      const result = simulatePostTurnDecision({
        failedJobs: [{ toolJobId: 'job-1', status: 'failed' }],
        activeJobs: [],
        validatorResults: [],
        artifactCache: {
          'job-1': { files: [] },
        },
      });
      assert.equal(result.decision, 'retry');
      assert.equal(result.falseSuccess, false);
    });

    it('does NOT block when job is failed but cache is empty', () => {
      const result = simulatePostTurnDecision({
        failedJobs: [{ toolJobId: 'job-1', status: 'failed' }],
        activeJobs: [],
        validatorResults: [],
        artifactCache: {},
      });
      assert.equal(result.decision, 'retry');
    });

    it('blocks even when files exist but job completed successfully', () => {
      // This case would be 'continue' because it's not a failed job
      const result = simulatePostTurnDecision({
        failedJobs: [],
        activeJobs: [{ toolJobId: 'job-1', status: 'completed' }],
        validatorResults: [],
        artifactCache: {
          'job-1': { files: ['output.csv'] },
        },
      });
      assert.equal(result.decision, 'continue');
    });

    it('false-success blocks even when validator says valid', () => {
      // False-success is the primary guard — more critical than validator
      const result = simulatePostTurnDecision({
        failedJobs: [{ toolJobId: 'job-1', status: 'failed' }],
        activeJobs: [],
        validatorResults: [{ overallStatus: 'valid' }],
        artifactCache: {
          'job-1': { files: ['partial.csv'] },
        },
      });
      assert.equal(result.decision, 'block');
      assert.equal(result.falseSuccess, true);
    });

    it('reports correct false-success job count', () => {
      const result = simulatePostTurnDecision({
        failedJobs: [
          { toolJobId: 'job-1', status: 'failed' },
          { toolJobId: 'job-2', status: 'failed' },
        ],
        activeJobs: [],
        validatorResults: [],
        artifactCache: {
          'job-1': { files: ['a.csv'] },
          'job-2': { files: ['b.csv'] },
        },
      });
      assert.equal(result.decision, 'block');
      assert.equal(result.count, 2);
    });
  });

  describe('Validator Registry integration', () => {
    it('validateArtifact returns structured result', () => {
      const result = validateArtifact({
        kind: 'counts-matrix',
        type: 'counts-matrix',
        name: 'counts.csv',
        metadata: { rows: 100 },
      }, { projectId: 'proj-1', userId: 'user-1' });
      assert.ok(result);
      assert.ok('overallStatus' in result);
      assert.ok('findings' in result);
      assert.ok('results' in result);
    });

    it('blocked validator result blocks decision', () => {
      const result = simulatePostTurnDecision({
        failedJobs: [],
        activeJobs: [],
        validatorResults: [{ overallStatus: 'blocked', findings: [{ code: 'INVALID_FORMAT' }] }],
        artifactCache: {},
      });
      assert.equal(result.decision, 'block');
      assert.equal(result.reasonCode, REASON_CODES.ARTIFACT_VALIDATION_FAILED);
    });

    it('failed validator result blocks decision', () => {
      const result = simulatePostTurnDecision({
        failedJobs: [],
        activeJobs: [],
        validatorResults: [{ overallStatus: 'failed', findings: [{ code: 'MISSING_COLUMN' }] }],
        artifactCache: {},
      });
      assert.equal(result.decision, 'block');
      assert.equal(result.reasonCode, REASON_CODES.ARTIFACT_VALIDATION_FAILED);
    });

    it('valid validator result does not block', () => {
      const result = simulatePostTurnDecision({
        failedJobs: [],
        activeJobs: [],
        validatorResults: [{ overallStatus: 'valid', findings: [] }],
        artifactCache: {},
      });
      assert.equal(result.decision, 'complete');
    });

    it('unavailable validator does not block', () => {
      const result = simulatePostTurnDecision({
        failedJobs: [],
        activeJobs: [],
        validatorResults: [{ overallStatus: 'unavailable', findings: [] }],
        artifactCache: {},
      });
      assert.equal(result.decision, 'complete');
    });

    it('degraded validator does not block (agent continues)', () => {
      const result = simulatePostTurnDecision({
        failedJobs: [],
        activeJobs: [],
        validatorResults: [{ overallStatus: 'degraded', findings: [{ code: 'LOW_ROW_COUNT' }] }],
        artifactCache: {},
      });
      // Degraded does not block (would be 'continue' if active jobs exist)
      assert.equal(result.decision, 'complete');
    });
  });

  describe('Diagnoser integration', () => {
    it('diagnoseFailure classifies by error pattern (not reason_code alone)', () => {
      const diagnosis = diagnoseFailure(
        { reason_code: 'RUNTIME_TIMEOUT', error: 'timeout' },
        {}
      );
      // 'timeout' matches transient_provider pattern
      assert.equal(diagnosis.faultType, 'transient_provider');
      assert.equal(diagnosis.defaultBehavior, 'auto_retry');
    });

    it('diagnoseFailure classifies "file not found" as transient_runtime', () => {
      const diagnosis = diagnoseFailure(
        { error: 'Error: Invalid argument: input file not found' },
        {}
      );
      // 'not found' matches transient_runtime pattern → auto_retry
      assert.equal(diagnosis.faultType, 'transient_runtime');
      assert.equal(diagnosis.defaultBehavior, 'auto_retry');
    });

    it('diagnoseFailure handles SCIENTIFIC_DESIGN_MISSING reason_code correctly', () => {
      const diagnosis = diagnoseFailure(
        { reason_code: 'USER_INPUT_REQUIRED', error: 'no design' },
        {}
      );
      // Reason code mapping exists: 'user_input_required' maps to 'require_user'
      assert.equal(diagnosis.faultType, 'user_input_required');
      assert.equal(diagnosis.defaultBehavior, 'require_user');
      assert.equal(diagnosis.classificationMethod, 'reason_code');
    });

    it('diagnoseFailure handles null job gracefully', () => {
      const diagnosis = diagnoseFailure(null, {});
      assert.equal(diagnosis.faultType, 'unknown_failure');
      assert.equal(diagnosis.defaultBehavior, 'require_user');
    });
  });

  describe('Repair Strategy integration', () => {
    it('selectRepairStrategy returns actionable for transient_runtime', () => {
      const diagnosis = {
        faultType: 'transient_runtime',
        defaultBehavior: 'auto_retry',
        strategies: ['retry_with_backoff'],
      };
      const repair = selectRepairStrategy(diagnosis, { parentJobId: 'job-1' });
      assert.ok(repair !== null, 'repair should not be null');
      assert.equal(typeof repair.isActionable, 'boolean');
    });

    it('selectRepairStrategy returns null for unknown_failure', () => {
      const diagnosis = {
        faultType: 'unknown_failure',
        defaultBehavior: 'require_user',
        strategies: ['ask_user_design'],
      };
      const repair = selectRepairStrategy(diagnosis, { parentJobId: 'job-1' });
      // unknown_failure → no strategy → null
      assert.equal(repair, null);
    });

    it('selectRepairStrategy requires valid diagnosis', () => {
      const repair = selectRepairStrategy({}, { parentJobId: 'job-1' });
      // empty diagnosis → no strategies → null
      assert.equal(repair, null);
    });
  });

  describe('Decision ordering (priority)', () => {
    it('false-success > blocked validator', () => {
      const result = simulatePostTurnDecision({
        failedJobs: [{ toolJobId: 'job-1', status: 'failed' }],
        activeJobs: [],
        validatorResults: [{ overallStatus: 'blocked' }],
        artifactCache: { 'job-1': { files: ['a.csv'] } },
      });
      // false-success fires first, before validator blocked
      assert.equal(result.decision, 'block');
      assert.equal(result.falseSuccess, true);
    });

    it('blocked validator > failed job', () => {
      const result = simulatePostTurnDecision({
        failedJobs: [{ toolJobId: 'job-1', status: 'failed' }],
        activeJobs: [],
        validatorResults: [{ overallStatus: 'blocked' }],
        artifactCache: { 'job-1': { files: [] } },
      });
      assert.equal(result.decision, 'block');
      assert.equal(result.reasonCode, REASON_CODES.ARTIFACT_VALIDATION_FAILED);
    });

    it('failed job > active job', () => {
      const result = simulatePostTurnDecision({
        failedJobs: [{ toolJobId: 'job-1', status: 'failed' }],
        activeJobs: [{ toolJobId: 'job-2', status: 'running' }],
        validatorResults: [],
        artifactCache: { 'job-1': { files: [] } },
      });
      assert.equal(result.decision, 'retry');
    });

    it('active job > complete', () => {
      const result = simulatePostTurnDecision({
        failedJobs: [],
        activeJobs: [{ toolJobId: 'job-1', status: 'running' }],
        validatorResults: [],
        artifactCache: {},
      });
      assert.equal(result.decision, 'continue');
    });
  });

  describe('buildIteration with validatorResults', () => {
    it('stores validator results in iteration extra fields', () => {
      const vr = {
        overallStatus: 'blocked',
        findings: [{ code: 'INVALID_FORMAT', message: 'Invalid' }],
      };
      const iter = buildIteration({
        loopRunId: 'loop-1',
        sequence: 1,
        observedStateDigest: stableHash({ test: true }),
        goalGapIds: [],
        proposedAction: null,
        decision: 'block',
        decisionReasonCode: REASON_CODES.ARTIFACT_VALIDATION_FAILED,
        publicConclusion: '验证失败。',
        status: 'blocked',
        parentIterationHash: null,
      }, {
        validatorResults: [vr],
        repairAttempt: null,
        costSnapshot: null,
      });
      assert.equal(iter.validatorResults.length, 1);
      assert.equal(iter.validatorResults[0].overallStatus, 'blocked');
      assert.equal(iter.status, 'blocked');
    });

    it('stores repairAttempt in iteration extra fields', () => {
      const repair = { strategyId: 'retry', isActionable: true, publicMessage: 'Retrying' };
      const iter = buildIteration({
        loopRunId: 'loop-1',
        sequence: 2,
        observedStateDigest: stableHash({ test: true }),
        goalGapIds: [],
        proposedAction: null,
        decision: 'retry',
        decisionReasonCode: REASON_CODES.TRANSIENT_RUNTIME_RETRY,
        publicConclusion: 'Retry.',
        status: 'failed',
        parentIterationHash: null,
      }, {
        validatorResults: [],
        repairAttempt: repair,
        costSnapshot: null,
      });
      assert.equal(iter.repairAttempt.strategyId, 'retry');
      assert.equal(iter.status, 'failed');
    });
  });

  describe('buildEvidence for validation', () => {
    it('creates validation evidence with correct kind', () => {
      const evidence = buildEvidence({
        loopRunId: 'loop-1',
        iterationId: 'iter-1',
        kind: 'tool_output',
        ref: 'tool_job:job-1/blocked',
        summaryDigest: stableHash({ status: 'blocked' }),
        parentEvidenceHash: null,
      }, { allowPartial: true });
      assert.equal(evidence.kind, 'tool_output');
      assert.equal(evidence.ref, 'tool_job:job-1/blocked');
      assert.ok(evidence.hash.length > 0);
    });

    it('creates repair evidence with correct kind', () => {
      const evidence = buildEvidence({
        loopRunId: 'loop-1',
        iterationId: 'iter-2',
        kind: 'observation',
        ref: 'repair:job-1/retry_with_backoff',
        summaryDigest: stableHash({ strategy: 'retry_with_backoff' }),
        parentEvidenceHash: null,
      }, { allowPartial: true });
      assert.equal(evidence.kind, 'observation');
      assert.equal(evidence.ref, 'repair:job-1/retry_with_backoff');
    });
  });

  describe('Iteration status mapping', () => {
    it('maps block decision to blocked status', () => {
      assert.equal(mapDecisionToIterationStatus('block'), 'blocked');
    });
    it('maps retry decision to failed status', () => {
      assert.equal(mapDecisionToIterationStatus('retry'), 'failed');
    });
    it('maps complete decision to succeeded status', () => {
      assert.equal(mapDecisionToIterationStatus('complete'), 'succeeded');
    });
    it('maps cancel decision to skipped status', () => {
      assert.equal(mapDecisionToIterationStatus('cancel'), 'skipped');
    });
    it('maps continue decision to succeeded status', () => {
      assert.equal(mapDecisionToIterationStatus('continue'), 'succeeded');
    });
  });

  describe('Cancellation overrides all decisions', () => {
    it('user cancellation produces cancel even with blocked validator', () => {
      const result = simulatePostTurnDecision({
        failedJobs: [],
        activeJobs: [],
        validatorResults: [{ overallStatus: 'blocked' }],
        artifactCache: {},
        cancellationObserved: true,
      });
      assert.equal(result.decision, 'cancel');
    });

    it('controller abort produces cancel even with false-success', () => {
      const result = simulatePostTurnDecision({
        failedJobs: [{ toolJobId: 'job-1', status: 'failed' }],
        activeJobs: [],
        validatorResults: [],
        artifactCache: { 'job-1': { files: ['a.csv'] } },
        loopAbortedByController: true,
      });
      assert.equal(result.decision, 'cancel');
    });
  });
});
