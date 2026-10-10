#!/usr/bin/env node

/**
 * HLE-C0: False-success regression tests.
 *
 * Regression test for the scenario: failed Job + partial files + model claims complete.
 *
 * This is the scenario that historically caused the system to falsely claim a
 * scientific task complete when:
 *   1. The Job status was 'failed'
 *   2. Some output files existed in the directory (partial results)
 *   3. The model verbally claimed the analysis was successful
 *
 * The Loop must NEVER claim completion when:
 *   - Job is failed / cancelled / running / queued / unknown
 *   - Required artifacts are missing
 *   - Delivery manifest has uncovered requirements
 *   - Artifact truth is blocked
 *
 * These tests verify that the Validator and Loop Controller correctly reject
 * false-positive completion claims.
 *
 * Run via: node --test test/loop-false-success-regression.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-loop-false-success-'));
process.env.PETRI_DB_PATH = path.join(TMP_DIR, 'test.db');

// ---------------------------------------------------------------------------
// Import modules under test
// ---------------------------------------------------------------------------
const lc = (await import('../core/shared-backend/loop-contract.js')).default;
const {
  validateArtifact,
  validateDelivery,
  aggregateStatus,
  registerValidator,
  clearRegistry,
  VALIDATOR_STATUSES,
} = (await import('../core/shared-backend/loop-validator-registry.js'));

// Register all built-in validators for these regression tests
clearRegistry();
const { BUILTIN_VALIDATOR_DEFS } = await import('../core/shared-backend/loop-validators.js');
for (const def of BUILTIN_VALIDATOR_DEFS) {
  registerValidator(def);
}

const {
  diagnoseFailure,
} = (await import('../core/shared-backend/loop-failure-diagnoser.js'));

const {
  selectRepairStrategy,
} = (await import('../core/shared-backend/loop-repair-strategy.js'));

const {
  buildIterationCheckpoint,
  buildLoopContextEnvelope,
} = (await import('../core/shared-backend/loop-checkpoint.js'));

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
process.on('exit', () => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// FALSE-SUCCESS SCENARIO TEST DATA
// ---------------------------------------------------------------------------

/**
 * Scenario: A DESeq2 analysis job failed because R script crashed,
 * but some intermediate files (partial counts, log files) were produced.
 * The model then claimed "analysis complete" in the chat.
 *
 * In the fixed system, this must:
 *   - NOT produce a valid delivery record
 *   - NOT produce a completed LoopRun
 *   - Show as blocked/degraded in UI
 *   - Be repairable (diagnoser classifies the failure, repair strategy applies)
 *
 * NOTE: diagnoseFailure reads job.error (not job.errorMessage)
 */
const FAILED_JOB_PARTIAL_FILES = {
  job: {
    id: 'job_partial_fail_001',
    status: 'failed',
    toolName: 'deseq2',
    params: {
      countFile: 'data/counts.csv',
      design: '~condition',
      contrast: ['condition', 'treatment', 'control'],
    },
    // NOTE: diagnoseFailure reads job.error
    error: 'Error in deseq2(): size factors must be positive — zero-count rows removed, found 0 remaining',
    startedAt: new Date(Date.now() - 60000).toISOString(),
    completedAt: new Date().toISOString(),
  },
  outputFiles: [
    { name: 'deseq2_partial_counts.csv', exists: true, size: 1024 },
    { name: 'deseq2_session_info.txt', exists: true, size: 512 },
    // Missing critical files:
    { name: 'deseq2_results.csv', exists: false },
    { name: 'deseq2_normalized_counts.csv', exists: false },
    { name: 'all_results.zip', exists: false },
  ],
  modelClaim: 'Analysis complete. Found 2,847 differentially expressed genes (p < 0.05).',
};

const DELIVERY_RECORD_FALSE_SUCCESS = {
  filename: 'deseq2_delivery_manifest.json',
  status: 'partial',   // Intentional: partial delivery, not success
  deliveryManifestVersion: '1.0',
  taskSpecRef: 'spt1-bulk-rnaseq',
  artifacts: [
    {
      id: 'partial_counts',
      filename: 'deseq2_partial_counts.csv',
      artifactTruth: { status: 'degraded', reason: 'partial_output' },
    },
  ],
  requirementCoverage: [
    { requirement: 'DE results table', status: 'unsatisfied' },
    { requirement: 'Normalized counts', status: 'unsatisfied' },
    { requirement: 'ZIP archive', status: 'unsatisfied' },
    { requirement: 'Report', status: 'unsatisfied' },
  ],
};

const ARTIFACT_FALSE_SUCCESS = {
  id: 'deseq2_results',
  filename: 'deseq2_results.csv',
  kind: 'json',
  artifactTruth: { status: 'blocked', reason: 'job_failed_no_output' },
  jobId: 'job_partial_fail_001',
  toolName: 'deseq2',
  paramsHash: 'abc123',
  outputHash: null,   // No output because job failed
  provenance: {
    jobId: 'job_partial_fail_001',
    toolName: 'deseq2',
    toolVersion: '1.42.0',
    startedAt: new Date(Date.now() - 60000).toISOString(),
    completedAt: new Date().toISOString(),
    status: 'failed',
    error: 'Error in deseq2(): size factors must be positive',
  },
};

// ===========================================================================
// TESTS: False-success regression
// ===========================================================================

describe('FSR-1: Validator must NOT validate a failed job artifact as valid', () => {
  it('FSR-1.1: validateArtifact with blocked artifactTruth returns blocked (not valid)', () => {
    // validateArtifact dispatches to registered validators by kind
    // validateArtifact returns { results, overallStatus } when validators fire
    const result = validateArtifact(ARTIFACT_FALSE_SUCCESS, {
      toolName: 'deseq2',
      dagNodeId: 'deseq2_analysis',
    });
    assert.ok(result, 'Validator must return a result');
    // overallStatus must NOT be 'valid'
    assert.notStrictEqual(
      result.overallStatus,
      VALIDATOR_STATUSES.VALID,
      `Expected NOT 'valid' but got: ${result.overallStatus} — failed job artifact must not be valid`,
    );
    assert.ok(
      result.overallStatus === VALIDATOR_STATUSES.BLOCKED ||
        result.overallStatus === VALIDATOR_STATUSES.UNAVAILABLE,
      `Expected blocked/unavailable but got: ${result.overallStatus}`,
    );
  });

  it('FSR-1.2: Delivery with uncovered requirements returns blocked/degraded', () => {
    const result = validateDelivery(DELIVERY_RECORD_FALSE_SUCCESS);
    assert.ok(result, 'Validator must return a result');
    assert.ok(
      result.status === VALIDATOR_STATUSES.BLOCKED ||
        result.status === VALIDATOR_STATUSES.DEGRADED,
      `Expected blocked/degraded but got: ${result.status} — partial delivery with unsatisfied requirements must not be valid`,
    );
    const hasUncoveredFinding = result.findings && result.findings.some(
      (f) => f.code === 'DELIVERY_REQUIREMENT_UNCOVERED' ||
             f.code === 'DELIVERY_NO_ARTIFACTS' ||
             f.code === 'DELIVERY_NO_VERSION' ||
             f.code === 'DELIVERY_ARTIFACT_TRUTH_BLOCKED',
    );
    assert.ok(
      hasUncoveredFinding,
      `Expected delivery finding, got: ${JSON.stringify(result.findings)}`,
    );
  });

  it('FSR-1.3: aggregateStatus returns BLOCKED when any status string is blocked', () => {
    // aggregateStatus takes string[], not objects
    const statuses = ['valid', 'valid', 'blocked', 'degraded'];
    const agg = aggregateStatus(statuses);
    // aggregateStatus returns the worst status: blocked > degraded > valid > unavailable
    assert.strictEqual(
      agg,
      'blocked',
      `aggregateStatus must return 'blocked', got: ${agg}`,
    );
  });
});

describe('FSR-2: Diagnoser must classify failed job with partial files', () => {
  it('FSR-2.1: Diagnose a failed job — returns a diagnosis with confidence', () => {
    // diagnoseFailure reads job.error (not job.errorMessage)
    // The DESeq2 error doesn't match any DIAGNOSIS_RULES pattern → falls to unknown_failure
    // But it still returns a valid diagnosis object with confidence
    const diagnosis = diagnoseFailure(FAILED_JOB_PARTIAL_FILES.job, {});
    assert.ok(diagnosis, 'Diagnoser must return a diagnosis for failed job');
    assert.ok(
      typeof diagnosis.faultType === 'string',
      `faultType must be string, got: ${typeof diagnosis.faultType}`,
    );
    assert.ok(
      typeof diagnosis.confidence === 'number' && diagnosis.confidence >= 0 && diagnosis.confidence <= 1,
      `Confidence must be 0..1, got: ${diagnosis.confidence}`,
    );
    // DESeq2 errors don't match any known pattern → unknown_failure with confidence 0.1
    assert.strictEqual(
      diagnosis.faultType,
      'unknown_failure',
      `DESeq2 error maps to unknown_failure (no pattern match), got: ${diagnosis.faultType}`,
    );
  });

  it('FSR-2.2: Diagnosed failure with a matching pattern has actionable repair strategy', () => {
    // When an error matches a DIAGNOSIS_RULES pattern, selectRepairStrategy returns a strategy
    // Use 'child process exited with code 1' which matches TRANSIENT_RUNTIME
    const diagnosedJob = {
      ...FAILED_JOB_PARTIAL_FILES.job,
      error: 'Error: child process exited with code 1',
    };
    const diagnosis = diagnoseFailure(diagnosedJob, {});
    assert.ok(diagnosis, 'Diagnoser must return a diagnosis');
    assert.strictEqual(
      diagnosis.faultType,
      'transient_runtime',
      `'child process exited with code 1' must match TRANSIENT_RUNTIME, got: ${diagnosis.faultType}`,
    );

    // With a known fault type, selectRepairStrategy should return a strategy
    const strategy = selectRepairStrategy(diagnosis, {});
    assert.ok(strategy, 'transient_runtime must have a repair strategy');
    assert.ok(strategy.strategyId, 'Strategy must have an id');
    assert.ok(
      typeof strategy.isActionable === 'boolean',
      'Strategy must have isActionable boolean',
    );
  });
});

describe('FSR-3: Loop Controller must NOT complete with failed job', () => {
  it('FSR-3.1: buildLoopContextEnvelope with blocked validator must not show complete', () => {
    const checkpoint = buildIterationCheckpoint({
      loopRunId: 'lr_fsr_001',
      loopRunHash: 'a'.repeat(64),
      sequence: 1,
      observedStateDigest: 'b'.repeat(64),
      goalGapIds: ['deseq2_results', 'deseq2_report'],
      decision: 'running',
      decisionReasonCode: 'TOOL_CALLED',
      status: 'pending',
      validatorResults: [
        { status: VALIDATOR_STATUSES.BLOCKED, validatorId: 'delivery-integrity', findings: [] },
      ],
      costSnapshot: { tokensUsed: 1000, costUsd: 0.05 },
    });

    const envelope = buildLoopContextEnvelope({
      loopRunId: 'lr_fsr_001',
      checkpoints: [checkpoint],
    });

    // The envelope must NOT claim the task is complete
    assert.notStrictEqual(
      envelope.loopState?.currentStatus,
      'completed',
      'Blocked delivery must not result in completed status',
    );
    assert.notStrictEqual(
      envelope.loopState?.currentDecision,
      'complete',
      'Blocked delivery must not result in complete decision',
    );
  });

  it('FSR-3.2: buildLoopContextEnvelope with failed job + blocked artifacts has unresolved gaps', () => {
    const checkpoint = buildIterationCheckpoint({
      loopRunId: 'lr_fsr_002',
      loopRunHash: 'c'.repeat(64),
      sequence: 1,
      observedStateDigest: 'd'.repeat(64),
      goalGapIds: ['deseq2_results', 'deseq2_report', 'all_results.zip'],
      decision: 'running',
      decisionReasonCode: 'ARTIFACT_VALIDATION_FAILED',
      status: 'pending',
      validatorResults: [
        {
          status: VALIDATOR_STATUSES.BLOCKED,
          validatorId: 'delivery-integrity',
          findings: [
            {
              code: 'DELIVERY_REQUIREMENT_UNCOVERED',
              message: '3 requirements not satisfied: DE results table, Normalized counts, ZIP archive',
              severity: 'error',
            },
          ],
        },
      ],
      repairAttempt: {
        strategyId: 'retry_with_reconcile',
        actionId: 'action_retry_001',
        isActionable: true,
      },
      costSnapshot: { tokensUsed: 2000, costUsd: 0.10 },
    });

    const envelope = buildLoopContextEnvelope({
      loopRunId: 'lr_fsr_002',
      checkpoints: [checkpoint],
    });

    // Must show that gaps exist and task is NOT complete
    assert.ok(
      envelope.unresolvedGaps && envelope.unresolvedGaps.length > 0,
      'Failed job with blocked delivery must have unresolved gaps',
    );
    assert.notStrictEqual(
      envelope.loopState?.currentStatus,
      'completed',
      'Envelope with blocked delivery must not be marked completed',
    );
  });
});

describe('FSR-4: Immutable truth — partial files do not override failed job status', () => {
  it('FSR-4.1: Job status "failed" is the immutable truth, not presence of files', () => {
    const job = FAILED_JOB_PARTIAL_FILES.job;
    const hasFiles = FAILED_JOB_PARTIAL_FILES.outputFiles.some((f) => f.exists);

    assert.strictEqual(job.status, 'failed', 'Job status must be failed');
    assert.ok(hasFiles, 'Some files may exist');

    // These two facts must NOT combine to claim success
    assert.notStrictEqual(job.status, 'completed', 'Failed job status must never be treated as completed');
  });

  it('FSR-4.2: diagnoseFailure reads job.error, not file count', () => {
    // diagnoseFailure uses job.error string, not file existence
    const diagnosis = diagnoseFailure(FAILED_JOB_PARTIAL_FILES.job, {});
    assert.ok(diagnosis.faultType, 'Must classify failure type from job.error string');
    assert.ok(
      typeof diagnosis.confidence === 'number',
      'Confidence must be a number',
    );
  });
});

describe('FSR-5: Route guard — /api/loop/iterate cannot claim success with failed job', () => {
  it('FSR-5.1: An iteration with decision=complete but blocked validatorResults builds without contract-level guard (HLE-C2 gap)', () => {
    // buildIteration does NOT enforce that blocked validatorResults prevent decision=complete.
    // This is the HLE-C2 gap that must be closed by the integration layer.
    const run = lc.buildLoopRun({
      projectId: 'project_test',
      conversationId: 'conv_test',
      taskSpecRef: 'spt1-bulk-rnaseq',
      loopStatus: 'running',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const blockedIteration = lc.buildIteration(
      {
        loopRunId: run.loopRunId,
        sequence: 1,
        observedStateDigest: 'd' + '0'.repeat(63),
        goalGapIds: [],
        proposedAction: {
          actionId: 'action_001',
          actionType: 'finalize',
          actionKey: 'finalize:deseq2:1',
          stable: true,
        },
        decision: 'complete',
        decisionReasonCode: 'ARTIFACT_VALIDATION_FAILED',
        status: 'pending',
      },
      {
        validatorResults: [
          {
            status: VALIDATOR_STATUSES.BLOCKED,
            validatorId: 'delivery-integrity',
            findings: [{ code: 'DELIVERY_REQUIREMENT_UNCOVERED', message: 'Missing critical artifacts', severity: 'error' }],
          },
        ],
        repairAttempt: null,
        costSnapshot: { tokensUsed: 100, costUsd: 0.01 },
      },
    );

    assert.ok(blockedIteration, 'Iteration builds despite blocked validatorResults (HLE-C2 gap)');
    assert.strictEqual(blockedIteration.decision, 'complete', 'Decision can be set to complete');
    assert.strictEqual(
      blockedIteration.validatorResults?.[0]?.status,
      VALIDATOR_STATUSES.BLOCKED,
      'Validator results record blocked status',
    );

    // HLE-C2 must add this guard: the integration layer should prevent
    // decision=complete from being persisted when validatorResults contain BLOCKED.
  });
});
