import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  P6_PRODUCT_ACCEPTANCE_BOUNDARIES,
  P6_PRODUCT_ACCEPTANCE_CLASSIFICATION,
  P6_PRODUCT_ACCEPTANCE_EVIDENCE_CLASS,
  P6_PRODUCT_ACCEPTANCE_SOURCE_FILES,
  P6_PRODUCT_ACCEPTANCE_TEST_FILES,
  P6_PRODUCT_ACCEPTANCE_TEST_HOOKS,
  assertCurrentP6ProductAcceptanceSourceBinding,
  assertP6ProductAcceptanceEvidenceWritable,
  assertSanitizedP6ProductAcceptanceEvidence,
  evaluateP6ProductAcceptanceObservations,
  getP6ProductAcceptanceSourceBinding,
  projectP6ComponentObservation,
  verifyStoredP6ProductAcceptanceSourceBinding,
  verifyStoredP6ProductAcceptanceEvidence,
  writeP6ProductAcceptanceEvidence,
} from '../scripts/g0-rs-p6-product-acceptance.mjs';
import {
  P6_ELECTRON_PRESSURE_BUDGETS,
  P6_ELECTRON_PRESSURE_CLASSIFICATION,
  P6_ELECTRON_PRESSURE_ROWS,
  P6_ELECTRON_PRESSURE_SOURCE_FILES,
  P6_ELECTRON_PRESSURE_SYNTHETIC_REVISIONS,
} from '../scripts/g0-rs-p6-electron-pressure-prototype.mjs';
import {
  P6_RECOVERY_ELECTRON_BUDGETS,
  P6_RECOVERY_ELECTRON_CLASSIFICATION,
  P6_RECOVERY_ELECTRON_SOURCE_FILES,
} from '../scripts/g0-rs-p6-recovery-electron-prototype.mjs';
import {
  P6_PRODUCT_SCENARIO_CLASSIFICATION,
  P6_PRODUCT_SCENARIO_SOURCE_FILES,
} from '../scripts/g0-rs-p6-product-scenarios.mjs';
import { P5_NO_SEED_TABLES } from '../scripts/g0-rs-p5-acceptance.mjs';
import { resolveImpact } from '../scripts/test-affected.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_PATH = path.join(
  ROOT,
  'acceptance/g0-result-studio/rs-p6-durability-recovery-performance.json',
);

function workspaceReady() {
  return { status: 'ready', interruptedCount: 0, activeOperationCount: 0, pendingIssues: [] };
}

function realStop() {
  return {
    cancelHttpStatus: 200, cancelResponseStatus: 'cancelled', cancelTerminationConfirmed: true,
    cancelledJobStatus: 'cancelled', cancelledJobCompleted: true, cancelledProcessExited: true,
    cancelledResourceSamplingStatus: 'measured', cancelledResourceSampleCount: 2,
    cancelledResourcePeakStatus: 'partial_process_peak_unavailable',
    cancelledResourceProcessExitConfirmed: true,
    changeSetCountBefore: 1, changeSetCountAfter: 1,
    revisionCountBefore: 3, revisionCountAfter: 3,
    baselineDigestStable: true, baselineArtifactsExact: true, workspaceStatus: workspaceReady(),
    qualificationEligible: false, providerUsed: false, packagedAppUsed: false,
  };
}

function realFailure() {
  return {
    failedJobStatus: 'failed', failedJobCompleted: true, failedProcessExited: true,
    changeSetCountBeforeFailure: 1, changeSetCountAfterFailure: 1,
    revisionCountBeforeFailure: 3, revisionCountAfterFailure: 3,
    recoveryJobStatus: 'completed', recoveryJobArtifactTruthStatus: 'valid',
    recoveryJobArtifactsExact: true,
    validatorJobStatus: 'completed', validatorJobArtifactTruthStatus: 'valid',
    validatorJobArtifactsExact: true, validatorHttpStatus: 200,
    validatorRevisionCreated: false, validatorDiagnosticCode: 'baseline_plugin_validation_failed',
    changeSetCountBeforeValidator: 1, changeSetCountAfterValidator: 1,
    revisionCountBeforeValidator: 3, revisionCountAfterValidator: 3,
    baselineDigestStable: true, baselineArtifactsExact: true, workspaceStatus: workspaceReady(),
    qualificationEligible: false, providerUsed: false, packagedAppUsed: false,
  };
}

function realDrift() {
  return {
    dirtyGitDetected: true, dirtyMarkerHashStable: true,
    artifactDriftStatus: { status: 'blocked', revisionIntegrityIssues: ['artifact_hash_drift'] },
    artifactRecoverHttpStatus: 409, artifactRecoverAfterStatus: 'blocked',
    afterArtifactRestoreStatus: { status: 'ready' },
    refDriftStatus: { status: 'blocked', revisionIntegrityIssues: ['current_ref_drift'] },
    refRecoverHttpStatus: 409, refRecoverAfterStatus: 'blocked',
    afterRefRestoreStatus: { status: 'ready' },
    scriptHashRevisionCreated: false, scriptHashDiagnosticCode: 'background_source_script_drift',
    scriptMissingRevisionCreated: false, scriptMissingDiagnosticCode: 'source_script_missing',
    scriptDriftChangeSetCountStable: true, scriptDriftRevisionCountStable: true,
    selectionCompatibility: 'stale', contextSelectionCompatibility: 'stale',
    contextSelectionExcluded: true, oldContextHttpStatus: 409,
    oldContextErrorCode: 'context_token_stale', oldContextWriteCountsStable: true,
    coldBootStatus: { status: 'ready' }, historySourceStillExact: true,
    pluginReplayHttpStatus: 409, pluginReplayErrorCode: 'replay_plugin_version_drift',
    pluginReplayWriteCountsStable: true, currentRevisionArtifactsExact: true,
    qualificationEligible: false, providerUsed: false, packagedAppUsed: false,
  };
}

function realRestart() {
  const consistent = {
    status: 'recovery_available', checkpointIntegrity: { matches: true },
    consistency: { status: 'consistent' }, interruptedCount: 1,
    activeOperationCount: 0, pendingIssues: [],
  };
  return {
    noSeedSeededTableCount: 0, baselineJobCompleted: true,
    baselineArtifactTruthValid: true, baselineRevisionCount: 3,
    baselineResourceSamplingMeasured: true, baselineCpuPeakMeasured: true,
    baselineRssPeakMeasured: true, baselineOutputPeakMeasured: true,
    baselineSystemResourcesMeasured: true, baselineActiveJobPeakMeasured: true,
    checkpointIntegrityBeforeKill: true, checkpointStageBeforeKill: 'candidate_committed',
    candidateRefMatchedBeforeKill: true, candidateJobRunningBeforeKill: true,
    workerExitSignal: 'SIGKILL', workerCompletionMarkerSeen: false,
    sqliteFileIdentityStable: true, sqliteJournalModeBefore: 'wal', sqliteJournalModeAfter: 'wal',
    workspaceStable: true, gitBindingStable: true, firstColdStatus: consistent,
    recoveryHttpStatus: 200, recoveryRepairKinds: ['running_to_validation_failed'],
    recoveredChangeSetStatus: 'validation_failed', recoveredCheckpointStatus: 'validation_failed',
    recoveredRevisionCount: 0, baselineDigestStable: true,
    baselineArtifactsExactAfterRecovery: true,
    secondColdStatus: {
      status: 'ready', checkpointIntegrity: { matches: true },
      consistency: { status: 'consistent' }, interruptedCount: 0,
    },
    secondRecoveryRecovered: false, interruptedJobsTerminal: true,
    qualificationEligible: false, providerUsed: false, packagedAppUsed: false,
  };
}

function secureWindow() {
  return { contextIsolation: true, nodeIntegrationDisabled: true, sandbox: true, popupDenied: true };
}

function cleanProjection() {
  return { absolutePath: false, providerMaterial: false, rawInternalId: false };
}

function readyBackendStatus() {
  return { checkCount: 1, everyCheckReady: true, maxDurationMs: 25 };
}

function electronRecovery() {
  return {
    classification: P6_RECOVERY_ELECTRON_CLASSIFICATION,
    qualificationEligible: false,
    p6CloseoutEligible: false,
    boundary: {
      providerEvidence: 'not_exercised',
      packagedAppEvidence: 'not_exercised',
      qualificationEligible: false,
      systemRestartClaim: false,
      processBoundary: 'owned_electron_and_backend_processes_restarted_against_same_durable_local_stores',
    },
    truth: { noSeedProductLedger: true, baselineJobCompleted: true, baselineArtifactTruthValid: true, baselineRevisionCount: 3 },
    interruption: {
      checkpointStage: 'candidate_committed', checkpointIntegrityExact: true,
      candidateRefExact: true, workerExitSignal: 'SIGKILL', workerCompletionMarkerSeen: false,
    },
    firstColdStatus: { status: 'recovery_available', interruptedCount: 1, activeOperationCount: 0, pendingIssueCount: 0 },
    renderer: {
      activeCrash: {
        browserWindowSecurity: secureWindow(), publicProjectionClean: true,
        renderProcessGoneCount: 0, recoveryRequestCount: 0, passed: true,
        backendStatus: readyBackendStatus(),
        before: {
          lifecycleState: 'ready', activeOperationExplained: true, activeStageExplained: true,
          recoveryControlAbsent: true, publicProjectionAudit: cleanProjection(),
        },
      },
      recover: {
        browserWindowSecurity: secureWindow(), publicProjectionClean: true, renderProcessGoneCount: 0,
        recoveryRequestCount: 1, recoveryRequestStatuses: [200],
        backendStatus: readyBackendStatus(),
        before: {
          detectedInterruptedSite: true, stoppingStageExplained: true,
          preservedCandidateCountExplained: true, automaticHandlingExplained: true,
          nextActionExplained: true, recoveryControlEnabled: true,
          publicProjectionAudit: cleanProjection(),
        },
        after: { lifecycleState: 'ready', recoveryControlAbsent: true, publicProjectionAudit: cleanProjection() },
      },
      reopen: {
        browserWindowSecurity: secureWindow(), publicProjectionClean: true, renderProcessGoneCount: 0,
        recoveryRequestCount: 0,
        backendStatus: readyBackendStatus(),
        before: { lifecycleState: 'ready', publicProjectionAudit: cleanProjection() },
        after: { lifecycleState: 'ready', recoveryControlAbsent: true, publicProjectionAudit: cleanProjection() },
      },
    },
    recoveredTruth: {
      changeSetStatus: 'validation_failed', checkpointStatus: 'validation_failed',
      candidateRevisionCount: 0, interruptedJobTerminal: true, baselineDigestStable: true,
      baselineArtifactsExact: true, baselineCurrentCountExact: true,
    },
    afterRecoveryStatus: { status: 'ready', interruptedCount: 0, activeOperationCount: 0, pendingIssueCount: 0 },
    secondColdStatus: { status: 'ready', interruptedCount: 0 },
    performance: {
      restartRestoreMs: P6_RECOVERY_ELECTRON_BUDGETS.restartRestoreMs - 1,
      budgets: P6_RECOVERY_ELECTRON_BUDGETS,
    },
    processBoundaries: {
      electronActuallySigkilled: true, electronRelaunchedAfterCrash: true,
      electronProcessRelaunched: true, backendColdBootCount: 2, sqliteFileIdentityStable: true,
    },
    sourceBindingStableDuringObservation: true,
  };
}

function electronPressure() {
  return {
    classification: P6_ELECTRON_PRESSURE_CLASSIFICATION,
    qualificationEligible: false,
    p6CloseoutEligible: false,
    providerEvidence: 'not_exercised',
    packagedAppEvidence: 'not_exercised',
    truth: {
      artifactTruthValid: true, exactPhysicalHashes: true, sqliteFormalOutputRevisionsExact: true,
      table: { rows: P6_ELECTRON_PRESSURE_ROWS }, svg: { complex: true }, png: { width: 2100 },
      report: { present: true, longVolumeProven: true, sqliteRevisionProjection: 'measured' },
    },
    pressure: {
      realJobBackedCohortCount: 2, projectToolJobCount: 2,
      syntheticRevisionCount: P6_ELECTRON_PRESSURE_SYNTHETIC_REVISIONS, syntheticFamilyCount: 3,
      immutableMutationRejected: true, immutableDigestStable: true,
    },
    renderer: {
      passed: true, renderProcessGoneCount: 0,
      backendStatus: readyBackendStatus(),
      table: {
        totalRows: P6_ELECTRON_PRESSURE_ROWS,
        canvasFirstVisibleMs: 500, navigationMs: 700, scrollFeedbackMs: 20, scrollChanged: true,
        selectionFeedbackMs: 15, selectionChanged: true, sortFeedbackMs: 18, sortChanged: true,
        filterFeedbackMs: 16, filterChanged: true, filterQueryChanged: true,
        filterMatchedSummaryChanged: true, filterFirstVisibleRowChanged: true,
        virtualPageLoadMs: 350, virtualPageChanged: true,
      },
      media: {
        png: {
          loadMs: 900, switch: { feedbackMs: 25, changed: true }, rendered: true,
          renderMode: 'source_image', naturalWidth: 2100, naturalHeight: 1500,
          sourceTargetMatched: true, artifactTargetMatched: true,
        },
        svg: {
          loadMs: 4_000, switch: { feedbackMs: 30, changed: true }, naturalWidth: 672,
          naturalHeight: 480, sourceTargetMatched: true, artifactTargetMatched: true,
        },
        report: {
          loadMs: 3_000, iframeVisible: true, iframeWidth: 582, iframeHeight: 520,
          textCharacters: 1_283, embeddedImageCount: 6, firstEmbeddedImageWidth: 258,
          sourceTargetMatched: true, artifactTargetMatched: true,
        },
      },
      compare: {
        progressiveRows: 200, openMs: 650,
        progressivePages: [
          { rows: 50, loadMs: null }, { rows: 100, loadMs: 250 },
          { rows: 150, loadMs: 300 }, { rows: 200, loadMs: 350 },
        ],
      },
      history: {
        firstPageVersions: 100, firstPageMs: 1_200,
        afterPaginationVersions: 123, paginationMs: 450,
      },
      memory: { peakPostGcGrowthBytes: 8 * 1024 * 1024 },
      publicProjectionAudit: cleanProjection(),
      publicProjectionSampleCount: 7,
      artifactNetwork: {
        completedCount: 4,
        errorCount: 0,
        events: [
          { artifactName: 'volcano.svg', outcome: 'completed', statusCode: 200 },
        ],
      },
    },
    revisionLedgerStableDuringElectron: true,
    sourceBindingStableDuringObservation: true,
    budgets: P6_ELECTRON_PRESSURE_BUDGETS,
  };
}

function productScenarios() {
  const tableCounts = Object.fromEntries(P5_NO_SEED_TABLES.map((table) => [table, 0]));
  const canonicalTableCounts = Object.fromEntries(
    Object.keys(tableCounts).sort().map((key) => [key, tableCounts[key]]),
  );
  const resourceEstimate = {
    estimateVersion: 1,
    source: 'server_job_descriptor_input_truth',
    memoryBytes: 512 * 1024 * 1024,
    diskBytes: 64 * 1024 * 1024,
  };
  const transportCase = (status) => ({
    status, retryable: true, requestPath: '/v1/chat/completions', requestCount: 2,
    requestStatuses: [status, 200], routingEvent: { reason: { code: 'http_error', status } },
    modelRouting: { fallbackReason: { status } }, recovered: true,
  });
  return {
    classification: P6_PRODUCT_SCENARIO_CLASSIFICATION,
    transport: {
      classification: P6_PRODUCT_SCENARIO_CLASSIFICATION.providerObservation,
      adapter: 'openai-compatible/DeepSeekProvider', loopbackOnly: true,
      realProvider: false, p7Eligible: false, cases: [transportCase(503), transportCase(429)],
    },
    product: {
      noSeedPrecondition: {
        tables: [...P5_NO_SEED_TABLES],
        tableCounts,
        seededTables: [],
        digest: createHash('sha256').update(JSON.stringify(canonicalTableCounts)).digest('hex'),
      },
      resourceBudget: {
        classification: 'real_product_changeset_preflight_no_seed', sourceScientificParametersUnchanged: true,
        memoryBlocked: {
          error: 'preview_resource_budget_blocked', decision: 'blocked',
          reasons: ['memory_budget_exceeded'],
          scientificParametersChanged: false, resourceEstimate,
          measurement: 'host_statfs_and_runtime_snapshot',
          noJobOrChangeSetOrRevisionOrCheckpointWrite: true,
        },
        diskBlocked: {
          error: 'preview_resource_budget_blocked', decision: 'blocked',
          reasons: ['disk_budget_exceeded'],
          scientificParametersChanged: false, resourceEstimate,
          measurement: 'controlled_statfs_dependency_fault',
          noJobOrChangeSetOrRevisionOrCheckpointWrite: true,
        },
        queued: {
          error: 'preview_resource_queued', decision: 'queued', reasons: ['preview_concurrency_saturated'],
          scientificParametersChanged: false, noJobOrChangeSetOrRevisionOrCheckpointWrite: true,
          activePreviewJobs: 2,
        },
        holders: { createdByProductService: true, realToolExecution: true, previewReadyCount: 2 },
      },
      staleAdoption: {
        classification: 'real_no_seed_same_family_candidate_adoption_race', secondAdopted: true,
        staleHttpStatus: 409, staleError: 'adoption_base_stale', noPartialMutation: true,
        firstCandidateRemainsPreviewReady: true, secondCandidateRemainsAdopted: true,
        adoptedCohortCurrent: true, stateDigestBeforeFailure: 'a'.repeat(64),
        stateDigestAfterFailure: 'a'.repeat(64),
      },
      gcColdReadback: {
        classification: 'real_product_http_gc_then_managed_git_gc_and_same_disk_cold_boot',
        httpPlanMode: 'dry_run', httpExecutionMode: 'executed', planVersion: 2,
        artifactDeletionCount: 0, sourceRevisionCount: 12, sourceCommitCount: 6,
        protectedSourceRefCount: 6, gitGc: { exitCode: 0 }, ledgerExact: true,
        revisionsExact: true, changeSetsExact: true, checkpointsExact: true, jobsExact: true,
        physicalHashesExact: true, scriptsExact: true, historyExact: true,
        adoptedCurrentHistoryPresent: true, nonterminalPreviewPreserved: true,
        checkpointTruthPreserved: true, coldWorkspaceNotBlocked: true,
      },
    },
  };
}

function passingObservations() {
  return {
    stop: realStop(), executionFailure: realFailure(), drift: realDrift(), restart: realRestart(),
    electronRecovery: electronRecovery(), electronPressure: electronPressure(),
    productScenarios: productScenarios(),
  };
}

function writableEvidence(overrides = {}, binding = getP6ProductAcceptanceSourceBinding()) {
  const observations = passingObservations();
  const evaluated = evaluateP6ProductAcceptanceObservations(observations);
  return {
    schemaVersion: 1,
    planId: 'G0-RS-P6',
    evidenceClass: P6_PRODUCT_ACCEPTANCE_EVIDENCE_CLASS,
    capturedAt: '2026-07-31T00:00:00.000Z',
    classification: P6_PRODUCT_ACCEPTANCE_CLASSIFICATION,
    qualificationEligible: false,
    p7Eligible: false,
    systemRestartBoundary: P6_PRODUCT_ACCEPTANCE_BOUNDARIES.systemRestart,
    providerBoundary: P6_PRODUCT_ACCEPTANCE_BOUNDARIES.provider,
    packagedBoundary: P6_PRODUCT_ACCEPTANCE_BOUNDARIES.packaged,
    sourceCommit: binding.sourceCommit,
    sourceFiles: binding.sourceFiles,
    sourceHashes: binding.sourceHashes,
    sourceBindingDigest: binding.sourceBindingDigest,
    sourceCommitMatchesSourceHashes: true,
    sourceBindingStableDuringCapture: true,
    observations,
    checks: evaluated.checks,
    componentCheckCounts: evaluated.componentCheckCounts,
    durationMs: 1,
    passed: true,
    ...overrides,
  };
}

test('P6 canonical evaluator recomputes every real component and fails closed on drift', () => {
  const passing = evaluateP6ProductAcceptanceObservations(passingObservations());
  assert.equal(passing.passed, true, JSON.stringify(passing));
  assert.equal(passing.checks.length, 10);
  assert.ok(passing.checks.every((entry) => /^P6-\d{2}$/.test(entry.id) && entry.passed));
  assert.deepEqual(passing.componentCheckCounts, {
    stop: 5, executionFailure: 7, drift: 7, restart: 11,
    electronRecovery: 15, electronPressure: 26, productScenarios: 6,
  });

  const stale = passingObservations();
  stale.productScenarios.product.staleAdoption.stateDigestAfterFailure = 'b'.repeat(64);
  assert.equal(evaluateP6ProductAcceptanceObservations(stale).passed, false);
  const noCrash = passingObservations();
  noCrash.electronRecovery.processBoundaries.electronActuallySigkilled = false;
  assert.equal(evaluateP6ProductAcceptanceObservations(noCrash).passed, false);
  const shortTable = passingObservations();
  shortTable.electronPressure.truth.table.rows -= 1;
  assert.equal(evaluateP6ProductAcceptanceObservations(shortTable).passed, false);
});

test('P6 canonical evaluator recomputes raw pressure facts and independently freezes scope boundaries', () => {
  const forgedRenderer = passingObservations();
  forgedRenderer.electronPressure.renderer.passed = true;
  forgedRenderer.electronPressure.renderer.table.filterChanged = false;
  assert.equal(evaluateP6ProductAcceptanceObservations(forgedRenderer).passed, false,
    'a nested renderer verdict cannot replace the raw filter observation');

  const failedSvgNetwork = passingObservations();
  failedSvgNetwork.electronPressure.renderer.artifactNetwork = {
    completedCount: 3,
    errorCount: 1,
    events: [{ artifactName: 'volcano.svg', outcome: 'error', statusCode: 200 }],
  };
  assert.equal(evaluateP6ProductAcceptanceObservations(failedSvgNetwork).passed, false,
    'a visible-looking SVG cannot replace an exact completed/200 network observation');

  for (const mutate of [
    (observations) => { observations.electronPressure.classification = 'qualified_pressure'; },
    (observations) => { observations.electronPressure.providerEvidence = 'real_provider'; },
    (observations) => { observations.electronPressure.packagedAppEvidence = 'exercised'; },
    (observations) => { observations.electronPressure.p6CloseoutEligible = true; },
    (observations) => {
      observations.electronPressure.budgets = {
        ...P6_ELECTRON_PRESSURE_BUDGETS,
        filterFeedbackMs: P6_ELECTRON_PRESSURE_BUDGETS.filterFeedbackMs + 1,
      };
    },
    (observations) => { observations.electronRecovery.p6CloseoutEligible = true; },
    (observations) => {
      observations.electronRecovery.performance.budgets = {
        ...P6_RECOVERY_ELECTRON_BUDGETS,
        restartRestoreMs: P6_RECOVERY_ELECTRON_BUDGETS.restartRestoreMs + 1,
      };
    },
    (observations) => {
      observations.productScenarios.classification = {
        ...P6_PRODUCT_SCENARIO_CLASSIFICATION,
        literalSystemReboot: true,
      };
    },
  ]) {
    const observations = passingObservations();
    mutate(observations);
    assert.equal(evaluateP6ProductAcceptanceObservations(observations).passed, false);
  }
});

test('P6 component projection drops self-attested verdicts but preserves measured renderer facts', () => {
  const projected = projectP6ComponentObservation({
    sourceCommit: 'a'.repeat(40), sourceHashes: { script: 'b'.repeat(64) },
    checks: [{ id: 'self', passed: true }], passed: true, kept: false,
    renderer: { passed: true, measuredMs: 12 },
  });
  assert.deepEqual(projected, { renderer: { passed: true, measuredMs: 12 } });
});

test('P6 sanitizer allows the bounded public adapter path and rejects runtime coordinates and credentials', () => {
  assert.equal(assertSanitizedP6ProductAcceptanceEvidence({
    requestPath: '/v1/chat/completions', source: 'scripts/example.mjs', digest: 'a'.repeat(64),
  }), true);
  for (const unsafe of [
    { endpoint: 'http://127.0.0.1:3001' },
    { workspace: '/Users/example/private' },
    { apiKey: 'private' },
    { value: 'revision rev_private123' },
    { value: 'artifact art_private123' },
    { value: 'diagnostic at /Users/example/private' },
    { value: 'diagnostic at /tmp/example/private' },
    { value: 'diagnostic at /srv/biof3/private' },
    { value: 'diagnostic at /mnt/biof3/private' },
    { value: 'diagnostic at /data/biof3/private' },
    { value: 'request to https://provider.example/v1/chat' },
    { value: 'checkpoint cp_private123' },
    { value: 'replay rrc_private123' },
    { value: 'workspace checkpoint wrc_private123' },
    { value: 'task task_private123' },
    { contextToken: 'a'.repeat(64) },
    { clientSecret: 'private' },
    { value: `contextToken=${'a'.repeat(64)}` },
    { value: '../outside' },
  ]) assert.throws(() => assertSanitizedP6ProductAcceptanceEvidence(unsafe), /p6_evidence_/);
});

test('P6 source binding is a unique union of all component producers and focused tests', () => {
  const paths = Object.values(P6_PRODUCT_ACCEPTANCE_SOURCE_FILES);
  assert.equal(new Set(paths).size, paths.length);
  for (const sourceMap of [
    P6_ELECTRON_PRESSURE_SOURCE_FILES,
    P6_RECOVERY_ELECTRON_SOURCE_FILES,
    P6_PRODUCT_SCENARIO_SOURCE_FILES,
  ]) {
    for (const relative of Object.values(sourceMap)) assert.ok(paths.includes(relative), relative);
  }
  for (const relative of P6_PRODUCT_ACCEPTANCE_TEST_FILES) assert.ok(paths.includes(relative), relative);
  for (const relative of [
    'package-lock.json',
    'frontend/package-lock.json',
    'src/migration-runner.js',
    'src/migrations/001_result_studio.sql',
    'src/migrations/003_result_ref_transactions.sql',
    'core/r-server/helpers/process-lifecycle.js',
    'core/r-server/helpers/verified-file-snapshot.js',
    'core/shared-backend/git-adapter.js',
    'core/shared-backend/result-ref-transaction-schema.js',
    'core/shared-backend/result-ref-transaction.js',
    'core/shared-backend/result-studio-contracts.js',
    'core/shared-backend/result-studio-private-path.js',
    'core/shared-backend/result-studio-schema.js',
    'core/shared-backend/scientific-task-spec.js',
    'core/shared-backend/llm-providers/index.js',
    'core/shared-backend/ai-usage-helper.js',
    'core/shared-backend/logger.js',
    'core/shared-backend/result-studio-table-query.js',
    'frontend/src/components/result-studio/ResultAgentComposer.module.css',
    'frontend/src/components/result-studio/ResultEditPanel.module.css',
    'frontend/src/components/result-studio/ResultStudioSurface.module.css',
    'frontend/src/components/result-studio/RevisionCodeView.module.css',
    'frontend/src/components/result-studio/ScientificInteractionViewer.module.css',
    'frontend/src/pages/project-workspace.module.css',
  ]) assert.ok(paths.includes(relative), `missing direct runtime ancestor: ${relative}`);

  const impact = resolveImpact(paths);
  assert.deepEqual(impact.unknown, []);
  assert.ok(impact.tests.includes('test/g0-rs-p6-product-acceptance.test.mjs'));
  for (const relative of paths) {
    assert.ok(impact.reasons[relative]?.includes('p6-canonical-source-binding'),
      `${relative} must select the canonical P6 source-binding verifier`);
  }
  const binding = getP6ProductAcceptanceSourceBinding();
  assert.match(binding.sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(binding.sourceBindingDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(binding.sourceHashes).sort(), paths.sort());
});

test('P6 stored source binding must match the current tracked HEAD bytes, not only a historical commit', () => {
  const binding = getP6ProductAcceptanceSourceBinding();
  const current = {
    ...binding,
    sourceCommitMatchesSourceHashes: true,
    sourceMismatches: [],
  };
  assert.equal(assertCurrentP6ProductAcceptanceSourceBinding(binding, current), true);
  assert.equal(assertCurrentP6ProductAcceptanceSourceBinding(binding, {
    ...current,
    sourceCommit: 'b'.repeat(40),
    sourceBindingDigest: 'c'.repeat(64),
  }, { isAncestor: () => true }), true,
  'an evidence/docs-only descendant commit must remain valid when every bound byte is unchanged');
  assert.throws(() => assertCurrentP6ProductAcceptanceSourceBinding(binding, {
    ...current,
    sourceCommitMatchesSourceHashes: false,
    sourceMismatches: ['scripts/g0-rs-p6-product-acceptance.mjs'],
  }), /p6_current_source_tree_not_exact/);

  const changedPath = Object.values(P6_PRODUCT_ACCEPTANCE_SOURCE_FILES)[0];
  const changedEvidence = {
    ...binding,
    sourceHashes: { ...binding.sourceHashes, [changedPath]: 'f'.repeat(64) },
  };
  assert.throws(() => assertCurrentP6ProductAcceptanceSourceBinding(changedEvidence, current),
    /p6_stored_current_source_hash_mismatch/);
  assert.throws(() => verifyStoredP6ProductAcceptanceSourceBinding(changedEvidence, {
    currentBinding: current,
  }), /p6_stored_current_source_hash_mismatch/);
  assert.throws(() => assertCurrentP6ProductAcceptanceSourceBinding({
    ...binding,
    sourceCommit: 'a'.repeat(40),
  }, current, { isAncestor: () => false }), /p6_stored_source_commit_not_ancestor/);
});

test('P6 canonical writer independently validates frozen evidence envelope and boundaries', () => {
  const evidence = writableEvidence();
  assert.equal(assertP6ProductAcceptanceEvidenceWritable(evidence), true);
  for (const override of [
    { systemRestartBoundary: 'literal_system_reboot' },
    { providerBoundary: 'real_provider' },
    { packagedBoundary: 'packaged_electron' },
    { qualificationEligible: true },
    { p7Eligible: true },
    { evidenceClass: 'qualified_provider_evidence' },
  ]) {
    assert.throws(() => assertP6ProductAcceptanceEvidenceWritable({ ...evidence, ...override }),
      /p6_evidence_classification_invalid/);
  }
});

test('P6 canonical writer rejects static fixtures that did not come from the live capture', () => {
  const writes = [];
  assert.throws(
    () => writeP6ProductAcceptanceEvidence(writableEvidence(), {
      makeDirectory() {},
      write(_target, value) { writes.push(value); },
    }),
    (error) => error?.code === 'p6_evidence_not_live_capture',
  );
  assert.deepEqual(writes, []);
});

test('P6 live-capture guard binds object identity and the complete canonical payload digest', () => {
  const guard = P6_PRODUCT_ACCEPTANCE_TEST_HOOKS.createLiveCaptureGuard();
  const evidence = writableEvidence();
  assert.equal(guard.remember(evidence), evidence);
  assert.equal(guard.assertUnchanged(evidence), true);
  assert.throws(
    () => guard.assertUnchanged({ ...evidence }),
    (error) => error?.code === 'p6_evidence_not_live_capture',
  );

  evidence.observations.stop.cancelHttpStatus = 500;
  assert.throws(
    () => guard.assertUnchanged(evidence),
    (error) => error?.code === 'p6_evidence_live_capture_mutated',
  );
});

test('P6 package gate owns syntax, focused tests, stored verification and evidence refresh', () => {
  const scripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
  for (const key of ['g0:result-studio:p6:syntax', 'g0:result-studio:p6:test',
    'g0:result-studio:p6', 'g0:result-studio:p6:update']) {
    assert.equal(typeof scripts[key], 'string', key);
  }
  for (const relative of P6_PRODUCT_ACCEPTANCE_TEST_FILES) {
    assert.ok(scripts['g0:result-studio:p6:test'].includes(relative), relative);
  }
  assert.match(scripts['g0:result-studio:p6'], /g0-rs-p6-product-acceptance\.mjs/);
  assert.match(scripts['g0:result-studio:p6:update'], /--write-evidence/);
});

test('stored P6 evidence remains source-bound and recomputable', {
  skip: !existsSync(EVIDENCE_PATH) && 'generated only after the implementation source commit',
}, () => {
  assert.equal(verifyStoredP6ProductAcceptanceEvidence(), true);
  const evidence = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8'));
  evidence.observations.electronRecovery.processBoundaries.electronActuallySigkilled = false;
  assert.throws(() => verifyStoredP6ProductAcceptanceEvidence(evidence),
    /p6_evidence_checks_not_recomputed/);
});

test('P6 classification is explicitly local, non-Provider, non-packaged and non-qualifying', () => {
  assert.deepEqual(P6_PRODUCT_ACCEPTANCE_CLASSIFICATION, {
    stage: 'G0-RS-P6',
    scope: 'local_durability_recovery_performance_and_product_explainability',
    realProvider: false,
    packagedElectron: false,
    literalSystemReboot: false,
    qualificationEligible: false,
    p7Eligible: false,
  });
});
