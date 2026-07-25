import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const g0 = require('../core/shared-backend/g0-baseline');
const qualification = require('../core/shared-backend/g0-baseline-qualification');

const sourceCommit = 'a'.repeat(40);
const generatedAt = '2026-07-24T00:00:00.000Z';

function manifest() {
  return qualification.buildQualificationManifest({ sourceCommit, generatedAt });
}

function entryFor(evidenceClass, overrides = {}) {
  const activeManifest = manifest();
  return {
    evidenceId: `evidence-${evidenceClass}`,
    evidenceClass,
    schemaVersion: 1,
    sourceCommit,
    baselineDigest: activeManifest.bundleDigest,
    platform: 'macos-arm64',
    architecture: 'arm64',
    appMode: evidenceClass === 'packaged_app' ? 'packaged' : 'qualification-harness',
    commandOrEntry: `qualification:${evidenceClass}`,
    generatedAt,
    counts: { passed: 1, failed: 0 },
    hashes: { output: 'b'.repeat(64) },
    boundedResult: 'passed',
    privacyClassification: 'digests_counts_and_status_only',
    applicableClaims: [],
    status: 'passed',
    blockerRefs: [],
    ...overrides,
  };
}

function allEntries() {
  return qualification.contract.requiredEvidenceClasses.map(({ id }) => entryFor(id));
}

function zeroObservations(overrides = {}) {
  const evidenceClasses = qualification.contract.requiredEvidenceClasses.map(({ id }) => id);
  return qualification.contract.zeroToleranceInvariants.map(({ id }, index) => ({
    id,
    violations: overrides[id] || 0,
    evidenceRef: `evidence-${evidenceClasses[index % evidenceClasses.length]}`,
  }));
}

test('LF12 manifest remains bound to the sealed 0.6 subject after v1 promotion', () => {
  const before = g0.getCurrentG0Baseline();
  const result = manifest();
  const after = g0.getCurrentG0Baseline();

  assert.equal(before.baselineId, 'g0-baseline-v1');
  assert.equal(before.lifecycleStatus, 'maintained');
  assert.equal(before.qualificationStatus, 'qualified');
  assert.equal(result.subjectBaselineId, 'g0-fifth-wave-establishing-0.6');
  assert.equal(result.subjectBaselineVersion, '0.6.0');
  assert.equal(result.subjectLifecycleStatus, 'maintained');
  assert.equal(result.subjectQualificationStatus, 'qualified');
  assert.equal(result.bundleDigest, g0.manifest.qualification.qualifiedFrom.bundleDigest);
  assert.notEqual(result.bundleDigest, before.bundleDigest);
  assert.deepEqual(after, before);
  assert.equal(result.qualificationScope.platform, 'macos-arm64');
});

test('LF12 empty evidence stays not_yet_qualified with explicit mandatory blockers', () => {
  const activeManifest = manifest();
  const ledger = qualification.buildEvidenceLedger({ manifest: activeManifest });
  const decision = qualification.evaluateQualificationDecision({ manifest: activeManifest, ledger });

  assert.equal(decision.state, 'not_yet_qualified');
  assert.equal(decision.modelMayDecide, false);
  assert.ok(decision.blockers.some((item) => item.startsWith('mandatory_evidence_missing:')));
  assert.equal(Object.values(ledger.classStatus).every((status) => status === 'missing'), true);
});

test('LF12 qualifies only when every mandatory class is fresh and every zero-tolerance count is zero', () => {
  const activeManifest = manifest();
  const ledger = qualification.buildEvidenceLedger({
    manifest: activeManifest,
    entries: allEntries(),
    zeroToleranceObservations: zeroObservations(),
  });
  const decision = qualification.evaluateQualificationDecision({ manifest: activeManifest, ledger });

  assert.equal(Object.values(ledger.classStatus).every((status) => status === 'satisfied'), true);
  assert.equal(decision.state, 'qualified', decision.blockers.join('\n'));
  assert.deepEqual(decision.blockers, []);
  assert.equal(decision.satisfiedClaims.length, qualification.contract.supportClaims.length);
  assert.equal(decision.limitedClaims.length, 0);
  assert.equal(decision.unsupportedClaims.length, 0);
});

test('LF12 derives freshness from bundle and source ancestry instead of trusting caller labels', () => {
  const activeManifest = manifest();
  const ancestorCommit = 'c'.repeat(40);
  const entries = allEntries();
  entries[0] = entryFor(entries[0].evidenceClass, {
    sourceCommit: ancestorCommit,
    freshnessStatus: 'fresh',
  });

  const unverifiable = qualification.buildEvidenceLedger({ manifest: activeManifest, entries });
  assert.equal(unverifiable.entries[0].freshnessStatus, 'unverifiable');
  assert.notEqual(unverifiable.classStatus[entries[0].evidenceClass], 'satisfied');

  const verified = qualification.buildEvidenceLedger({
    manifest: activeManifest,
    entries,
    verifySourceCommit: (candidate) => candidate === ancestorCommit,
  });
  assert.equal(verified.entries[0].freshnessStatus, 'fresh');
  assert.equal(verified.classStatus[entries[0].evidenceClass], 'satisfied');

  entries[1] = entryFor(entries[1].evidenceClass, { baselineDigest: 'd'.repeat(64) });
  const stale = qualification.buildEvidenceLedger({ manifest: activeManifest, entries });
  assert.equal(stale.entries[1].freshnessStatus, 'stale');
});

test('LF12 zero-tolerance violation produces blocked instead of pending', () => {
  const activeManifest = manifest();
  const ledger = qualification.buildEvidenceLedger({
    manifest: activeManifest,
    entries: allEntries(),
    zeroToleranceObservations: zeroObservations({ 'ZT-01': 1 }),
  });
  const decision = qualification.evaluateQualificationDecision({ manifest: activeManifest, ledger });

  assert.equal(decision.state, 'blocked');
  assert.deepEqual(decision.zeroToleranceViolations, ['ZT-01']);
  assert.ok(decision.blockers.includes('zero_tolerance_violation:ZT-01'));
});

test('LF12 never treats an unobserved zero-tolerance invariant as zero violations', () => {
  const activeManifest = manifest();
  const ledger = qualification.buildEvidenceLedger({
    manifest: activeManifest,
    entries: allEntries(),
    zeroToleranceObservations: zeroObservations().slice(1),
  });
  const decision = qualification.evaluateQualificationDecision({ manifest: activeManifest, ledger });

  assert.equal(decision.state, 'not_yet_qualified');
  assert.ok(decision.blockers.includes('zero_tolerance_unobserved:ZT-01'));
});

test('LF12 requires every zero-tolerance observation to cite fresh passing evidence', () => {
  const activeManifest = manifest();
  const observations = zeroObservations();
  observations[0] = { ...observations[0], evidenceRef: 'missing-evidence' };
  const ledger = qualification.buildEvidenceLedger({
    manifest: activeManifest,
    entries: allEntries(),
    zeroToleranceObservations: observations,
  });
  const decision = qualification.evaluateQualificationDecision({ manifest: activeManifest, ledger });

  assert.ok(ledger.zeroToleranceIntegrityIssues.includes(
    'zero_tolerance_evidence_ref_not_fresh_passing:ZT-01'
  ));
  assert.equal(decision.state, 'blocked');
});

test('LF12 rejects duplicate, credential, URL and absolute-path evidence', () => {
  const activeManifest = manifest();
  const secret = entryFor('constitution_baseline', {
    boundedResult: 'Bearer abcdefghijklmnopqrstuvwxyz',
    commandOrEntry: 'https://private.invalid/qualification',
    hashes: { local: '/Users/person/private/result.json' },
  });
  const entries = [secret, { ...secret }];
  const ledger = qualification.buildEvidenceLedger({ manifest: activeManifest, entries });
  const decision = qualification.evaluateQualificationDecision({ manifest: activeManifest, ledger });

  assert.equal(ledger.invalidEntryCount, 2);
  assert.ok(ledger.entries[0].integrityIssues.includes('evidence_contains_credential'));
  assert.ok(ledger.entries[0].integrityIssues.includes('evidence_contains_url'));
  assert.ok(ledger.entries[0].integrityIssues.includes('evidence_contains_absolute_user_path'));
  assert.ok(ledger.entries[1].integrityIssues.includes('evidence_id_duplicate'));
  assert.equal(decision.state, 'blocked');
});

test('RS9 requalification keeps deterministic unsupported scope while promoting Result Studio editing', () => {
  const activeManifest = manifest();
  const args = {
    manifest: activeManifest,
    entries: allEntries(),
    zeroToleranceObservations: zeroObservations(),
  };
  const firstLedger = qualification.buildEvidenceLedger(args);
  const secondLedger = qualification.buildEvidenceLedger(args);
  const first = qualification.evaluateQualificationDecision({ manifest: activeManifest, ledger: firstLedger });
  const second = qualification.evaluateQualificationDecision({ manifest: activeManifest, ledger: secondLedger });

  assert.equal(firstLedger.ledgerHash, secondLedger.ledgerHash);
  assert.equal(first.decisionHash, second.decisionHash);
  assert.equal(qualification.contract.excludedClaims.some(({ id }) => id === 'result-studio-editing'), false);
  assert.ok(qualification.contract.supportClaims.some(({ id }) => id === 'result-studio-editing'));
  assert.ok(qualification.contract.excludedClaims.some(({ id }) => id === 'windows-support'));
  assert.equal(g0.manifest.executionTruthChain.join(','), 'run_tool,tool_job,artifact_truth');
});
