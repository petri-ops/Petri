'use strict';
const crypto = require('crypto');
const contract = require('./g0/resilience-lab.json');
const RESILIENCE_LAB_VERSION = 1;
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function validateFaultMatrix() {
  const issues = [];
  const domains = new Set(contract.faults.map((item) => item.domain));
  for (const domain of contract.faultDomains) if (!domains.has(domain)) issues.push(`domain_missing:${domain}`);
  for (const fault of contract.faults) if (!contract.allowedOutcomes.includes(fault.expected)) issues.push(`outcome_invalid:${fault.id}`);
  return Object.freeze({ ok: issues.length === 0, issues, faultCount: contract.faults.length });
}

function evaluateFault({ faultId, observed = {} } = {}) {
  const fault = contract.faults.find((item) => item.id === faultId);
  if (!fault) return Object.freeze({ passed: false, outcome: 'blocked', failures: ['fault_unknown'] });
  const failures = [];
  if (observed.outcome !== fault.expected) failures.push('outcome_mismatch');
  if (observed.falseSuccess === true) failures.push('false_success');
  if (observed.auditPreserved !== true) failures.push('audit_missing');
  if (observed.projectIsolated !== true) failures.push('project_isolation_failed');
  if (observed.scientificTruthChanged === true) failures.push('scientific_truth_changed');
  if (observed.retryCount != null && observed.retryLimit != null && observed.retryCount > observed.retryLimit) failures.push('retry_unbounded');
  const result = { faultId, domain: fault.domain, outcome: fault.expected, passed: failures.length === 0, failures };
  return Object.freeze({ ...result, evidenceHash: digest(result) });
}
module.exports = { RESILIENCE_LAB_VERSION, contract, validateFaultMatrix, evaluateFault };
