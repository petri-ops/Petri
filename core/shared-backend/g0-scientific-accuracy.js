'use strict';

const crypto = require('crypto');
const contract = require('./g0/scientific-accuracy.json');

const SCIENTIFIC_ACCURACY_VERSION = 1;

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function finding(code, severity, detail = {}) {
  return Object.freeze({ code, severity, ...detail });
}

function classifyScientificChange(changedFields = []) {
  const scientific = changedFields.filter((field) => contract.scientificDesignFields.includes(field));
  const engineering = changedFields.filter((field) => contract.engineeringRepairFields.includes(field));
  const unknown = changedFields.filter((field) => !scientific.includes(field) && !engineering.includes(field));
  const classification = scientific.length
    ? 'scientific_design_change'
    : unknown.length ? 'requires_review'
      : engineering.length ? 'engineering_repair'
        : 'no_change';
  return Object.freeze({
    classification,
    confirmationRequired: classification === 'scientific_design_change' || classification === 'requires_review',
    scientific,
    engineering,
    unknown,
  });
}

function validateScientificAccuracyContract() {
  const issues = [];
  const outcomes = Object.entries(contract.outcomes || {});
  if (contract.schemaVersion !== 1 || contract.contractVersion !== SCIENTIFIC_ACCURACY_VERSION) issues.push('contract_version_invalid');
  if (outcomes.length < 7) issues.push('outcomes_incomplete');
  for (const [id, value] of outcomes) {
    if (!['passed', 'needs_review', 'blocked'].includes(value.truthStatus)) issues.push(`truth_status_invalid:${id}`);
    if (typeof value.blocking !== 'boolean') issues.push(`blocking_invalid:${id}`);
  }
  if (!contract.prohibited.includes('retry_until_significant')) issues.push('scientific_integrity_prohibition_missing');
  return Object.freeze({ ok: issues.length === 0, issues: Object.freeze(issues) });
}

function evaluateScientificAccuracy({
  method = null,
  assumptions = [],
  evidenceLevel = null,
  sampleMatch = null,
  statistics = null,
  contradictoryEvidence = [],
  power = null,
} = {}) {
  const findings = [];
  if (!method?.id || method.applicable === false) findings.push(finding('method_not_applicable', 'error'));
  if (!method?.design || !method?.contrast) findings.push(finding('design_information_missing', 'error'));

  for (const assumption of assumptions || []) {
    if (assumption?.satisfied === false) findings.push(finding('method_assumption_violated', 'error', { assumptionId: assumption.id || null }));
    else if (assumption?.satisfied == null) findings.push(finding('method_assumption_unverified', 'warning', { assumptionId: assumption?.id || null }));
  }
  if (sampleMatch !== true) findings.push(finding('sample_identity_mismatch_or_unverified', 'error'));
  if (!contract.evidenceLevels.includes(evidenceLevel)) findings.push(finding('evidence_level_invalid', 'error'));

  const adjustedP = statistics?.adjustedP;
  const alpha = statistics?.alpha ?? 0.05;
  if (
    !statistics
    || !Number.isFinite(adjustedP)
    || adjustedP < 0
    || adjustedP > 1
    || !Number.isFinite(alpha)
    || alpha <= 0
    || alpha >= 1
    || !statistics.multipleTesting
  ) findings.push(finding('statistical_semantics_invalid', 'error'));
  if (!statistics?.unit) findings.push(finding('unit_missing', 'error'));
  if (!['increase', 'decrease', 'none', 'mixed'].includes(statistics?.direction)) findings.push(finding('direction_invalid', 'error'));
  if (power?.status === 'low') findings.push(finding('low_statistical_power', 'warning'));
  if ((contradictoryEvidence || []).length > 0) findings.push(finding('contradictory_evidence', 'warning', { count: contradictoryEvidence.length }));

  let outcome = 'valid';
  if (findings.some((item) => item.code === 'design_information_missing')) outcome = 'missing_design';
  else if (findings.some((item) => item.code === 'method_not_applicable' || item.code === 'method_assumption_violated')) outcome = 'assumption_violation';
  else if (findings.some((item) => item.severity === 'error')) outcome = 'invalid_statistics';
  else if (findings.some((item) => item.code === 'contradictory_evidence')) outcome = 'contradictory';
  else if (findings.some((item) => item.code === 'low_statistical_power')) outcome = 'low_power';
  else if (adjustedP >= alpha) outcome = 'not_significant';

  const policy = contract.outcomes[outcome];
  const evidence = {
    scientificAccuracyVersion: SCIENTIFIC_ACCURACY_VERSION,
    method: method ? { id: method.id || null, version: method.version || null, design: method.design || null, contrast: method.contrast || null } : null,
    evidenceLevel,
    statistics: statistics ? {
      adjustedP,
      alpha,
      multipleTesting: statistics.multipleTesting || null,
      unit: statistics.unit || null,
      direction: statistics.direction || null,
    } : null,
    outcome,
    status: policy.truthStatus === 'passed' ? 'valid' : policy.truthStatus === 'needs_review' ? 'degraded' : 'blocked',
    truthStatus: policy.truthStatus,
    blocking: policy.blocking,
    findings,
    conclusionCode: outcome === 'not_significant' ? 'no_supported_effect_at_declared_threshold' : outcome,
  };
  return Object.freeze({ ...evidence, evidenceHash: digest(evidence) });
}

module.exports = {
  SCIENTIFIC_ACCURACY_VERSION,
  contract,
  classifyScientificChange,
  validateScientificAccuracyContract,
  evaluateScientificAccuracy,
};
