import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  P6_SERVICE_FIXTURE_BUDGETS,
  P6_SERVICE_FIXTURE_CLASSIFICATION,
  P6_SERVICE_FIXTURE_SOURCE_FILES,
  assertP6ServiceFixtureEvidenceWritable,
  assertSanitizedP6ServiceFixtureEvidence,
  buildP6ServiceFixtureChecks,
  buildPressurePng,
  getP6ServiceFixtureSourceBinding,
  verifyStoredP6ServiceFixtureEvidence,
  writeP6ServiceFixtureEvidence,
} from '../scripts/g0-rs-p6-recovery-acceptance.mjs';

const evidencePath = path.resolve('acceptance/g0-result-studio/rs-p6-service-recovery-pressure-checkpoint.json');

function passingRuntime() {
  return {
    runtime: {
      classification: 'synthetic_service_integration_fixture_with_disposable_truth_stores',
      providerClaim: false,
      packagedElectronClaim: false,
      electronProductBudgetClaim: false,
      p6QualificationClaim: false,
      qualificationEligible: false,
    },
    recovery: {
      elapsedMs: 1,
      afterStatus: 'ready',
      afterInterruptedCount: 0,
      afterPendingDecisionCount: 1,
      incompleteRunningClosed: true,
      draftClosed: true,
      previewPreserved: true,
      currentRefRestored: true,
      checkpointsPreserved: true,
      restartInspectionMs: 1,
      restartedInspection: {
        status: 'ready',
        pendingDecisionCount: 1,
        consistencyStatus: 'consistent',
        checkpointIntegrityMatches: true,
      },
    },
    drift: {
      artifactModificationBlocked: true,
      conflictingRefBlocked: true,
      corruptCheckpointBlocked: true,
    },
    pressure: {
      revisionCount: 205,
      largeTableRows: 100_000,
      tableRowsRead: 100_000,
      svgElementCount: 5_000,
      pngPixels: 1024 * 768,
      longReportBytes: 1024 * 1024,
      physicalHashesExact: true,
      jobTruthExact: true,
      tableTraversalMs: 1,
      tablePageP95Ms: 1,
      serviceTraversalHeapGrowthBytes: 1,
    },
    storage: {
      gcArtifactDeletionCount: 0,
      revisionCountBeforeGc: 205,
      revisionCountAfterGc: 205,
      dedupStrategy: 'copy_on_write_clone',
      dedupClonePrimitives: ['copyfile_ficlone_force'],
      dedupClonedCount: 201,
      dedupHardLinkCount: 0,
      dedupInodeIsolation: true,
      dedupMutationIsolation: true,
      deduplicableBytesBefore: 100,
      deduplicableBytesAfter: 100,
      inspectionMs: 1,
    },
    resourceBudget: {
      memoryDecision: 'blocked',
      diskDecision: 'blocked',
      scientificParametersChanged: false,
    },
  };
}

function passingEvidence(overrides = {}) {
  const runtime = passingRuntime();
  return {
    schemaVersion: 1,
    qualificationEligible: false,
    classification: P6_SERVICE_FIXTURE_CLASSIFICATION,
    sourceFiles: P6_SERVICE_FIXTURE_SOURCE_FILES,
    sourceCommitMatchesSourceHashes: true,
    sourceBindingStableDuringObservation: true,
    sourceMismatches: [],
    runtime,
    checks: buildP6ServiceFixtureChecks(runtime),
    passed: true,
    ...overrides,
  };
}

test('P6-1a service fixture source binding owns recovery, lease, UI explainability and impact-map sentinels', () => {
  const required = [
    'scripts/g0-rs-p6-recovery-acceptance.mjs',
    'test/g0-rs-p6-recovery-acceptance.test.mjs',
    'core/shared-backend/result-studio-lifecycle.js',
    'core/shared-backend/result-studio-background.js',
    'core/shared-backend/result-studio-background-child.js',
    'core/shared-backend/result-studio-runtime-lease.js',
    'core/shared-backend/result-changeset-service.js',
    'test/result-changeset-service.test.mjs',
    'core/petri-server/routes/result-studio.js',
    'test/result-studio-route-baseline.test.mjs',
    'frontend/src/components/result-studio/ResultStudioChangeSetPanel.tsx',
    'frontend/src/components/result-studio/ResultStudioChangeSetPanel.test.tsx',
    'test/impact-map.json',
  ];
  const paths = new Set(Object.values(P6_SERVICE_FIXTURE_SOURCE_FILES));
  required.forEach((relative) => assert.ok(paths.has(relative), `missing ${relative}`));
  assert.equal(paths.size, Object.keys(P6_SERVICE_FIXTURE_SOURCE_FILES).length);
  const binding = getP6ServiceFixtureSourceBinding();
  assert.match(binding.sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(binding.bindingDigest, /^[a-f0-9]{64}$/);
  assert.equal(Object.keys(binding.sourceHashes).length, paths.size);
});

test('P6-1a uses service-fixture commands and a non-acceptance impact rule', () => {
  const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8'));
  assert.equal(packageJson.scripts['g0:result-studio:p6:recovery'], undefined);
  assert.match(
    packageJson.scripts['g0:result-studio:p6:service-fixture:update'],
    /g0-rs-p6-recovery-acceptance\.mjs --write-evidence$/,
  );
  const impactMap = JSON.parse(readFileSync(path.resolve('test/impact-map.json'), 'utf8'));
  const rule = impactMap.rules.find((item) => item.id === 'p6-service-recovery-pressure-fixture');
  assert.ok(rule);
  assert.match(rule.note, /non-qualifying P6-1a synthetic service fixture/);
  assert.match(rule.note, /does not represent full P6 product acceptance/);
  assert.deepEqual(rule.patterns, [
    'scripts/g0-rs-p6-recovery-acceptance.mjs',
    'acceptance/g0-result-studio/rs-p6-service-recovery-pressure-checkpoint.json',
  ]);
});

test('P6-1a pressure PNG is a real 1024x768 RGBA bitmap and service budgets are frozen', () => {
  const png = buildPressurePng();
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 768);
  assert.equal(png[24], 8);
  assert.equal(png[25], 6);
  assert.deepEqual(P6_SERVICE_FIXTURE_BUDGETS, {
    backgroundRecoveryMs: 30_000,
    backgroundInspectionMs: 5_000,
    fullTableTraversalMs: 8_000,
    tablePageP95Ms: 100,
    storageInspectionMs: 2_000,
    serviceTraversalHeapGrowthBytes: 128 * 1024 * 1024,
  });
});

test('P6-1a service fixture sanitizer rejects runtime coordinates, internal ids and secret-shaped data', () => {
  assert.equal(assertSanitizedP6ServiceFixtureEvidence(passingEvidence()), true);
  for (const unsafe of [
    { endpoint: 'http://127.0.0.1:3001' },
    { workspace: '/Users/example/private' },
    { item: 'rev_private' },
    { apiKey: 'private' },
    { relative: '../outside' },
  ]) {
    assert.throws(() => assertSanitizedP6ServiceFixtureEvidence(unsafe), /unsafe|leaked/);
  }
});

test('P6-1a writer refuses failed, drifting or unbound fixture checkpoints', () => {
  const writes = [];
  const receipt = writeP6ServiceFixtureEvidence(passingEvidence(), {
    makeDirectory() {},
    write: (...args) => writes.push(args),
  });
  assert.equal(writes.length, 1);
  assert.match(writes[0][0], /rs-p6-service-recovery-pressure-checkpoint\.json$/);
  assert.equal(receipt.bytes, Buffer.byteLength(writes[0][1]));
  assert.match(receipt.digest, /^[a-f0-9]{64}$/);
  assert.throws(
    () => assertP6ServiceFixtureEvidenceWritable(passingEvidence({ passed: false })),
    (error) => error.code === 'p6_service_fixture_not_passed',
  );
  assert.throws(
    () => assertP6ServiceFixtureEvidenceWritable(passingEvidence({ sourceCommitMatchesSourceHashes: false })),
    (error) => error.code === 'p6_service_fixture_source_binding_not_current',
  );
  assert.throws(
    () => assertP6ServiceFixtureEvidenceWritable(passingEvidence({ sourceBindingStableDuringObservation: false })),
    (error) => error.code === 'p6_service_fixture_source_binding_changed',
  );
});

test('P6-1a checks are recomputed from runtime truth and use only P6S fixture ids', () => {
  const evidence = passingEvidence();
  assert.equal(evidence.checks.length, 20);
  assert.ok(evidence.checks.every((item) => /^P6S-\d{2}$/.test(item.id) && item.passed));
  evidence.runtime.recovery.incompleteRunningClosed = false;
  assert.throws(
    () => verifyStoredP6ServiceFixtureEvidence(evidence),
    (error) => error.code === 'p6_service_fixture_checks_not_recomputed',
  );
  assert.throws(
    () => verifyStoredP6ServiceFixtureEvidence(passingEvidence({
      sourceFiles: { ...P6_SERVICE_FIXTURE_SOURCE_FILES, injected: 'test/injected.test.mjs' },
    })),
    (error) => error.code === 'p6_service_fixture_source_map_invalid',
  );
  const providerClaim = passingEvidence();
  providerClaim.runtime.runtime.providerClaim = true;
  assert.throws(
    () => verifyStoredP6ServiceFixtureEvidence(providerClaim),
    (error) => error.code === 'p6_service_fixture_runtime_boundary_invalid',
  );
});

test('stored P6-1a service fixture checkpoint remains source-bound and 20/20', {
  skip: !existsSync(evidencePath) && 'evidence is generated only after the implementation source commit',
}, () => {
  assert.equal(verifyStoredP6ServiceFixtureEvidence(JSON.parse(readFileSync(evidencePath, 'utf8'))), true);
});
