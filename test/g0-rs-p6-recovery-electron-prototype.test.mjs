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
  getP6RecoveryElectronSourceBinding,
  observeP6RecoveryElectron,
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
      workerExitSignal: 'SIGKILL',
      workerCompletionMarkerSeen: false,
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
