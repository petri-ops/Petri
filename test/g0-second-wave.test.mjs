import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const g0 = require('../core/shared-backend/g0-baseline');
const science = require('../core/shared-backend/g0-scientific-accuracy');
const replayLab = require('../core/shared-backend/g0-reproducibility-lab');
const truth = require('../core/shared-backend/g0-truth-projection');
const { createDeliveryManifest } = require('../core/shared-backend/delivery-manifest');
const corpus = JSON.parse(fs.readFileSync(new URL('./fixtures/g0-second-wave/replay-corpus.json', import.meta.url), 'utf8'));

function scientificInput(overrides = {}) {
  return {
    method: { id: 'deseq2', version: '1', applicable: true, design: '~ condition', contrast: 'treatment-control' },
    assumptions: [{ id: 'sample-independence', satisfied: true }],
    evidenceLevel: 'validated',
    sampleMatch: true,
    statistics: {
      adjustedP: 0.01,
      alpha: 0.05,
      multipleTesting: 'benjamini-hochberg',
      unit: 'log2_fold_change',
      direction: 'increase',
    },
    power: { status: 'adequate' },
    ...overrides,
  };
}

function jobWithScience(scientificValidation) {
  return {
    id: 'job_lf3',
    tool_id: 'deseq2',
    status: 'completed',
    result_json: JSON.stringify({
      artifactTruth: { status: 'valid', blocking: false },
      scientificValidation,
      artifacts: [{
        id: 'deg',
        type: 'table',
        label: 'DEG',
        filename: 'deg.csv',
        path: '/project/results/deg.csv',
        provenance: { provenanceHash: 'p'.repeat(64) },
      }],
      executionProvenance: {
        script: { snapshotPath: '/project/repro/run.R', sha256: 's'.repeat(64) },
        artifacts: [{ id: 'deg', filename: 'deg.csv', sha256: 'a'.repeat(64) }],
      },
    }),
  };
}

const taskRecord = {
  task_id: 'task_lf3',
  version: 1,
  spec_hash: 't'.repeat(64),
  project_id: 'project_lf3',
  conversation_id: 'conversation_lf3',
  spec: {
    method: { id: 'deseq2' },
    inputs: [],
    requestedDeliverables: ['deg'],
  },
};

test('maintained v1 retains LF3/LF4 contracts', () => {
  const validation = g0.validateG0BaselineBundle();
  assert.equal(validation.ok, true, validation.issues.join('\n'));
  assert.ok(g0.parseMajor(g0.manifest.baselineVersion) >= 1);
  assert.equal(g0.manifest.qualificationStatus, 'qualified');
  assert.equal(g0.scientificAccuracy.contractVersion, 1);
  assert.equal(g0.reproducibilityLab.contractVersion, 1);
});

test('LF3 contract fixes scientific integrity boundaries', () => {
  assert.equal(science.validateScientificAccuracyContract().ok, true);
  assert.ok(science.contract.prohibited.includes('retry_until_significant'));
  assert.ok(science.contract.requiredChecks.includes('multiple_testing'));
});

test('LF3 valid evidence produces a stable passed result', () => {
  const result = science.evaluateScientificAccuracy(scientificInput());
  assert.equal(result.outcome, 'valid');
  assert.equal(result.truthStatus, 'passed');
  assert.equal(result.blocking, false);
  assert.match(result.evidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(result.evidenceHash, science.evaluateScientificAccuracy(scientificInput()).evidenceHash);
});

test('LF3 non-significant is a valid scientific outcome, not an execution failure', () => {
  const result = science.evaluateScientificAccuracy(scientificInput({
    statistics: { ...scientificInput().statistics, adjustedP: 0.72, direction: 'none' },
  }));
  assert.equal(result.outcome, 'not_significant');
  assert.equal(result.truthStatus, 'passed');
  assert.equal(result.conclusionCode, 'no_supported_effect_at_declared_threshold');
});

test('LF3 low power and contradictory evidence require review without inventing success', () => {
  const lowPower = science.evaluateScientificAccuracy(scientificInput({ power: { status: 'low' } }));
  assert.equal(lowPower.outcome, 'low_power');
  assert.equal(lowPower.truthStatus, 'needs_review');
  assert.equal(lowPower.blocking, false);
  const contradiction = science.evaluateScientificAccuracy(scientificInput({
    contradictoryEvidence: [{ evidenceRef: 'replicate-2', direction: 'decrease' }],
  }));
  assert.equal(contradiction.outcome, 'contradictory');
  assert.equal(contradiction.truthStatus, 'needs_review');
});

test('LF3 missing design, invalid statistics and violated assumptions block delivery', () => {
  assert.equal(science.evaluateScientificAccuracy(scientificInput({
    method: { id: 'deseq2', applicable: true },
  })).outcome, 'missing_design');
  assert.equal(science.evaluateScientificAccuracy(scientificInput({
    assumptions: [{ id: 'replication', satisfied: false }],
  })).outcome, 'assumption_violation');
  assert.equal(science.evaluateScientificAccuracy(scientificInput({
    statistics: { ...scientificInput().statistics, adjustedP: 2 },
  })).outcome, 'invalid_statistics');
});

test('LF3 distinguishes engineering repair from scientific design change', () => {
  assert.equal(science.classifyScientificChange(['columnAlias', 'outputFilename']).classification, 'engineering_repair');
  const design = science.classifyScientificChange(['contrast']);
  assert.equal(design.classification, 'scientific_design_change');
  assert.equal(design.confirmationRequired, true);
  assert.equal(science.classifyScientificChange(['unclassifiedField']).classification, 'requires_review');
});

test('LF3 result is consumed by the existing Truth Projection and DeliveryManifest', () => {
  const scientificValidation = science.evaluateScientificAccuracy(scientificInput({ power: { status: 'low' } }));
  const job = jobWithScience(scientificValidation);
  const projection = truth.buildTruthProjection({
    job,
    deliveryManifest: { status: 'degraded', manifestHash: 'd'.repeat(64) },
  });
  assert.equal(projection.status, 'needs_review');
  assert.equal(projection.completionAllowed, false);
  const delivery = createDeliveryManifest({ taskRecord, job, projectRoot: '/project' });
  assert.equal(delivery.status, 'degraded');
  assert.equal(delivery.scientificValidation.outcome, 'low_power');
});

test('LF3 blocked scientific validation blocks existing DeliveryManifest', () => {
  const blocked = science.evaluateScientificAccuracy(scientificInput({
    method: { id: 'deseq2', applicable: true },
  }));
  const delivery = createDeliveryManifest({ taskRecord, job: jobWithScience(blocked), projectRoot: '/project' });
  assert.equal(delivery.status, 'blocked');
  assert.equal(delivery.truthProjection.status, 'blocked');
});

test('LF4 corpus covers normal, boundary, negative, contradictory, failure, legacy and sanitized real cases', () => {
  const validation = replayLab.validateReplayCorpus(corpus);
  assert.equal(validation.ok, true, validation.issues.join('\n'));
  assert.equal(validation.caseCount, 7);
  assert.ok(corpus.filter((entry) => entry.incidentRef).length >= 3);
});

test('LF4 deterministic artifacts compare exact content hashes', () => {
  const expected = corpus[0].artifacts[0];
  assert.equal(replayLab.compareArtifact(expected, { sha256: expected.sha256 }).matched, true);
  assert.equal(replayLab.compareArtifact(expected, { sha256: 'f'.repeat(64) }).matched, false);
});

test('LF4 tolerance artifacts respect declared numeric bounds', () => {
  const expected = corpus[1].artifacts[0];
  assert.equal(replayLab.compareArtifact(expected, { values: [0.0500005] }).matched, true);
  assert.equal(replayLab.compareArtifact(expected, { values: [0.06] }).matched, false);
});

test('LF4 narrative comparison ignores wording and compares claims plus evidence', () => {
  const expected = corpus[2].artifacts[0];
  const sameClaims = { claims: [{ claimId: 'no_supported_effect', evidenceRef: 'stat-1', wording: 'different prose' }] };
  assert.equal(replayLab.compareArtifact(expected, sameClaims).matched, true);
  const changedEvidence = { claims: [{ claimId: 'effect_supported', evidenceRef: 'stat-1' }] };
  const comparison = replayLab.compareArtifact(expected, changedEvidence);
  assert.equal(comparison.matched, false);
  assert.equal(comparison.driftKind, 'scientific_conclusion_drift');
});

test('LF4 Drift Report makes input, parameter and conclusion drift scientifically material', () => {
  const report = replayLab.buildDriftReport({
    replayCaseId: 'case-1',
    sourceDigest: 'a'.repeat(64),
    targetDigest: 'b'.repeat(64),
    contextDrifts: [{ kind: 'parameter_drift' }],
  });
  assert.equal(report.classification, 'scientifically_material');
  assert.equal(report.reviewRequired, true);
  assert.match(report.reportHash, /^[a-f0-9]{64}$/);
});

test('LF4 expected, compatible and unknown drift remain distinguishable', () => {
  assert.equal(replayLab.classifyDrift([{ kind: 'environment_drift', expected: true }]), 'expected');
  assert.equal(replayLab.classifyDrift([{ kind: 'environment_drift' }]), 'compatible');
  assert.equal(replayLab.classifyDrift([{ kind: 'unknown' }]), 'unknown');
});
