import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildP6RestartVolcanoInput,
  buildP6StopDeseq2Input,
  buildP6ValidatorBlockedCorrelationInput,
  captureP6RealDriftPrototype,
  captureP6RealFailurePrototype,
  captureP6RealRestartPrototype,
  captureP6RealStopPrototype,
  evaluateP6RealDriftPrototype,
  evaluateP6RealFailurePrototype,
  evaluateP6RealRestartPrototype,
  evaluateP6RealStopPrototype,
} from '../scripts/g0-rs-p6-real-restart-prototype.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('P6 restart prototype uses the existing real P5 worker entrypoint', () => {
  assert.equal(existsSync(path.join(ROOT, 'scripts/g0-rs-p5-acceptance.mjs')), true);
});

test('P6 restart prototype builds bounded deterministic scientific input bytes', () => {
  const first = buildP6RestartVolcanoInput(80);
  const second = buildP6RestartVolcanoInput(80);
  assert.equal(first, second);
  const lines = first.trim().split('\n');
  assert.equal(lines.length, 81);
  assert.equal(lines[0], 'gene,log2FoldChange,pvalue,padj');
  for (const line of lines.slice(1)) {
    const [gene, lfc, pvalue, padj] = line.split(',');
    assert.match(gene, /^GENE_[0-9]{4}$/);
    assert.equal(Number.isFinite(Number(lfc)), true);
    assert.equal(Number(pvalue) >= 0 && Number(pvalue) <= 1, true);
    assert.equal(Number(padj) >= 0 && Number(padj) <= 1, true);
  }
  assert.throws(() => buildP6RestartVolcanoInput(39), /p6_restart_input_row_count_invalid/);
  assert.throws(() => buildP6RestartVolcanoInput(100_001), /p6_restart_input_row_count_invalid/);
});

test('P6 stop prototype builds a valid replicated DESeq2 matrix', () => {
  const input = buildP6StopDeseq2Input(1_000);
  const rows = input.counts.trim().split('\n');
  assert.equal(rows.length, 1_001);
  assert.equal(rows[0], 'gene,C1,C2,C3,T1,T2,T3');
  assert.equal(rows[1].split(',').length, 7);
  assert.match(input.coldata, /C1,Control/);
  assert.match(input.coldata, /T3,Treatment/);
  assert.throws(() => buildP6StopDeseq2Input(999), /p6_stop_input_row_count_invalid/);
});

test('P6 validator prototype builds a deterministic matrix with a non-finite correlation boundary', () => {
  const input = buildP6ValidatorBlockedCorrelationInput();
  assert.equal(input, buildP6ValidatorBlockedCorrelationInput());
  assert.match(input, /^gene,S1,S2,S3,S4\n/);
  assert.match(input, /G_CONST,1,1,1,1/);
  assert.equal(input.trim().split('\n').length, 4);
});

test('P6 restart verdict requires every process and durable-store invariant', () => {
  const complete = {
    noSeedSeededTableCount: 0,
    baselineJobCompleted: true,
    baselineArtifactTruthValid: true,
    baselineRevisionCount: 3,
    baselineResourceSamplingMeasured: true,
    baselineCpuPeakMeasured: true,
    baselineRssPeakMeasured: true,
    baselineOutputPeakMeasured: true,
    baselineSystemResourcesMeasured: true,
    baselineActiveJobPeakMeasured: true,
    checkpointIntegrityBeforeKill: true,
    checkpointStageBeforeKill: 'candidate_committed',
    candidateRefMatchedBeforeKill: true,
    candidateJobRunningBeforeKill: true,
    workerExitSignal: 'SIGKILL',
    workerCompletionMarkerSeen: false,
    sqliteFileIdentityStable: true,
    sqliteJournalModeBefore: 'wal',
    sqliteJournalModeAfter: 'wal',
    workspaceStable: true,
    gitBindingStable: true,
    firstColdStatus: {
      status: 'recovery_available',
      checkpointIntegrity: { matches: true },
      consistency: { status: 'consistent' },
      interruptedCount: 1,
      activeOperationCount: 0,
      pendingIssues: [],
    },
    recoveryHttpStatus: 200,
    recoveryRepairKinds: ['running_to_validation_failed'],
    recoveredChangeSetStatus: 'validation_failed',
    recoveredCheckpointStatus: 'validation_failed',
    recoveredRevisionCount: 0,
    baselineDigestStable: true,
    baselineArtifactsExactAfterRecovery: true,
    secondColdStatus: {
      status: 'ready',
      checkpointIntegrity: { matches: true },
      consistency: { status: 'consistent' },
      interruptedCount: 0,
    },
    secondRecoveryRecovered: false,
    interruptedJobsTerminal: true,
  };
  const verdict = evaluateP6RealRestartPrototype(complete);
  assert.equal(verdict.passed, true);
  for (const key of Object.keys(complete)) {
    if (key === 'firstColdStatus' || key === 'secondColdStatus'
        || key === 'checkpointStageBeforeKill' || key === 'workerExitSignal'
        || key === 'sqliteJournalModeBefore' || key === 'sqliteJournalModeAfter'
        || key === 'recoveryRepairKinds' || key === 'noSeedSeededTableCount'
        || key === 'baselineRevisionCount' || key === 'recoveryHttpStatus'
        || key === 'recoveredRevisionCount') continue;
    const changed = { ...complete, [key]: !complete[key] };
    assert.equal(evaluateP6RealRestartPrototype(changed).passed, false, key);
  }
});

test('P6 user-stop verdict requires route, process, Job, ChangeSet and Artifact convergence', () => {
  const complete = {
    cancelHttpStatus: 200,
    cancelResponseStatus: 'cancelled',
    cancelTerminationConfirmed: true,
    cancelledJobStatus: 'cancelled',
    cancelledJobCompleted: true,
    cancelledProcessExited: true,
    cancelledResourceSamplingStatus: 'measured',
    cancelledResourceSampleCount: 2,
    cancelledResourcePeakStatus: 'partial_process_peak_unavailable',
    cancelledResourceProcessExitConfirmed: true,
    changeSetCountBefore: 1,
    changeSetCountAfter: 1,
    revisionCountBefore: 3,
    revisionCountAfter: 3,
    baselineDigestStable: true,
    baselineArtifactsExact: true,
    workspaceStatus: {
      status: 'ready', interruptedCount: 0, activeOperationCount: 0, pendingIssues: [],
    },
  };
  assert.equal(evaluateP6RealStopPrototype(complete).passed, true);
  assert.equal(evaluateP6RealStopPrototype({ ...complete, cancelledProcessExited: false }).passed, false);
  assert.equal(evaluateP6RealStopPrototype({ ...complete, cancelledResourceSampleCount: 0 }).passed, false);
  assert.equal(evaluateP6RealStopPrototype({ ...complete, revisionCountAfter: 4 }).passed, false);
  assert.equal(evaluateP6RealStopPrototype({
    ...complete, workspaceStatus: { ...complete.workspaceStatus, status: 'recovery_available' },
  }).passed, false);
});

test('P6 real-failure verdict separates R failure from scientific validator blocking', () => {
  const complete = {
    failedJobStatus: 'failed', failedJobCompleted: true, failedProcessExited: true,
    changeSetCountBeforeFailure: 1, changeSetCountAfterFailure: 1,
    revisionCountBeforeFailure: 3, revisionCountAfterFailure: 3,
    recoveryJobStatus: 'completed', recoveryJobArtifactTruthStatus: 'valid', recoveryJobArtifactsExact: true,
    validatorJobStatus: 'completed', validatorJobArtifactTruthStatus: 'valid', validatorJobArtifactsExact: true,
    validatorHttpStatus: 200, validatorRevisionCreated: false,
    validatorDiagnosticCode: 'baseline_plugin_validation_failed',
    changeSetCountBeforeValidator: 1, changeSetCountAfterValidator: 1,
    revisionCountBeforeValidator: 3, revisionCountAfterValidator: 3,
    baselineDigestStable: true, baselineArtifactsExact: true,
    workspaceStatus: { status: 'ready', interruptedCount: 0, activeOperationCount: 0, pendingIssues: [] },
  };
  assert.equal(evaluateP6RealFailurePrototype(complete).passed, true);
  assert.equal(evaluateP6RealFailurePrototype({ ...complete, failedJobStatus: 'completed' }).passed, false);
  assert.equal(evaluateP6RealFailurePrototype({ ...complete, validatorJobArtifactTruthStatus: 'blocked' }).passed, false);
  assert.equal(evaluateP6RealFailurePrototype({ ...complete, validatorDiagnosticCode: 'unknown' }).passed, false);
  assert.equal(evaluateP6RealFailurePrototype({ ...complete, validatorRevisionCreated: true }).passed, false);
  assert.equal(evaluateP6RealFailurePrototype({
    ...complete, changeSetCountAfterValidator: 2,
  }).passed, false);
});

test('P6 real-drift verdict requires every independent fail-closed boundary', () => {
  const ready = { status: 'ready' };
  const complete = {
    dirtyGitDetected: true, dirtyMarkerHashStable: true,
    artifactDriftStatus: { status: 'blocked', revisionIntegrityIssues: ['artifact_hash_drift'] },
    artifactRecoverHttpStatus: 409, artifactRecoverAfterStatus: 'blocked', afterArtifactRestoreStatus: ready,
    refDriftStatus: { status: 'blocked', revisionIntegrityIssues: ['current_ref_drift'] },
    refRecoverHttpStatus: 409, refRecoverAfterStatus: 'blocked', afterRefRestoreStatus: ready,
    scriptHashRevisionCreated: false, scriptHashDiagnosticCode: 'background_source_script_drift',
    scriptMissingRevisionCreated: false, scriptMissingDiagnosticCode: 'source_script_missing',
    scriptDriftChangeSetCountStable: true, scriptDriftRevisionCountStable: true,
    selectionCompatibility: 'stale', contextSelectionCompatibility: 'stale',
    contextSelectionExcluded: true, oldContextHttpStatus: 409,
    oldContextErrorCode: 'context_token_stale', oldContextWriteCountsStable: true,
    coldBootStatus: ready, historySourceStillExact: true,
    pluginReplayHttpStatus: 409, pluginReplayErrorCode: 'replay_plugin_version_drift',
    pluginReplayWriteCountsStable: true, currentRevisionArtifactsExact: true,
  };
  assert.equal(evaluateP6RealDriftPrototype(complete).passed, true);
  assert.equal(evaluateP6RealDriftPrototype({ ...complete, dirtyMarkerHashStable: false }).passed, false);
  assert.equal(evaluateP6RealDriftPrototype({ ...complete, oldContextErrorCode: 'unknown' }).passed, false);
  assert.equal(evaluateP6RealDriftPrototype({ ...complete, pluginReplayHttpStatus: 200 }).passed, false);
});

test('P6 restart prototype executes the real SIGKILL and two cold boots when explicitly requested', {
  concurrency: false,
  timeout: 6 * 60 * 1000,
  skip: process.env.BIOF3_RUN_P6_REAL_RESTART !== '1',
}, async () => {
  const result = await captureP6RealRestartPrototype();
  assert.equal(result.passed, true, JSON.stringify(result.checks));
  assert.equal(result.qualificationEligible, false);
  assert.equal(result.providerUsed, false);
  assert.equal(result.packagedAppUsed, false);
});

test('P6 user-stop prototype exercises the real cancel route when explicitly requested', {
  concurrency: false,
  timeout: 6 * 60 * 1000,
  skip: process.env.BIOF3_RUN_P6_REAL_STOP !== '1',
}, async () => {
  const result = await captureP6RealStopPrototype();
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.qualificationEligible, false);
  assert.equal(result.providerUsed, false);
  assert.equal(result.packagedAppUsed, false);
});

test('P6 failure prototype exercises a real R failure and a real validator block when explicitly requested', {
  concurrency: false,
  timeout: 6 * 60 * 1000,
  skip: process.env.BIOF3_RUN_P6_REAL_FAILURE !== '1',
}, async () => {
  const result = await captureP6RealFailurePrototype();
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.qualificationEligible, false);
  assert.equal(result.providerUsed, false);
  assert.equal(result.packagedAppUsed, false);
});

test('P6 drift prototype exercises real Artifact/ref/script/plugin/selection boundaries when explicitly requested', {
  concurrency: false,
  timeout: 8 * 60 * 1000,
  skip: process.env.BIOF3_RUN_P6_REAL_DRIFT !== '1',
}, async () => {
  const result = await captureP6RealDriftPrototype();
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.qualificationEligible, false);
  assert.equal(result.providerUsed, false);
  assert.equal(result.packagedAppUsed, false);
});
