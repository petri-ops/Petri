#!/usr/bin/env node

/**
 * G0-RS-P6 canonical durability, recovery and pressure acceptance.
 *
 * The update path captures real component observations. The default path is a
 * fast verifier that recomputes every verdict from stored observations and
 * verifies every bound source byte against both the recorded commit and the
 * current tracked HEAD/worktree state.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  captureP6RealDriftPrototype,
  captureP6RealFailurePrototype,
  captureP6RealRestartPrototype,
  captureP6RealStopPrototype,
  evaluateP6RealDriftPrototype,
  evaluateP6RealFailurePrototype,
  evaluateP6RealRestartPrototype,
  evaluateP6RealStopPrototype,
} from './g0-rs-p6-real-restart-prototype.mjs';
import {
  P6_ELECTRON_PRESSURE_BUDGETS,
  P6_ELECTRON_PRESSURE_CLASSIFICATION,
  P6_ELECTRON_PRESSURE_SOURCE_FILES,
  buildP6ElectronPressureVerdict,
  observeP6ElectronPressure,
} from './g0-rs-p6-electron-pressure-prototype.mjs';
import {
  P6_RECOVERY_ELECTRON_BUDGETS,
  P6_RECOVERY_ELECTRON_CLASSIFICATION,
  P6_RECOVERY_ELECTRON_SOURCE_FILES,
  buildP6RecoveryElectronVerdict,
  observeP6RecoveryElectron,
} from './g0-rs-p6-recovery-electron-prototype.mjs';
import {
  P6_PRODUCT_SCENARIO_CLASSIFICATION,
  P6_PRODUCT_SCENARIO_SOURCE_FILES,
  captureP6ProductScenarios,
  evaluateP6ProductScenarios,
} from './g0-rs-p6-product-scenarios.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_PATH = path.join(
  ROOT,
  'acceptance/g0-result-studio/rs-p6-durability-recovery-performance.json',
);
const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export const P6_PRODUCT_ACCEPTANCE_CLASSIFICATION = Object.freeze({
  stage: 'G0-RS-P6',
  scope: 'local_durability_recovery_performance_and_product_explainability',
  realProvider: false,
  packagedElectron: false,
  literalSystemReboot: false,
  qualificationEligible: false,
  p7Eligible: false,
});

export const P6_PRODUCT_ACCEPTANCE_BOUNDARIES = Object.freeze({
  systemRestart:
    'development_electron_and_owned_backend_processes_restart_on_same_disk_no_literal_system_reboot',
  provider: 'controlled_loopback_503_429_only_real_provider_excluded_to_p7',
  packaged: 'development_electron_only_packaged_app_excluded_to_p7',
});

export const P6_PRODUCT_ACCEPTANCE_EVIDENCE_CLASS =
  'real_local_product_durability_recovery_pressure_non_qualifying';

const P6_RECOVERY_ELECTRON_BOUNDARY = Object.freeze({
  providerEvidence: 'not_exercised',
  packagedAppEvidence: 'not_exercised',
  qualificationEligible: false,
  systemRestartClaim: false,
  processBoundary: 'owned_electron_and_backend_processes_restarted_against_same_durable_local_stores',
});

const P6_PRESSURE_BOUNDARY = Object.freeze({
  providerEvidence: 'not_exercised',
  packagedAppEvidence: 'not_exercised',
  qualificationEligible: false,
  p6CloseoutEligible: false,
});

export const P6_PRODUCT_ACCEPTANCE_TEST_FILES = Object.freeze([
  'test/g0-chf0-lifecycle.test.mjs',
  'test/g0-rs-p6-product-acceptance.test.mjs',
  'test/g0-rs-p6-real-restart-prototype.test.mjs',
  'test/g0-rs-p6-electron-pressure-prototype.test.mjs',
  'test/g0-rs-p6-recovery-electron-prototype.test.mjs',
  'test/g0-rs-p6-product-scenarios.test.mjs',
  'test/g0-rs-p6-recovery-acceptance.test.mjs',
  'test/result-changeset-service.test.mjs',
  'test/result-studio-lifecycle.test.mjs',
  'test/result-studio-background.test.mjs',
  'test/result-studio-resource-summary.test.mjs',
  'test/result-studio-table-query.test.mjs',
  'test/tool-resource-sampler.test.mjs',
  'test/tools-executor-job-context.test.mjs',
  'test/artifact-truth.test.mjs',
  'test/git-adapter.test.mjs',
  'test/result-compare-service.test.mjs',
  'test/result-ref-transaction.test.mjs',
  'test/result-selection-tools.test.mjs',
  'test/result-studio-migration.test.mjs',
  'test/result-studio-repository.test.mjs',
  'test/result-studio-route-baseline.test.mjs',
  'test/test-affected.test.mjs',
]);

const EXTRA_SOURCE_FILES = Object.freeze([
  'scripts/g0-rs-p6-product-acceptance.mjs',
  'scripts/g0-rs-p6-real-restart-prototype.mjs',
  'scripts/g0-rs-p6-recovery-acceptance.mjs',
  'test/g0-rs-p6-real-restart-prototype.test.mjs',
  'test/g0-rs-p6-recovery-acceptance.test.mjs',
  'package.json',
  'package-lock.json',
  'frontend/package.json',
  'frontend/package-lock.json',
  'test/impact-map.json',
  'src/migration-runner.js',
  'src/migrations/001_result_studio.sql',
  'src/migrations/002_result_workflow_graph.sql',
  'src/migrations/003_result_ref_transactions.sql',
  'core/r-server/agent-tools/result-selection-tools.js',
  'core/r-server/helpers/process-lifecycle.js',
  'core/r-server/helpers/verified-file-snapshot.js',
  'core/r-server/routes/tools-platform.js',
  'core/shared-backend/artifact-interaction.js',
  'core/shared-backend/project-run-layout.js',
  'core/shared-backend/git-adapter.js',
  'core/shared-backend/result-edit-controls.js',
  'core/shared-backend/result-ref-transaction-schema.js',
  'core/shared-backend/result-ref-transaction.js',
  'core/shared-backend/result-studio-contracts.js',
  'core/shared-backend/result-studio-private-path.js',
  'core/shared-backend/result-studio-resource-summary.js',
  'core/shared-backend/result-studio-schema.js',
  'core/shared-backend/runtime-resource-probe.js',
  'core/shared-backend/runtime-resource-snapshot.js',
  'core/shared-backend/scientific-task-spec.js',
  'core/shared-backend/tool-resource-sampler.js',
  'frontend/src/components/result-studio/ResultAgentComposer.module.css',
  'frontend/src/components/result-studio/ResultEditPanel.module.css',
  'frontend/src/components/result-studio/ResultStudioSurface.module.css',
  'frontend/src/components/result-studio/RevisionCodeView.tsx',
  'frontend/src/components/result-studio/RevisionCodeView.module.css',
  'frontend/src/components/result-studio/ScientificInteractionViewer.module.css',
  'frontend/src/components/result-studio/resultBodyState.ts',
  'frontend/src/components/result-studio/resultFirstScreen.ts',
  'frontend/src/components/result-studio/resultMode.ts',
  'frontend/src/components/result-studio/resultScrollMemory.ts',
  'frontend/src/lib/artifact-selection.ts',
  'frontend/src/lib/result-studio-interaction-client.ts',
  'frontend/src/pages/project-workspace.module.css',
  ...P6_PRODUCT_ACCEPTANCE_TEST_FILES,
]);

export const P6_PRODUCT_ACCEPTANCE_SOURCE_FILES = Object.freeze(Object.fromEntries(
  [...new Set([
    ...Object.values(P6_ELECTRON_PRESSURE_SOURCE_FILES),
    ...Object.values(P6_RECOVERY_ELECTRON_SOURCE_FILES),
    ...Object.values(P6_PRODUCT_SCENARIO_SOURCE_FILES),
    ...EXTRA_SOURCE_FILES,
  ])].sort().map((relative) => [relative, relative]),
));

function invariant(condition, code, detail = null) {
  if (condition) return;
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  throw error;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function stableHash(value) {
  return sha256(JSON.stringify(stable(value)));
}

function canonicalEvidencePayload(evidence) {
  const { dryRunPassed: _dryRunPassed, ...canonicalEvidence } = evidence || {};
  return canonicalEvidence;
}

function createP6LiveCaptureGuard() {
  const capturedPayloadDigests = new WeakMap();
  return Object.freeze({
    remember(evidence) {
      invariant(evidence && typeof evidence === 'object', 'p6_evidence_not_live_capture');
      capturedPayloadDigests.set(evidence, stableHash(canonicalEvidencePayload(evidence)));
      return evidence;
    },
    assertUnchanged(evidence) {
      const capturedDigest = evidence && typeof evidence === 'object'
        ? capturedPayloadDigests.get(evidence)
        : null;
      invariant(SHA256.test(capturedDigest || ''), 'p6_evidence_not_live_capture');
      invariant(capturedDigest === stableHash(canonicalEvidencePayload(evidence)),
        'p6_evidence_live_capture_mutated');
      return true;
    },
  });
}

const p6LiveCaptureGuard = createP6LiveCaptureGuard();

export const P6_PRODUCT_ACCEPTANCE_TEST_HOOKS = Object.freeze({
  createLiveCaptureGuard: createP6LiveCaptureGuard,
});

function git(args, options = {}) {
  return spawnSync('git', args, {
    cwd: ROOT,
    encoding: options.binary ? null : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function checkedSource(relative) {
  const normalized = String(relative || '').replaceAll('\\', '/');
  const target = path.resolve(ROOT, normalized);
  invariant(normalized && !path.isAbsolute(normalized)
    && !normalized.split('/').includes('..')
    && target.startsWith(`${ROOT}${path.sep}`), 'p6_source_path_unsafe', normalized);
  invariant(existsSync(target), 'p6_source_file_missing', normalized);
  return { relative: normalized, target };
}

function sourceBindingPayload({ sourceCommit, sourceFiles, sourceHashes }) {
  return { sourceCommit, sourceFiles, sourceHashes };
}

export function getP6ProductAcceptanceSourceBinding() {
  const sourceCommit = git(['rev-parse', 'HEAD']).stdout.trim();
  invariant(COMMIT.test(sourceCommit), 'p6_source_commit_unavailable');
  const sourceHashes = {};
  const sourceMismatches = [];
  for (const relative of Object.values(P6_PRODUCT_ACCEPTANCE_SOURCE_FILES)) {
    const source = checkedSource(relative);
    const digest = sha256(readFileSync(source.target));
    sourceHashes[relative] = digest;
    const shown = git(['show', `${sourceCommit}:${relative}`], { binary: true });
    if (shown.status !== 0 || sha256(shown.stdout) !== digest) sourceMismatches.push(relative);
  }
  const binding = sourceBindingPayload({
    sourceCommit,
    sourceFiles: P6_PRODUCT_ACCEPTANCE_SOURCE_FILES,
    sourceHashes,
  });
  return {
    ...binding,
    sourceBindingDigest: stableHash(binding),
    sourceCommitMatchesSourceHashes: sourceMismatches.length === 0,
    sourceMismatches,
  };
}

export function assertCurrentP6ProductAcceptanceSourceBinding(
  evidence,
  current = getP6ProductAcceptanceSourceBinding(),
  { isAncestor = (ancestor, descendant) => (
    git(['merge-base', '--is-ancestor', ancestor, descendant]).status === 0
  ) } = {},
) {
  invariant(current?.sourceCommitMatchesSourceHashes === true,
    'p6_current_source_tree_not_exact', current?.sourceMismatches || null);
  invariant(COMMIT.test(evidence?.sourceCommit || '') && COMMIT.test(current?.sourceCommit || '')
    && isAncestor(evidence.sourceCommit, current.sourceCommit),
  'p6_stored_source_commit_not_ancestor', {
      evidenceSourceCommit: evidence?.sourceCommit || null,
      currentSourceCommit: current?.sourceCommit || null,
  });
  invariant(stableHash(current?.sourceFiles) === stableHash(P6_PRODUCT_ACCEPTANCE_SOURCE_FILES),
    'p6_current_source_map_invalid');
  for (const relative of Object.values(P6_PRODUCT_ACCEPTANCE_SOURCE_FILES)) {
    invariant(current?.sourceHashes?.[relative] === evidence?.sourceHashes?.[relative],
      'p6_stored_current_source_hash_mismatch', relative);
  }
  return true;
}

export function verifyStoredP6ProductAcceptanceSourceBinding(
  evidence,
  { currentBinding = null } = {},
) {
  invariant(COMMIT.test(evidence?.sourceCommit || ''), 'p6_stored_source_commit_invalid');
  invariant(stableHash(evidence?.sourceFiles) === stableHash(P6_PRODUCT_ACCEPTANCE_SOURCE_FILES),
    'p6_stored_source_map_invalid');
  invariant(evidence?.sourceHashes && typeof evidence.sourceHashes === 'object',
    'p6_stored_source_hashes_missing');
  invariant(git(['cat-file', '-e', `${evidence.sourceCommit}^{commit}`]).status === 0,
    'p6_stored_source_commit_unreachable');
  invariant(git(['merge-base', '--is-ancestor', evidence.sourceCommit, 'HEAD']).status === 0,
    'p6_stored_source_commit_not_ancestor');
  assertCurrentP6ProductAcceptanceSourceBinding(
    evidence,
    currentBinding || getP6ProductAcceptanceSourceBinding(),
  );
  for (const relative of Object.values(P6_PRODUCT_ACCEPTANCE_SOURCE_FILES)) {
    const expected = evidence.sourceHashes[relative];
    invariant(SHA256.test(expected || ''), 'p6_stored_source_hash_invalid', relative);
    const shown = git(['show', `${evidence.sourceCommit}:${relative}`], { binary: true });
    invariant(shown.status === 0 && sha256(shown.stdout) === expected,
      'p6_stored_source_hash_mismatch', relative);
  }
  const binding = sourceBindingPayload(evidence);
  invariant(evidence.sourceBindingDigest === stableHash(binding),
    'p6_stored_source_binding_digest_mismatch');
  invariant(evidence.sourceCommitMatchesSourceHashes === true,
    'p6_stored_source_binding_not_exact');
  return true;
}

const unsafeKey = /(?:^|_)(?:authorization|cookie|password|credential|private_key|access_key|api_key|session_id|context_token|client_secret|secret|token)(?:_|$)/i;
const internalId = /(?:^|[^A-Za-z0-9])(?:(?:p|project|tj|rev|cs|conv|sel|wfg|art|cp|rrc|wrc|task|run|loop)_[A-Za-z0-9][A-Za-z0-9.-]{5,}|job_(?!descriptor_input_truth(?:$|[^A-Za-z0-9]))[A-Za-z0-9][A-Za-z0-9.-]{5,})/i;
const embeddedUri = /\b(?:https?|file):\/\/[^\s"'<>]+/i;
const embeddedUnixAbsolutePath = /(?:^|[\s"'`(=,:])\/(?!\/)[^\s"'<>]*/;
const embeddedWindowsPath = /(?:^|[\s"'`(=,:])(?:[A-Za-z]:[\\/]|\\\\)/;
const embeddedHomePath = /(?:^|[\s"'`(=,:])~[\\/]/;
const embeddedSensitiveAssignment = /\b(?:authorization|cookie|password|credential|private[ _-]?key|access[ _-]?key|api[ _-]?key|session[ _-]?id|context[ _-]?token|client[ _-]?secret|secret|token)\s*(?:=|:)\s*[^\s,;]+/i;

function normalizedEvidenceKey(key) {
  return String(key || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

export function assertSanitizedP6ProductAcceptanceEvidence(value, pointer = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSanitizedP6ProductAcceptanceEvidence(item, `${pointer}[${index}]`));
    return true;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      invariant(!unsafeKey.test(normalizedEvidenceKey(key)), 'p6_evidence_unsafe_key', `${pointer}.${key}`);
      assertSanitizedP6ProductAcceptanceEvidence(child, `${pointer}.${key}`);
    }
    return true;
  }
  if (typeof value !== 'string') return true;
  invariant(!embeddedUri.test(value), 'p6_evidence_uri_leaked', pointer);
  const approvedPublicApiPath = /^\/v1\/[A-Za-z0-9/_-]+$/.test(value);
  invariant((approvedPublicApiPath || !path.isAbsolute(value)) && !/^[A-Za-z]:[\\/]/.test(value)
    && !/^(?:~[\\/]|\\\\)/.test(value), 'p6_evidence_absolute_path_leaked', pointer);
  invariant((approvedPublicApiPath || !embeddedUnixAbsolutePath.test(value)) && !embeddedWindowsPath.test(value)
    && !embeddedHomePath.test(value), 'p6_evidence_absolute_path_leaked', pointer);
  invariant(!/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value), 'p6_evidence_parent_path_leaked', pointer);
  invariant(!internalId.test(value), 'p6_evidence_internal_id_leaked', pointer);
  invariant(!embeddedSensitiveAssignment.test(value), 'p6_evidence_secret_leaked', pointer);
  return true;
}

const COMPONENT_METADATA_KEYS = new Set([
  'checks',
  'passed',
  'dryRunPassed',
  'kept',
  'sourceCommit',
  'sourceFiles',
  'sourceHashes',
  'sourceBindingDigest',
  'sourceCommitMatchesSourceHashes',
  'sourceMismatches',
]);

export function projectP6ComponentObservation(observation) {
  const projected = Object.fromEntries(Object.entries(observation || {})
    .filter(([key]) => !COMPONENT_METADATA_KEYS.has(key)));
  const cloned = JSON.parse(JSON.stringify(projected));
  assertSanitizedP6ProductAcceptanceEvidence(cloned);
  return cloned;
}

function componentPassed(evaluation) {
  return evaluation?.passed === true
    && Object.values(evaluation?.checks || {}).every((entry) => entry === true);
}

function verdictPassed(verdict) {
  return verdict?.passed === true
    && Array.isArray(verdict?.checks)
    && verdict.checks.length > 0
    && verdict.checks.every((entry) => entry?.passed === true);
}

export function evaluateP6ElectronRecoveryAcceptanceObservation(observation) {
  const verdict = buildP6RecoveryElectronVerdict(observation);
  const boundaryChecks = {
    rawVerdict: verdictPassed(verdict),
    classification: observation?.classification === P6_RECOVERY_ELECTRON_CLASSIFICATION,
    nonQualification: observation?.qualificationEligible === false
      && observation?.p6CloseoutEligible === false,
    frozenBoundary: exactJson(observation?.boundary, P6_RECOVERY_ELECTRON_BOUNDARY),
    frozenBudget: exactJson(observation?.performance?.budgets, P6_RECOVERY_ELECTRON_BUDGETS),
  };
  return {
    verdict,
    boundaryChecks,
    passed: Object.values(boundaryChecks).every(Boolean),
  };
}

export function evaluateP6ElectronPressureAcceptanceObservation(observation) {
  // The producer's `passed` and `checks` fields are deliberately ignored.
  // Only its raw renderer/Artifact Truth observations are re-evaluated here.
  const verdict = buildP6ElectronPressureVerdict(observation);
  const boundaryChecks = {
    rawVerdict: verdictPassed(verdict),
    classification: observation?.classification === P6_ELECTRON_PRESSURE_CLASSIFICATION,
    frozenBoundary: observation?.providerEvidence === P6_PRESSURE_BOUNDARY.providerEvidence
      && observation?.packagedAppEvidence === P6_PRESSURE_BOUNDARY.packagedAppEvidence
      && observation?.qualificationEligible === P6_PRESSURE_BOUNDARY.qualificationEligible
      && observation?.p6CloseoutEligible === P6_PRESSURE_BOUNDARY.p6CloseoutEligible,
    frozenBudget: exactJson(observation?.budgets, P6_ELECTRON_PRESSURE_BUDGETS),
  };
  return {
    verdict,
    boundaryChecks,
    passed: Object.values(boundaryChecks).every(Boolean),
  };
}

function hasLocalNonQualifyingComponentBoundaries(observations, recovery, pressure) {
  const prototypes = [
    observations?.stop,
    observations?.executionFailure,
    observations?.drift,
    observations?.restart,
  ];
  return prototypes.every((observation) => observation?.qualificationEligible === false
      && observation?.providerUsed === false
      && observation?.packagedAppUsed === false)
    && recovery?.boundaryChecks?.classification === true
    && recovery?.boundaryChecks?.nonQualification === true
    && recovery?.boundaryChecks?.frozenBoundary === true
    && pressure?.boundaryChecks?.classification === true
    && pressure?.boundaryChecks?.frozenBoundary === true
    && exactJson(observations?.productScenarios?.classification, P6_PRODUCT_SCENARIO_CLASSIFICATION)
    && observations?.productScenarios?.transport?.realProvider === false
    && observations?.productScenarios?.transport?.loopbackOnly === true
    && observations?.productScenarios?.transport?.p7Eligible === false;
}

export function evaluateP6ProductAcceptanceObservations(observations = {}) {
  const electronRecovery = evaluateP6ElectronRecoveryAcceptanceObservation(
    observations.electronRecovery,
  );
  const electronPressure = evaluateP6ElectronPressureAcceptanceObservation(
    observations.electronPressure,
  );
  const evaluations = {
    stop: evaluateP6RealStopPrototype(observations.stop),
    executionFailure: evaluateP6RealFailurePrototype(observations.executionFailure),
    drift: evaluateP6RealDriftPrototype(observations.drift),
    restart: evaluateP6RealRestartPrototype(observations.restart),
    electronRecovery: electronRecovery.verdict,
    electronPressure: electronPressure.verdict,
    productScenarios: evaluateP6ProductScenarios(observations.productScenarios),
  };
  const checks = [
    { id: 'P6-01', passed: componentPassed(evaluations.stop) },
    { id: 'P6-02', passed: componentPassed(evaluations.executionFailure) },
    { id: 'P6-03', passed: componentPassed(evaluations.drift) },
    { id: 'P6-04', passed: componentPassed(evaluations.restart) },
    { id: 'P6-05', passed: electronRecovery.passed },
    { id: 'P6-06', passed: electronPressure.passed },
    { id: 'P6-07', passed: componentPassed(evaluations.productScenarios) },
    { id: 'P6-08', passed: observations.electronRecovery?.sourceBindingStableDuringObservation === true
      && observations.electronPressure?.sourceBindingStableDuringObservation === true },
    { id: 'P6-09', passed: hasLocalNonQualifyingComponentBoundaries(
      observations,
      electronRecovery,
      electronPressure,
    ) },
    { id: 'P6-10', passed: electronRecovery.boundaryChecks.frozenBudget === true
      && electronPressure.boundaryChecks.frozenBudget === true
      && observations.electronRecovery?.sourceBindingStableDuringObservation === true
      && observations.electronPressure?.sourceBindingStableDuringObservation === true },
  ].map((entry) => ({ ...entry, passed: entry.passed === true }));
  return {
    evaluations,
    checks,
    passed: checks.every((entry) => entry.passed),
    componentCheckCounts: {
      stop: Object.keys(evaluations.stop.checks).length,
      executionFailure: Object.keys(evaluations.executionFailure.checks).length,
      drift: Object.keys(evaluations.drift.checks).length,
      restart: Object.keys(evaluations.restart.checks).length,
      electronRecovery: evaluations.electronRecovery.checks.length,
      electronPressure: evaluations.electronPressure.checks.length,
      productScenarios: Object.keys(evaluations.productScenarios.checks).length,
    },
  };
}

function exactJson(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

export function assertP6ProductAcceptanceEvidenceWritable(evidence) {
  invariant(evidence?.schemaVersion === 1
    && evidence?.planId === 'G0-RS-P6'
    && evidence?.evidenceClass === P6_PRODUCT_ACCEPTANCE_EVIDENCE_CLASS
    && typeof evidence?.capturedAt === 'string'
    && Number.isFinite(Date.parse(evidence.capturedAt))
    && Number.isFinite(evidence?.durationMs)
    && evidence.durationMs >= 0
    && exactJson(evidence?.classification, P6_PRODUCT_ACCEPTANCE_CLASSIFICATION)
    && evidence?.qualificationEligible === false
    && evidence?.p7Eligible === false
    && evidence?.systemRestartBoundary === P6_PRODUCT_ACCEPTANCE_BOUNDARIES.systemRestart
    && evidence?.providerBoundary === P6_PRODUCT_ACCEPTANCE_BOUNDARIES.provider
    && evidence?.packagedBoundary === P6_PRODUCT_ACCEPTANCE_BOUNDARIES.packaged,
  'p6_evidence_classification_invalid');
  invariant(evidence?.sourceCommitMatchesSourceHashes === true
    && evidence?.sourceBindingStableDuringCapture === true,
  'p6_evidence_source_binding_not_current');
  const recomputed = evaluateP6ProductAcceptanceObservations(evidence?.observations);
  invariant(recomputed.passed && evidence?.passed === true
    && exactJson(evidence?.checks, recomputed.checks)
    && exactJson(evidence?.componentCheckCounts, recomputed.componentCheckCounts),
  'p6_evidence_checks_not_recomputed');
  assertSanitizedP6ProductAcceptanceEvidence(evidence);
  return true;
}

export function writeP6ProductAcceptanceEvidence(evidence, io = {}) {
  p6LiveCaptureGuard.assertUnchanged(evidence);
  const canonicalEvidence = canonicalEvidencePayload(evidence);
  assertP6ProductAcceptanceEvidenceWritable(canonicalEvidence);
  assertCurrentP6ProductAcceptanceSourceBinding(canonicalEvidence);
  const serialized = `${JSON.stringify(canonicalEvidence, null, 2)}\n`;
  (io.makeDirectory || mkdirSync)(path.dirname(EVIDENCE_PATH), { recursive: true });
  (io.write || writeFileSync)(EVIDENCE_PATH, serialized);
  return { bytes: Buffer.byteLength(serialized), digest: sha256(serialized) };
}

export function verifyStoredP6ProductAcceptanceEvidence(evidence = null) {
  const stored = evidence || JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8'));
  verifyStoredP6ProductAcceptanceSourceBinding(stored);
  assertP6ProductAcceptanceEvidenceWritable(stored);
  invariant(stored?.sourceBindingStableDuringCapture === true,
    'p6_stored_capture_source_binding_changed');
  return true;
}

export async function captureP6ProductAcceptance({ keep = false, show = false, verbose = false } = {}) {
  const sourceAtStart = getP6ProductAcceptanceSourceBinding();
  const startedAt = Date.now();
  const observations = {};
  observations.stop = projectP6ComponentObservation(
    await captureP6RealStopPrototype({ keep, verbose }),
  );
  observations.executionFailure = projectP6ComponentObservation(
    await captureP6RealFailurePrototype({ keep, verbose }),
  );
  observations.drift = projectP6ComponentObservation(
    await captureP6RealDriftPrototype({ keep, verbose }),
  );
  observations.restart = projectP6ComponentObservation(
    await captureP6RealRestartPrototype({ keep, verbose }),
  );
  observations.electronRecovery = projectP6ComponentObservation(
    await observeP6RecoveryElectron({ keep, show, verbose }),
  );
  observations.electronPressure = projectP6ComponentObservation(
    await observeP6ElectronPressure({ keep, show }),
  );
  observations.productScenarios = projectP6ComponentObservation(
    await captureP6ProductScenarios({ keep, verbose }),
  );

  const sourceAtEnd = getP6ProductAcceptanceSourceBinding();
  const evaluated = evaluateP6ProductAcceptanceObservations(observations);
  const evidence = {
    schemaVersion: 1,
    planId: 'G0-RS-P6',
    evidenceClass: P6_PRODUCT_ACCEPTANCE_EVIDENCE_CLASS,
    capturedAt: new Date().toISOString(),
    classification: P6_PRODUCT_ACCEPTANCE_CLASSIFICATION,
    qualificationEligible: false,
    p7Eligible: false,
    systemRestartBoundary: P6_PRODUCT_ACCEPTANCE_BOUNDARIES.systemRestart,
    providerBoundary: P6_PRODUCT_ACCEPTANCE_BOUNDARIES.provider,
    packagedBoundary: P6_PRODUCT_ACCEPTANCE_BOUNDARIES.packaged,
    sourceCommit: sourceAtStart.sourceCommit,
    sourceFiles: sourceAtStart.sourceFiles,
    sourceHashes: sourceAtStart.sourceHashes,
    sourceBindingDigest: sourceAtStart.sourceBindingDigest,
    sourceCommitMatchesSourceHashes: sourceAtStart.sourceCommitMatchesSourceHashes,
    sourceBindingStableDuringCapture: sourceAtStart.sourceCommitMatchesSourceHashes
      && sourceAtEnd.sourceCommitMatchesSourceHashes
      && sourceAtStart.sourceBindingDigest === sourceAtEnd.sourceBindingDigest,
    observations,
    checks: evaluated.checks,
    componentCheckCounts: evaluated.componentCheckCounts,
    durationMs: Date.now() - startedAt,
    passed: evaluated.passed
      && sourceAtStart.sourceCommitMatchesSourceHashes
      && sourceAtEnd.sourceCommitMatchesSourceHashes
      && sourceAtStart.sourceBindingDigest === sourceAtEnd.sourceBindingDigest,
  };
  assertSanitizedP6ProductAcceptanceEvidence(evidence);
  return p6LiveCaptureGuard.remember({
    ...evidence,
    dryRunPassed: evaluated.passed,
  });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (!args.has('--write-evidence') && !args.has('--live')) {
    verifyStoredP6ProductAcceptanceEvidence();
    const stored = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8'));
    console.log(`[G0-RS-P6] PASS - ${stored.checks.length}/${stored.checks.length} canonical checks recomputed`);
    return;
  }
  const captured = await captureP6ProductAcceptance({
    keep: args.has('--keep'),
    show: args.has('--show'),
    verbose: args.has('--verbose'),
  });
  if (args.has('--write-evidence')) {
    writeP6ProductAcceptanceEvidence(captured);
  }
  const passed = captured.passed || (!args.has('--write-evidence') && captured.dryRunPassed);
  console.log(`[G0-RS-P6] ${passed ? 'PASS' : 'FAIL'} - ${captured.checks.filter((entry) => entry.passed).length}/${captured.checks.length} canonical checks`);
  if (!passed) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`[G0-RS-P6] FAIL - ${error.code || error.message}`);
    if (process.argv.includes('--verbose')) {
      console.error(error.stack || error);
      if (error.detail) console.error(JSON.stringify(error.detail, null, 2));
    }
    process.exitCode = 1;
  });
}
