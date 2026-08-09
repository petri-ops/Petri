import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  P6_RECOVERY_ELECTRON_CLASSIFICATION,
  P6_RECOVERY_ELECTRON_BUDGETS,
  P6_RECOVERY_ELECTRON_SOURCE_FILES,
  assertP6RecoveryElectronEvidenceWritable,
  assertSanitizedP6RecoveryElectronEvidence,
  buildP6RecoveryElectronVerdict,
  classifyP6ActiveElectronAttempt,
  createP6RecoveryResourceGate,
  getP6RecoveryElectronSourceBinding,
  observeP6RecoveryElectron,
  runP6ActiveElectronLaunchWithRetry,
  terminateP6ActiveElectronProcessGroup,
} from '../scripts/g0-rs-p6-recovery-electron-prototype.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function secureWindow() {
  return {
    contextIsolation: true,
    nodeIntegrationDisabled: true,
    sandbox: true,
    popupDenied: true,
  };
}

function cleanProjection() {
  return { absolutePath: false, providerMaterial: false, rawInternalId: false };
}

function readyBackendStatus() {
  return { checkCount: 1, everyCheckReady: true, maxDurationMs: 25 };
}

function passingObservation(overrides = {}) {
  const base = {
    classification: P6_RECOVERY_ELECTRON_CLASSIFICATION,
    qualificationEligible: false,
    p6CloseoutEligible: false,
    boundary: {
      providerEvidence: 'not_exercised',
      packagedAppEvidence: 'not_exercised',
      qualificationEligible: false,
      checkpointInterruptionPlatform: 'darwin',
      checkpointInterruptionSignal: 'posix_sigstop_process_group',
    },
    truth: {
      noSeedProductLedger: true,
      baselineJobCompleted: true,
      baselineArtifactTruthValid: true,
      baselineRevisionCount: 3,
    },
    interruption: {
      checkpointStage: 'candidate_committed',
      checkpointIntegrityExact: true,
      candidateRefExact: true,
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
    },
    firstColdStatus: {
      status: 'recovery_available',
      interruptedCount: 1,
      activeOperationCount: 0,
      pendingIssueCount: 0,
    },
    renderer: {
      activeCrash: {
        browserWindowSecurity: secureWindow(),
        before: {
          lifecycleState: 'ready',
          activeOperationExplained: true,
          activeStageExplained: true,
          recoveryControlAbsent: true,
          publicProjectionAudit: cleanProjection(),
        },
        recoveryRequestCount: 0,
        recoveryRequestStatuses: [],
        publicProjectionClean: true,
        renderProcessGoneCount: 0,
        backendStatus: readyBackendStatus(),
        launchAttemptCount: 1,
        preObservationLaunchFailures: [],
        passed: true,
      },
      recover: {
        browserWindowSecurity: secureWindow(),
        before: {
          detectedInterruptedSite: true,
          stoppingStageExplained: true,
          preservedCandidateCountExplained: true,
          automaticHandlingExplained: true,
          nextActionExplained: true,
          recoveryControlEnabled: true,
          publicProjectionAudit: cleanProjection(),
        },
        after: {
          lifecycleState: 'ready',
          recoveryControlAbsent: true,
          publicProjectionAudit: cleanProjection(),
        },
        recoveryRequestCount: 1,
        recoveryRequestStatuses: [200],
        publicProjectionClean: true,
        renderProcessGoneCount: 0,
        backendStatus: readyBackendStatus(),
      },
      reopen: {
        browserWindowSecurity: secureWindow(),
        before: {
          lifecycleState: 'ready',
          publicProjectionAudit: cleanProjection(),
        },
        after: {
          lifecycleState: 'ready',
          recoveryControlAbsent: true,
          publicProjectionAudit: cleanProjection(),
        },
        recoveryRequestCount: 0,
        recoveryRequestStatuses: [],
        publicProjectionClean: true,
        renderProcessGoneCount: 0,
        backendStatus: readyBackendStatus(),
      },
    },
    recoveredTruth: {
      changeSetStatus: 'validation_failed',
      checkpointStatus: 'validation_failed',
      candidateRevisionCount: 0,
      interruptedJobTerminal: true,
      baselineDigestStable: true,
      baselineArtifactsExact: true,
      baselineCurrentCountExact: true,
    },
    afterRecoveryStatus: {
      status: 'ready',
      interruptedCount: 0,
      activeOperationCount: 0,
      pendingIssueCount: 0,
    },
    performance: {
      restartRestoreMs: 2_500,
      budgets: P6_RECOVERY_ELECTRON_BUDGETS,
    },
    processBoundaries: {
      electronActuallySigkilled: true,
      electronRelaunchedAfterCrash: true,
      electronProcessRelaunched: true,
      backendColdBootCount: 2,
      sqliteFileIdentityStable: true,
    },
    secondColdStatus: { status: 'ready', interruptedCount: 0 },
    sourceBindingStableDuringObservation: true,
  };
  return { ...base, ...overrides };
}

test('classification remains development local and excludes Provider, packaged and qualification claims', () => {
  assert.match(P6_RECOVERY_ELECTRON_CLASSIFICATION, /^development_local_electron_/);
  assert.match(P6_RECOVERY_ELECTRON_CLASSIFICATION, /non_provider/);
  assert.match(P6_RECOVERY_ELECTRON_CLASSIFICATION, /non_packaged/);
  assert.match(P6_RECOVERY_ELECTRON_CLASSIFICATION, /non_qualifying/);
});

test('source binding covers the real kill path, lifecycle UI and both new driver surfaces', () => {
  for (const required of [
    'scripts/g0-rs-p6-recovery-electron-prototype.mjs',
    'scripts/g0-rs-p6-recovery-electron-driver.cjs',
    'test/g0-rs-p6-recovery-electron-prototype.test.mjs',
    'scripts/g0-rs-p6-real-restart-prototype.mjs',
    'core/shared-backend/result-studio-lifecycle.js',
    'frontend/src/components/result-studio/ResultStudioChangeSetPanel.tsx',
    'src/backend-health.js',
    'src/preload.js',
  ]) {
    assert.equal(P6_RECOVERY_ELECTRON_SOURCE_FILES[required], required);
  }
  const binding = getP6RecoveryElectronSourceBinding();
  assert.match(binding.sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(binding.bindingDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(binding.sourceHashes).sort(),
    Object.keys(P6_RECOVERY_ELECTRON_SOURCE_FILES).sort());
  assert.ok(Object.values(binding.sourceHashes).every((digest) => /^[a-f0-9]{64}$/.test(digest)));
});

test('sanitizer rejects filesystem coordinates, URIs, internal IDs and secret-shaped keys', () => {
  assert.equal(assertSanitizedP6RecoveryElectronEvidence({ status: 'ready', checks: ['P6RE-01'] }), true);
  assert.throws(() => assertSanitizedP6RecoveryElectronEvidence({ value: '/Users/example/private' }),
    /absolute path leaked/);
  assert.throws(() => assertSanitizedP6RecoveryElectronEvidence({ value: 'http://127.0.0.1:43111' }),
    /URI leaked/);
  assert.throws(() => assertSanitizedP6RecoveryElectronEvidence({ value: 'change cs_private123' }),
    /internal id leaked/);
  assert.throws(() => assertSanitizedP6RecoveryElectronEvidence({ accessToken: 'hidden' }),
    /unsafe evidence key/);
});

test('verdict requires the complete real interruption, UI recovery and process-relaunch chain', () => {
  const verdict = buildP6RecoveryElectronVerdict(passingObservation());
  assert.equal(verdict.passed, true);
  assert.equal(verdict.checks.length, 15);
  assert.ok(verdict.checks.every((entry) => entry.passed));
  assert.deepEqual(verdict.remainingBoundaries, [
    'real_provider_not_exercised_p7_exclusion',
    'packaged_app_not_exercised_p7_exclusion',
    'development_trace_not_qualification_evidence',
  ]);
});

test('verdict fails closed when an explanation, recovery request or relaunch truth is missing', () => {
  const missingExplanation = passingObservation();
  missingExplanation.renderer.recover.before.nextActionExplained = false;
  assert.equal(buildP6RecoveryElectronVerdict(missingExplanation).passed, false);

  const missingRequest = passingObservation();
  missingRequest.renderer.recover.recoveryRequestCount = 0;
  assert.equal(buildP6RecoveryElectronVerdict(missingRequest).passed, false);

  const sameElectron = passingObservation();
  sameElectron.processBoundaries.electronProcessRelaunched = false;
  assert.equal(buildP6RecoveryElectronVerdict(sameElectron).passed, false);

  const noActualCrash = passingObservation();
  noActualCrash.processBoundaries.electronActuallySigkilled = false;
  assert.equal(buildP6RecoveryElectronVerdict(noActualCrash).passed, false);

  const noCheckpointHold = passingObservation();
  noCheckpointHold.interruption.workerCheckpointHoldConfirmed = false;
  assert.equal(buildP6RecoveryElectronVerdict(noCheckpointHold).passed, false);

  const noCandidateChild = passingObservation();
  noCandidateChild.interruption.candidateChildPresentBeforeKill = false;
  assert.equal(buildP6RecoveryElectronVerdict(noCandidateChild).passed, false);

  const untrustedCandidateRuntime = passingObservation();
  untrustedCandidateRuntime.interruption.candidateRuntimeCommandTrustedBeforeKill = false;
  assert.equal(buildP6RecoveryElectronVerdict(untrustedCandidateRuntime).passed, false);

  const spoofedCandidateRuntime = passingObservation();
  spoofedCandidateRuntime.interruption.candidateRuntimeExecutableIdentityExactBeforeKill = false;
  assert.equal(buildP6RecoveryElectronVerdict(spoofedCandidateRuntime).passed, false);

  const survivingProcessGroup = passingObservation();
  survivingProcessGroup.interruption.processGroupGoneAfterKill = false;
  assert.equal(buildP6RecoveryElectronVerdict(survivingProcessGroup).passed, false);

  const recoveryTooSlow = passingObservation();
  recoveryTooSlow.performance.restartRestoreMs = P6_RECOVERY_ELECTRON_BUDGETS.restartRestoreMs + 1;
  assert.equal(buildP6RecoveryElectronVerdict(recoveryTooSlow).passed, false);

  const recoveryLoop = passingObservation();
  recoveryLoop.renderer.reopen.recoveryRequestCount = 1;
  assert.equal(buildP6RecoveryElectronVerdict(recoveryLoop).passed, false);

  const missingBackendHealth = passingObservation();
  missingBackendHealth.renderer.recover.backendStatus = {
    checkCount: 0,
    everyCheckReady: false,
    maxDurationMs: null,
  };
  assert.equal(buildP6RecoveryElectronVerdict(missingBackendHealth).passed, false);

  const missingLaunchAudit = passingObservation();
  delete missingLaunchAudit.renderer.activeCrash.launchAttemptCount;
  assert.equal(buildP6RecoveryElectronVerdict(missingLaunchAudit).passed, false);

  const forgedRetryAudit = passingObservation();
  forgedRetryAudit.renderer.activeCrash.launchAttemptCount = 2;
  forgedRetryAudit.renderer.activeCrash.preObservationLaunchFailures = [{
    attempt: 1,
    kind: 'persisted_semantic_failure',
    exitCode: 1,
    exitSignal: null,
    stderrDigest: 'a'.repeat(64),
    stderrBytes: 10,
  }];
  assert.equal(buildP6RecoveryElectronVerdict(forgedRetryAudit).passed, false);
});

test('active Electron classifier retries only a missing-result child exit or spawn error', () => {
  assert.deepEqual(classifyP6ActiveElectronAttempt({
    resultExists: false,
    terminalKind: 'exit',
  }), {
    kind: 'child_exit_before_observation',
    retryEligible: true,
  });
  assert.deepEqual(classifyP6ActiveElectronAttempt({
    resultExists: false,
    terminalKind: 'spawn_error',
  }), {
    kind: 'spawn_error_before_observation',
    retryEligible: true,
  });
  for (const classified of [
    classifyP6ActiveElectronAttempt({
      resultExists: true,
      result: { passed: false, failedStage: 'load_project' },
      terminalKind: 'exit',
    }),
    classifyP6ActiveElectronAttempt({
      resultExists: true,
      result: { passed: false },
      terminalKind: 'exit',
    }),
    classifyP6ActiveElectronAttempt({
      resultExists: true,
      resultParseError: 'invalid_json',
      terminalKind: 'exit',
    }),
    classifyP6ActiveElectronAttempt({ resultExists: false, timedOut: true }),
    classifyP6ActiveElectronAttempt({ resultExists: false }),
  ]) {
    assert.equal(classified.retryEligible, false);
  }
});

function retryableLaunchError(attempt, kind = 'child_exit_before_observation') {
  const error = new Error(`p6_recovery_active_electron_${kind}`);
  error.code = error.message;
  error.retryEligible = true;
  error.detail = { exitCode: 1, exitSignal: null };
  error.preObservationLaunchFailure = {
    attempt,
    kind,
    exitCode: 1,
    exitSignal: null,
    stderrDigest: String(attempt).repeat(64),
    stderrBytes: 32,
  };
  return error;
}

test('active Electron launch retries once in a fresh scope and records bounded failure audit', async () => {
  const created = [];
  const launched = [];
  const result = await runP6ActiveElectronLaunchWithRetry({
    createAttempt: async (attempt) => {
      const scope = path.join(ROOT, '.p6-recovery-test', `attempt-${attempt}`);
      created.push(scope);
      return {
        configPath: path.join(scope, 'driver-config.json'),
        resultPath: path.join(scope, 'driver-result.json'),
      };
    },
    launchAttempt: async ({ attempt, configPath }) => {
      launched.push({ attempt, configPath });
      if (attempt === 1) throw retryableLaunchError(attempt);
      return { pid: 42, exitSignal: 'SIGKILL', result: { phase: 'active-crash', passed: true } };
    },
  });
  assert.equal(created.length, 2);
  assert.notEqual(path.dirname(launched[0].configPath), path.dirname(launched[1].configPath));
  assert.equal(result.result.launchAttemptCount, 2);
  assert.deepEqual(result.result.preObservationLaunchFailures, [{
    attempt: 1,
    kind: 'child_exit_before_observation',
    exitCode: 1,
    exitSignal: null,
    stderrDigest: '1'.repeat(64),
    stderrBytes: 32,
  }]);
});

test('active Electron launch never retries a persisted or timeout failure and caps early exits at two', async () => {
  for (const code of [
    'p6_recovery_active_electron_persisted_driver_failure',
    'p6_recovery_active_electron_persisted_semantic_failure',
    'p6_recovery_active_electron_live_child_timeout',
  ]) {
    let calls = 0;
    await assert.rejects(runP6ActiveElectronLaunchWithRetry({
      createAttempt: async (attempt) => ({
        configPath: path.join(ROOT, '.p6-recovery-test', code, `attempt-${attempt}`, 'config.json'),
        resultPath: path.join(ROOT, '.p6-recovery-test', code, `attempt-${attempt}`, 'result.json'),
      }),
      launchAttempt: async () => {
        calls += 1;
        const error = new Error(code);
        error.code = code;
        error.retryEligible = false;
        error.detail = { phaseResult: { passed: false } };
        throw error;
      },
    }), (error) => error.code === code && error.detail.launchAttemptCount === 1);
    assert.equal(calls, 1);
  }

  let forgedRetryCalls = 0;
  await assert.rejects(runP6ActiveElectronLaunchWithRetry({
    createAttempt: async (attempt) => ({
      configPath: path.join(ROOT, '.p6-recovery-test', 'forged', `attempt-${attempt}`, 'config.json'),
      resultPath: path.join(ROOT, '.p6-recovery-test', 'forged', `attempt-${attempt}`, 'result.json'),
    }),
    launchAttempt: async ({ attempt }) => {
      forgedRetryCalls += 1;
      throw retryableLaunchError(attempt, 'persisted_semantic_failure');
    },
  }));
  assert.equal(forgedRetryCalls, 1);

  let earlyExitCalls = 0;
  await assert.rejects(runP6ActiveElectronLaunchWithRetry({
    createAttempt: async (attempt) => ({
      configPath: path.join(ROOT, '.p6-recovery-test', 'bounded', `attempt-${attempt}`, 'config.json'),
      resultPath: path.join(ROOT, '.p6-recovery-test', 'bounded', `attempt-${attempt}`, 'result.json'),
    }),
    launchAttempt: async ({ attempt }) => {
      earlyExitCalls += 1;
      throw retryableLaunchError(attempt);
    },
  }), (error) => error.detail.launchAttemptCount === 2
    && error.detail.preObservationLaunchFailures.length === 2);
  assert.equal(earlyExitCalls, 2);
});

test('active Electron POSIX cleanup targets the detached process group and confirms TERM to KILL', async () => {
  let alive = true;
  const signals = [];
  const signalProcess = (target, signal) => {
    signals.push([target, signal]);
    if (signal === 0) {
      if (alive) return true;
      const error = new Error('gone');
      error.code = 'ESRCH';
      throw error;
    }
    if (signal === 'SIGKILL') alive = false;
    return true;
  };
  const result = await terminateP6ActiveElectronProcessGroup({
    pid: 4242,
    exitCode: null,
    signalCode: null,
  }, {
    platform: 'darwin',
    signalProcess,
    sleepFn: async () => {},
    termGraceMs: 1,
    killConfirmMs: 2,
  });
  assert.equal(result.terminated, true);
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(result.escalated, true);
  assert.ok(signals.some(([target, signal]) => target === -4242 && signal === 'SIGTERM'));
  assert.ok(signals.some(([target, signal]) => target === -4242 && signal === 'SIGKILL'));
  assert.ok(signals.every(([target]) => target === -4242));
});

test('active Electron Windows cleanup uses taskkill tree then force and fails closed after root exit', async () => {
  const child = { pid: 5252, exitCode: null, signalCode: null };
  const commands = [];
  const result = await terminateP6ActiveElectronProcessGroup(child, {
    platform: 'win32',
    taskkill: async (args) => {
      commands.push(args);
      if (args.includes('/f')) child.exitCode = 1;
      return { ok: true, code: 0, errorCode: null };
    },
    sleepFn: async () => {},
    termGraceMs: 1,
    killConfirmMs: 2,
  });
  assert.equal(result.terminated, true);
  assert.equal(result.signal, 'SIGKILL');
  assert.deepEqual(commands, [
    ['/pid', '5252', '/t'],
    ['/pid', '5252', '/t', '/f'],
  ]);

  const unaddressable = await terminateP6ActiveElectronProcessGroup({
    pid: 6262,
    exitCode: 0,
    signalCode: null,
  }, { platform: 'win32' });
  assert.equal(unaddressable.terminated, false);
  assert.equal(unaddressable.reason, 'active_electron_root_exited_before_tree_termination');
});

test('future evidence guard requires a current source binding and recomputed passing checks', () => {
  const observation = passingObservation();
  const verdict = buildP6RecoveryElectronVerdict(observation);
  const evidence = {
    ...observation,
    schemaVersion: 1,
    sourceCommit: 'a'.repeat(40),
    sourceFiles: { prototype: 'scripts/g0-rs-p6-recovery-electron-prototype.mjs' },
    sourceHashes: { prototype: 'b'.repeat(64) },
    sourceCommitMatchesSourceHashes: true,
    checks: verdict.checks,
    passed: verdict.passed,
  };
  assert.equal(assertP6RecoveryElectronEvidenceWritable(evidence), true);
  assert.throws(() => assertP6RecoveryElectronEvidenceWritable({
    ...evidence,
    sourceCommitMatchesSourceHashes: false,
  }), /p6_recovery_electron_source_binding_not_current/);
  assert.throws(() => assertP6RecoveryElectronEvidenceWritable({
    ...evidence,
    qualificationEligible: true,
  }), /p6_recovery_electron_classification_invalid/);
});

test('driver creates a hardened BrowserWindow and clicks only the public recovery command', () => {
  const source = readFileSync(
    path.join(ROOT, 'scripts/g0-rs-p6-recovery-electron-driver.cjs'),
    'utf8',
  );
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /sandbox:\s*true/);
  assert.match(source, /BIOF3_P6_RECOVERY_ELECTRON_ATTEMPT/);
  assert.match(source, /electron-user-data-attempt-/);
  assert.match(source, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(source, /ipcMain\.handle\('backend:status', async \(\) => \{/);
  assert.match(source, /new URL\('\/api\/health', config\.backendBaseUrl\)/);
  assert.match(source, /probeUrl\(healthUrl, BACKEND_STATUS_TIMEOUT_MS\)/);
  assert.doesNotMatch(source, /isReady:\s*true/);
  assert.match(source, /backendStatus\.everyCheckReady === true/);
  assert.match(source, /ipcMain\.handle\('ai-settings:get', async \(\) => \{/);
  assert.match(source, /return \{\};/);
  assert.match(source, /terminal_not_exercised_by_recovery_trace/);
  assert.doesNotMatch(source, /terminal:session-start/);
  assert.match(source, /恢复修改现场/);
  assert.match(source, /停止于保存候选脚本/);
  assert.match(source, /下一步：恢复后检查候选，或重新发起修改。/);
});

test('prototype crashes the active Electron before killing the edit worker', () => {
  const source = readFileSync(
    path.join(ROOT, 'scripts/g0-rs-p6-recovery-electron-prototype.mjs'),
    'utf8',
  );
  const durable = source.indexOf('await waitForDurableCandidateCheckpoint(runtime, worker)');
  const electronCrash = source.indexOf('await crashActiveElectron(');
  const workerCrash = source.indexOf('await killWorkerWithSigkill(worker)', electronCrash);
  assert.ok(durable >= 0 && electronCrash > durable && workerCrash > electronCrash);
  assert.match(source, /workerCheckpointHoldConfirmed: durable\.hold\.confirmed === true/);
  assert.match(source, /processGroupAliveBeforeKill: durable\.hold\.groupAddressable === true/);
  assert.match(source, /candidateChildPresentBeforeKill: durable\.hold\.childProcessPresent === true/);
  assert.match(source, /let cleanupPromise = null/);
  assert.match(source, /const resourceGate = createP6RecoveryResourceGate/);
  assert.match(source, /if \(resourceGate\.pendingPromise\) \{/);
  assert.match(source, /await resourceGate\.pendingPromise/);
  assert.equal((source.match(/resourceGate\.acquire\(\n\s+\(\) => startServer/g) || []).length, 2);
  assert.match(source, /const onSigint = \(\) => onSignal\('SIGINT'\)/);
  assert.match(source, /const onSigterm = \(\) => onSignal\('SIGTERM'\)/);
  assert.match(source, /if \(cleanupPromise\) return cleanupPromise/);
  assert.match(source, /await terminateWorkerForCleanup\(worker\)/);
  assert.match(source, /termination\.terminated === true/);
});

test('resource gate blocks later cold-server creation and exposes in-flight resources to cleanup', async () => {
  let interruptionSignal = 'SIGINT';
  let factoryCalls = 0;
  const gate = createP6RecoveryResourceGate(() => interruptionSignal);
  await assert.rejects(
    gate.acquire(() => {
      factoryCalls += 1;
      return Promise.resolve({ child: true });
    }, () => {}),
    /p6_recovery_interrupted/,
  );
  assert.equal(factoryCalls, 0);
  assert.equal(gate.pendingPromise, null);

  interruptionSignal = null;
  let resolveCreation;
  const creation = new Promise((resolve) => { resolveCreation = resolve; });
  let assigned = null;
  const acquired = gate.acquire(() => creation, (resource) => { assigned = resource; });
  assert.equal(gate.pendingPromise instanceof Promise, true);
  resolveCreation({ id: 'cold-server' });
  await acquired;
  assert.deepEqual(assigned, { id: 'cold-server' });
  assert.equal(gate.pendingPromise, null);
});

test('real no-seed worker and active Electron SIGKILL recovery trace is opt-in', {
  skip: process.env.BIOF3_RUN_P6_RECOVERY_ELECTRON !== '1',
  timeout: 20 * 60 * 1000,
}, async () => {
  const result = await observeP6RecoveryElectron();
  assert.equal(result.passed, true);
  assert.equal(result.qualificationEligible, false);
  assert.equal(result.p6CloseoutEligible, false);
  assert.equal(result.sourceBindingStableDuringObservation, true);
  assert.equal(result.renderer.activeCrash.before.activeOperationExplained, true);
  assert.equal(result.processBoundaries.electronActuallySigkilled, true);
  assert.equal(result.renderer.recover.recoveryRequestCount, 1);
  assert.equal(result.renderer.reopen.recoveryRequestCount, 0);
  assert.equal(result.recoveredTruth.changeSetStatus, 'validation_failed');
  assert.equal(result.secondColdStatus.status, 'ready');
});
