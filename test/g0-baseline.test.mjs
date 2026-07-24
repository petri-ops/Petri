import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const g0 = require('../core/shared-backend/g0-baseline');

test('G0 Baseline v1 is maintained, qualified and matches live contract versions', () => {
  const result = g0.validateG0BaselineBundle();
  assert.equal(result.ok, true, result.issues.join('\n'));
  assert.deepEqual(result.issues, []);
  assert.equal(result.baseline.baselineId, g0.registry.currentBaselineId);
  assert.equal(result.baseline.baselineVersion, '1.0.0');
  assert.equal(result.baseline.lifecycleStatus, 'maintained');
  assert.equal(result.baseline.qualificationStatus, 'qualified');
  assert.match(result.baseline.manifestDigest, /^[a-f0-9]{64}$/);
  assert.match(result.baseline.bundleDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.actualContracts, g0.manifest.contracts);
});

test('G0 Constitution freezes the single execution truth and durable public evidence boundary', () => {
  assert.deepEqual(g0.constitution.executionTruthChain, ['run_tool', 'tool_job', 'artifact_truth']);
  assert.equal(g0.constitution.invariants.length, 8);
  assert.equal(new Set(g0.constitution.invariants.map((item) => item.id)).size, 8);
  assert.equal(g0.constitution.reasoningBoundary.persistHiddenReasoning, false);
  assert.equal(Object.isFrozen(g0.constitution), true);
  assert.equal(Object.isFrozen(g0.constitution.invariants), true);
  assert.throws(() => {
    g0.constitution.invariants.push({ id: 'unsafe' });
  }, TypeError);
});

test('support matrix qualifies only the explicit LF12 scope', () => {
  const groups = ['platforms', 'providers', 'runtimes', 'plugins', 'projectFormats'];
  for (const group of groups) {
    assert.ok(Array.isArray(g0.supportMatrix[group]));
  }
  assert.equal(
    g0.supportMatrix.platforms.find((item) => item.id === 'macos-arm64')?.status,
    'qualified',
  );
  assert.equal(
    g0.supportMatrix.platforms.find((item) => item.id === 'windows-x64')?.status,
    'unavailable',
  );
  assert.equal(g0.supportMatrix.plugins.find((item) => item.id === 'deseq2')?.status, 'qualified');
  assert.equal(g0.supportMatrix.plugins.find((item) => item.id === 'wgcna')?.status, 'experimental');
  assert.equal(g0.supportMatrix.projectFormats.find((item) => item.id === 'g0-major-1')?.status, 'qualified');
});

test('legacy unversioned projects are explicitly adopted without rewriting creator history', () => {
  const result = g0.evaluateProjectBaselineCompatibility({
    createdBaselineId: g0.LEGACY_BASELINE_ID,
    createdBaselineVersion: null,
  });
  assert.equal(result.status, 'compatible');
  assert.equal(result.reason, 'legacy_unversioned_adopted');
  assert.equal(result.executionAllowed, true);
});

test('current baseline projects are executable only with a matching identity digest', () => {
  const current = g0.getCurrentG0Baseline();
  const valid = g0.evaluateProjectBaselineCompatibility({
    createdBaselineId: current.baselineId,
    createdBaselineVersion: current.baselineVersion,
    createdManifestDigest: current.manifestDigest,
    createdBundleDigest: current.bundleDigest,
  });
  assert.equal(valid.status, 'compatible');
  assert.equal(valid.reason, 'current_baseline');
  assert.equal(valid.executionAllowed, true);

  const changedWithoutVersion = g0.evaluateProjectBaselineCompatibility({
    createdBaselineId: current.baselineId,
    createdBaselineVersion: current.baselineVersion,
    createdManifestDigest: 'f'.repeat(64),
  });
  assert.equal(changedWithoutVersion.status, 'blocked');
  assert.equal(changedWithoutVersion.reason, 'baseline_digest_changed_without_version_bump');
  assert.equal(changedWithoutVersion.executionAllowed, false);

  const changedBundleWithoutVersion = g0.evaluateProjectBaselineCompatibility({
    createdBaselineId: current.baselineId,
    createdBaselineVersion: current.baselineVersion,
    createdManifestDigest: current.manifestDigest,
    createdBundleDigest: 'e'.repeat(64),
  });
  assert.equal(changedBundleWithoutVersion.status, 'blocked');
  assert.equal(changedBundleWithoutVersion.reason, 'baseline_bundle_changed_without_version_bump');
  assert.equal(changedBundleWithoutVersion.executionAllowed, false);
});

test('future or malformed project baselines block formal execution instead of silently degrading', () => {
  const future = g0.evaluateProjectBaselineCompatibility({
    createdBaselineId: 'g0-future',
    createdBaselineVersion: '2.0.0',
  });
  assert.equal(future.status, 'blocked');
  assert.equal(future.reason, 'future_baseline_unsupported');
  assert.throws(
    () => g0.assertProjectG0Compatible({
      g0_baseline: {
        compatibilityStatus: future.status,
        compatibilityReason: future.reason,
        executionAllowed: future.executionAllowed,
      },
    }),
    /Project baseline is not executable/,
  );

  const malformed = g0.evaluateProjectBaselineCompatibility({
    createdBaselineId: 'g0-invalid',
    createdBaselineVersion: 'unknown',
  });
  assert.equal(malformed.status, 'blocked');
  assert.equal(malformed.reason, 'project_baseline_version_invalid');
});

test('public G0 summary exposes support claims but no mutable internal object', () => {
  const summary = g0.getPublicG0BaselineSummary();
  assert.equal(summary.baselineId, g0.manifest.baselineId);
  assert.deepEqual(summary.executionTruthChain, ['run_tool', 'tool_job', 'artifact_truth']);
  assert.ok(summary.support.providers.some((item) => item.id === 'deepseek'));
  summary.executionTruthChain.push('unsafe');
  assert.deepEqual(g0.manifest.executionTruthChain, ['run_tool', 'tool_job', 'artifact_truth']);
});
