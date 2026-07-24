'use strict';

const crypto = require('crypto');
const contract = require('./g0/reproducibility-lab.json');

const REPRODUCIBILITY_LAB_VERSION = 1;

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function validateReplayCorpus(cases = []) {
  const issues = [];
  const ids = new Set();
  const kinds = new Set();
  for (const entry of cases) {
    if (!entry?.caseId || ids.has(entry.caseId)) issues.push(`case_id_invalid:${entry?.caseId || 'missing'}`);
    ids.add(entry?.caseId);
    kinds.add(entry?.kind);
    if (!contract.corpusCaseKinds.includes(entry?.kind)) issues.push(`case_kind_invalid:${entry?.caseId || 'missing'}`);
    for (const field of contract.requiredFingerprintFields) {
      if (!(field in (entry?.fingerprints || {}))) issues.push(`fingerprint_missing:${entry?.caseId || 'missing'}:${field}`);
    }
    if (!Array.isArray(entry?.artifacts) || entry.artifacts.length === 0) issues.push(`artifacts_missing:${entry?.caseId || 'missing'}`);
  }
  for (const kind of contract.corpusCaseKinds) {
    if (!kinds.has(kind)) issues.push(`corpus_kind_missing:${kind}`);
  }
  return Object.freeze({ ok: issues.length === 0, issues: Object.freeze(issues), caseCount: cases.length });
}

function compareArtifact(expected = {}, actual = {}) {
  const mode = expected.comparisonMode;
  if (!contract.artifactComparisonModes.includes(mode)) {
    return Object.freeze({ mode: mode || null, matched: false, driftKind: 'unknown', reason: 'comparison_mode_invalid' });
  }
  if (mode === 'deterministic') {
    const matched = Boolean(expected.sha256 && actual.sha256 && expected.sha256 === actual.sha256);
    return Object.freeze({ mode, matched, driftKind: matched ? null : 'artifact_drift' });
  }
  if (mode === 'tolerance_based') {
    const expectedValues = expected.values || [];
    const actualValues = actual.values || [];
    if (expectedValues.length !== actualValues.length || expectedValues.some((value) => !Number.isFinite(value)) || actualValues.some((value) => !Number.isFinite(value))) {
      return Object.freeze({ mode, matched: false, driftKind: 'unknown', reason: 'numeric_shape_or_value_invalid' });
    }
    const absolute = Number(expected.tolerance?.absolute ?? 0);
    const relative = Number(expected.tolerance?.relative ?? 0);
    const deltas = expectedValues.map((value, index) => Math.abs(actualValues[index] - value));
    const matched = deltas.every((delta, index) => delta <= Math.max(absolute, Math.abs(expectedValues[index]) * relative));
    return Object.freeze({ mode, matched, driftKind: matched ? null : 'artifact_drift', maxAbsoluteDelta: deltas.length ? Math.max(...deltas) : 0 });
  }
  const expectedClaims = [...new Set((expected.claims || []).map((item) => `${item.claimId}:${item.evidenceRef}`))].sort();
  const actualClaims = [...new Set((actual.claims || []).map((item) => `${item.claimId}:${item.evidenceRef}`))].sort();
  const matched = canonical(expectedClaims) === canonical(actualClaims);
  return Object.freeze({ mode, matched, driftKind: matched ? null : 'scientific_conclusion_drift', wordingIgnored: true });
}

function classifyDrift(drifts = []) {
  if (drifts.length === 0) return 'compatible';
  if (drifts.some((item) => contract.scientificallyMaterialKinds.includes(item.kind) || item.scientificallyMaterial === true)) return 'scientifically_material';
  if (drifts.some((item) => item.kind === 'unknown' || item.classification === 'unknown')) return 'unknown';
  if (drifts.every((item) => item.expected === true)) return 'expected';
  return 'compatible';
}

function buildDriftReport({
  replayCaseId,
  sourceDigest,
  targetDigest,
  contextDrifts = [],
  artifactComparisons = [],
} = {}) {
  const artifactDrifts = artifactComparisons
    .filter((item) => item?.matched === false)
    .map((item) => ({ kind: item.driftKind || 'unknown', artifactId: item.artifactId || null }));
  const drifts = [...contextDrifts, ...artifactDrifts];
  const report = {
    reproducibilityLabVersion: REPRODUCIBILITY_LAB_VERSION,
    replayCaseId: replayCaseId || null,
    sourceDigest: sourceDigest || null,
    targetDigest: targetDigest || null,
    classification: classifyDrift(drifts),
    reviewRequired: classifyDrift(drifts) === 'scientifically_material' || classifyDrift(drifts) === 'unknown',
    contextDrifts,
    artifactComparisons,
  };
  return Object.freeze({ ...report, reportHash: digest(report) });
}

module.exports = {
  REPRODUCIBILITY_LAB_VERSION,
  contract,
  validateReplayCorpus,
  compareArtifact,
  classifyDrift,
  buildDriftReport,
};
