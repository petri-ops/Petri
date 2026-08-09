import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
  inspectP6StoppedWorkerProcessGroupOutput,
  parseP6DarwinLsofExecutablePathOutput,
  parseP5WorkerCheckpointHold,
} from '../scripts/g0-rs-p6-real-restart-prototype.mjs';
import { inspectP5AcceptanceRuntimeProcessOutput } from '../scripts/g0-rs-p5-acceptance.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('P6 restart prototype uses the existing real P5 worker entrypoint', () => {
  assert.equal(existsSync(path.join(ROOT, 'scripts/g0-rs-p5-acceptance.mjs')), true);
});

test('P6 worker checkpoint hold is an explicit synchronous process-group handshake', () => {
  const workerSource = readFileSync(path.join(ROOT, 'scripts/g0-rs-p5-acceptance.mjs'), 'utf8');
  const holdInstalled = workerSource.indexOf('installP6AcceptanceCheckpointHold(spec, db)');
  const createAwaited = workerSource.indexOf('created = await tools.create(', holdInstalled);
  assert.ok(holdInstalled >= 0 && createAwaited > holdInstalled);
  assert.match(workerSource, /candidateJobs = sqlite\.prepare\(`/);
  assert.match(workerSource, /status='running'/);
  assert.match(workerSource, /candidateJobExact = candidateJob\.tool_id === hold\.expectedToolId/);
  assert.match(workerSource, /writeSync\(1, `\$\{P5_WORKER_CHECKPOINT_HOLD_MARKER\}/);
  assert.match(workerSource, /process\.kill\(-process\.pid, 'SIGSTOP'\)/);
  const runtimeStop = workerSource.indexOf("process.kill(runtimeProcess.pid, 'SIGSTOP')");
  const holdMarker = workerSource.indexOf('writeSync(1, `${P5_WORKER_CHECKPOINT_HOLD_MARKER}');
  const groupStop = workerSource.indexOf("process.kill(-process.pid, 'SIGSTOP')");
  assert.ok(runtimeStop >= 0 && holdMarker > runtimeStop && groupStop > holdMarker);
  const restartSource = readFileSync(
    path.join(ROOT, 'scripts/g0-rs-p6-real-restart-prototype.mjs'),
    'utf8',
  );
  assert.match(restartSource, /p6_restart_candidate_checkpoint_timeout/);
  assert.match(restartSource, /lastHandshakeSeen/);
  assert.match(restartSource, /lastProcessGroup/);
  assert.match(restartSource, /p6_restart_candidate_runtime_not_live_at_hold/);
  assert.match(restartSource, /directZombieChildPresent/);

  const marker = '__P5_WORKER_CHECKPOINT_HOLD__';
  const payload = {
    version: 1,
    mode: 'sigstop_process_group',
    checkpointStage: 'candidate_committed',
    changeSetId: 'changeset-test',
    checkpointId: 'checkpoint-test',
    candidateJobId: 'job-test',
    candidateJobExact: true,
    candidateInputExact: true,
    candidateRuntimePausedBeforeCheckpoint: true,
  };
  assert.deepEqual(parseP5WorkerCheckpointHold(`prefix\n${marker}${JSON.stringify(payload)}\n`), payload);
  assert.equal(parseP5WorkerCheckpointHold(`${marker}{"version":2}\n`), null);
  assert.equal(parseP5WorkerCheckpointHold(`${marker}${JSON.stringify(payload)}`), null);
});

test('P6 acceptance hook pauses only the exact direct candidate R runtime', () => {
  const workspaceRoot = '/tmp/p6-worker-project';
  const expected = inspectP5AcceptanceRuntimeProcessOutput([
    '4101 4100 4100 S /opt/R/bin/Rscript /tmp/p6-worker-project/results/jobs/tj_candidate/run-script.R /tmp/p6-worker-project/results/jobs/tj_candidate',
  ].join('\n'), {
    workerPid: 4100,
    trustedRuntimePaths: ['/opt/R/bin/Rscript'],
    expectedRunScriptPaths: [`${workspaceRoot}/results/jobs/tj_candidate/run-script.R`],
    expectedJobDirPaths: [`${workspaceRoot}/results/jobs/tj_candidate`],
  });
  assert.equal(expected?.pid, 4101);
  const execR = inspectP5AcceptanceRuntimeProcessOutput([
    `4101 4100 4100 S /opt/R/bin/exec/R --no-echo --no-restore --file=${workspaceRoot}/results/jobs/tj_candidate/run-script.R --args ${workspaceRoot}/results/jobs/tj_candidate`,
  ].join('\n'), {
    workerPid: 4100,
    trustedRuntimePaths: ['/opt/R/bin/Rscript'],
    trustedRuntimeExecCommandPaths: ['/opt/R/bin/exec/R'],
    expectedRunScriptPaths: [`${workspaceRoot}/results/jobs/tj_candidate/run-script.R`],
    expectedJobDirPaths: [`${workspaceRoot}/results/jobs/tj_candidate`],
  });
  assert.equal(execR?.pid, 4101);
  assert.equal(inspectP5AcceptanceRuntimeProcessOutput(
    '4101 9999 4100 S /opt/R/bin/Rscript /tmp/unrelated.R /tmp/unrelated',
    {
      workerPid: 4100,
      trustedRuntimePaths: ['/opt/R/bin/Rscript'],
      expectedRunScriptPaths: [`${workspaceRoot}/results/jobs/tj_candidate/run-script.R`],
      expectedJobDirPaths: [`${workspaceRoot}/results/jobs/tj_candidate`],
    },
  ), null);
});

test('P6 worker hold accepts only the exact stopped R runtime child', () => {
  const workspaceRoot = '/tmp/p6-worker-project';
  const expected = inspectP6StoppedWorkerProcessGroupOutput([
    '4100 4000 4100 T node scripts/g0-rs-p5-acceptance.mjs --worker payload',
    `4101 4100 4100 T /opt/R/bin/Rscript ${workspaceRoot}/results/jobs/tj_candidate/run-script.R ${workspaceRoot}/results/jobs/tj_candidate`,
  ].join('\n'), {
    workerPid: 4100,
    candidateJobId: 'tj_candidate',
    workspaceRoot,
    trustedRuntimePaths: ['/opt/R/bin/Rscript'],
    runtimeExecutablePathsByPid: { 4101: '/opt/R/bin/Rscript' },
  });
  assert.equal(expected.workerProcessStopped, true);
  assert.equal(expected.processGroupAllStopped, true);
  assert.equal(expected.candidateRuntimeProcessObserved, true);
  assert.equal(expected.candidateRuntimeDirectChild, true);
  assert.equal(expected.candidateRuntimeCommandTrusted, true);
  assert.equal(expected.candidateRuntimeExecutableIdentityExact, true);

  const frameworkExecRuntime = inspectP6StoppedWorkerProcessGroupOutput([
    '4100 4000 4100 T node scripts/g0-rs-p5-acceptance.mjs --worker payload',
    `4101 4100 4100 T /opt/R/bin/Rscript ${workspaceRoot}/results/jobs/tj_candidate/run-script.R ${workspaceRoot}/results/jobs/tj_candidate`,
  ].join('\n'), {
    workerPid: 4100,
    candidateJobId: 'tj_candidate',
    workspaceRoot,
    trustedRuntimePaths: ['/opt/R/bin/Rscript'],
    trustedRuntimeExecutablePaths: ['/opt/R/bin/Rscript', '/opt/R/bin/exec/R'],
    runtimeExecutablePathsByPid: { 4101: '/opt/R/bin/exec/R' },
  });
  assert.equal(frameworkExecRuntime.candidateRuntimeExecutableIdentityExact, true);

  const frameworkExecCommand = inspectP6StoppedWorkerProcessGroupOutput([
    '4100 4000 4100 T node scripts/g0-rs-p5-acceptance.mjs --worker payload',
    `4101 4100 4100 T /opt/R/bin/exec/R --no-echo --no-restore --file=${workspaceRoot}/results/jobs/tj_candidate/run-script.R --args ${workspaceRoot}/results/jobs/tj_candidate`,
  ].join('\n'), {
    workerPid: 4100,
    candidateJobId: 'tj_candidate',
    workspaceRoot,
    trustedRuntimePaths: ['/opt/R/bin/Rscript'],
    trustedRuntimeExecCommandPaths: ['/opt/R/bin/exec/R'],
    trustedRuntimeExecutablePaths: ['/opt/R/bin/Rscript', '/opt/R/bin/exec/R'],
    runtimeExecutablePathsByPid: { 4101: '/opt/R/bin/exec/R' },
  });
  assert.equal(frameworkExecCommand.candidateRuntimeCommandTrusted, true);

  const wrongHelper = inspectP6StoppedWorkerProcessGroupOutput([
    '4100 4000 4100 T node scripts/g0-rs-p5-acceptance.mjs --worker payload',
    '4101 4100 4100 T /bin/sh helper.sh',
  ].join('\n'), {
    workerPid: 4100,
    candidateJobId: 'tj_candidate',
    workspaceRoot,
    trustedRuntimePaths: ['/opt/R/bin/Rscript'],
    runtimeExecutablePathsByPid: { 4101: '/bin/sh' },
  });
  assert.equal(wrongHelper.childProcessPresent, true);
  assert.equal(wrongHelper.candidateRuntimeProcessObserved, false);

  const impersonatedRuntime = inspectP6StoppedWorkerProcessGroupOutput([
    '4100 4000 4100 T node scripts/g0-rs-p5-acceptance.mjs --worker payload',
    `4101 4100 4100 T /tmp/Rscript /tmp/unrelated.R --note ${workspaceRoot}/results/jobs/tj_candidate/run-script.R`,
  ].join('\n'), {
    workerPid: 4100,
    candidateJobId: 'tj_candidate',
    workspaceRoot,
    trustedRuntimePaths: ['/opt/R/bin/Rscript'],
    runtimeExecutablePathsByPid: { 4101: '/usr/bin/yes' },
  });
  assert.equal(impersonatedRuntime.candidateRuntimeCommandTrusted, false);
  assert.equal(impersonatedRuntime.candidateRuntimeExecutableIdentityExact, false);

  const spoofedArgv0 = inspectP6StoppedWorkerProcessGroupOutput([
    '4100 4000 4100 T node scripts/g0-rs-p5-acceptance.mjs --worker payload',
    `4101 4100 4100 T /opt/R/bin/Rscript ${workspaceRoot}/results/jobs/tj_candidate/run-script.R ${workspaceRoot}/results/jobs/tj_candidate`,
  ].join('\n'), {
    workerPid: 4100,
    candidateJobId: 'tj_candidate',
    workspaceRoot,
    trustedRuntimePaths: ['/opt/R/bin/Rscript'],
    runtimeExecutablePathsByPid: { 4101: '/usr/bin/yes' },
  });
  assert.equal(spoofedArgv0.candidateRuntimeCommandTrusted, false);
  assert.equal(spoofedArgv0.candidateRuntimeExecutableIdentityExact, false);

  const exitedRuntime = inspectP6StoppedWorkerProcessGroupOutput([
    '4100 4000 4100 T node scripts/g0-rs-p5-acceptance.mjs --worker payload',
    `4101 4100 4100 Z /opt/R/bin/Rscript ${workspaceRoot}/results/jobs/tj_candidate/run-script.R ${workspaceRoot}/results/jobs/tj_candidate`,
  ].join('\n'), {
    workerPid: 4100,
    candidateJobId: 'tj_candidate',
    workspaceRoot,
    trustedRuntimePaths: ['/opt/R/bin/Rscript'],
    runtimeExecutablePathsByPid: { 4101: '/opt/R/bin/Rscript' },
  });
  assert.equal(exitedRuntime.directZombieChildPresent, true);
  assert.equal(exitedRuntime.candidateRuntimeProcessObserved, false);

  const misplacedRunScript = inspectP6StoppedWorkerProcessGroupOutput([
    '4100 4000 4100 T node scripts/g0-rs-p5-acceptance.mjs --worker payload',
    `4101 4100 4100 T /opt/R/bin/Rscript /tmp/unrelated.R ${workspaceRoot}/results/jobs/tj_candidate/run-script.R`,
  ].join('\n'), {
    workerPid: 4100,
    candidateJobId: 'tj_candidate',
    workspaceRoot,
    trustedRuntimePaths: ['/opt/R/bin/Rscript'],
    runtimeExecutablePathsByPid: { 4101: '/opt/R/bin/Rscript' },
  });
  assert.equal(misplacedRunScript.candidateRuntimeCommandTrusted, false);

  const wrongParent = inspectP6StoppedWorkerProcessGroupOutput([
    '4100 4000 4100 T node scripts/g0-rs-p5-acceptance.mjs --worker payload',
    `4101 9999 4100 T /opt/R/bin/Rscript ${workspaceRoot}/results/jobs/tj_candidate/run-script.R ${workspaceRoot}/results/jobs/tj_candidate`,
  ].join('\n'), {
    workerPid: 4100,
    candidateJobId: 'tj_candidate',
    workspaceRoot,
    trustedRuntimePaths: ['/opt/R/bin/Rscript'],
    runtimeExecutablePathsByPid: { 4101: '/opt/R/bin/Rscript' },
  });
  assert.equal(wrongParent.candidateRuntimeDirectChild, false);
});

test('P6 Darwin executable probe accepts only the first kernel text mapping for the exact pid', () => {
  const output = [
    'p4101',
    'ftxt',
    'n/opt/R/bin/Rscript',
    'ftxt',
    'n/usr/lib/dyld',
  ].join('\n');
  assert.equal(parseP6DarwinLsofExecutablePathOutput(output, 4101), '/opt/R/bin/Rscript');
  assert.equal(parseP6DarwinLsofExecutablePathOutput(output, 9999), null);
  assert.equal(parseP6DarwinLsofExecutablePathOutput('p4101\nftxt\nnrelative/Rscript\n', 4101), null);
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
    workerCheckpointHoldConfirmed: true,
    workerCheckpointHoldMode: 'sigstop_process_group',
    processGroupAliveBeforeKill: true,
    candidateChildPresentBeforeKill: true,
    candidateJobExactBeforeKill: true,
    candidateInputExactBeforeKill: true,
    candidateRuntimePausedBeforeCheckpoint: true,
    candidateRuntimeProcessObservedBeforeKill: true,
    candidateRuntimeDirectChildBeforeKill: true,
    candidateRuntimeCommandTrustedBeforeKill: true,
    candidateRuntimeExecutableIdentityExactBeforeKill: true,
    processGroupAllStoppedBeforeKill: true,
    workerExitSignal: 'SIGKILL',
    workerCompletionMarkerSeen: false,
    processGroupGoneAfterKill: true,
    candidateRuntimeProcessGoneAfterKill: true,
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
        || key === 'workerCheckpointHoldMode'
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
