import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const g0 = require('../core/shared-backend/g0-baseline');
const supply = require('../core/shared-backend/g0-capability-supply-chain');
const permission = require('../core/shared-backend/g0-security-permission');
const resilience = require('../core/shared-backend/g0-resilience-lab');

const descriptor = {
  pluginId: 'deseq2', version: '1.0.0', sourcePolicy: 'builtin-canonical',
  manifestHash: 'a'.repeat(64), runtimeHash: 'b'.repeat(64), scriptHash: 'c'.repeat(64), packageHash: 'd'.repeat(64),
  platform: 'darwin-arm64', failureModes: ['bad_input'], validators: ['deg'], artifacts: ['table'],
};

test('fourth-wave baseline remains establishing and closes LF7/LF8/LF10 contracts', () => {
  const validation = g0.validateG0BaselineBundle();
  assert.equal(validation.ok, true, validation.issues.join('\n'));
  assert.ok(Number(g0.manifest.baselineVersion.split('.')[1]) >= 5);
  assert.equal(g0.manifest.qualificationStatus, 'not_yet_qualified');
  assert.equal(g0.capabilitySupplyChain.contractVersion, 2);
  assert.equal(g0.securityPermissionMatrix.contractVersion, 2);
  assert.equal(g0.resilienceLab.contractVersion, 1);
});

test('LF7 descriptor requires canonical identity, hashes, failures, validators and artifacts', () => {
  assert.equal(supply.validateCapabilityDescriptor(descriptor).ok, true);
  const invalid = supply.validateCapabilityDescriptor({ ...descriptor, scriptHash: null, validators: [] });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.missing.includes('scriptHash'));
  assert.ok(invalid.missing.includes('validators'));
});

test('LF7 upgrade requires verified platform and non-material Replay drift', () => {
  const allowed = supply.assessCapabilityUpgrade({ previous: descriptor, next: { ...descriptor, version: '1.1.0' }, currentPlatform: 'darwin-arm64', replayReport: { classification: 'compatible' } });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.createsSecondLedger, false);
  assert.equal(supply.assessCapabilityUpgrade({ previous: descriptor, next: { ...descriptor, version: '2.0.0' }, currentPlatform: 'darwin-arm64', replayReport: { classification: 'scientifically_material' } }).allowed, false);
  assert.equal(supply.assessCapabilityUpgrade({ previous: descriptor, next: descriptor, currentPlatform: 'win32-x64', replayReport: { classification: 'compatible' } }).allowed, false);
});

test('LF8 full access automatically permits bounded reversible project actions', () => {
  const decision = permission.evaluatePermissionAction({ mode: 'full', dimension: 'command', projectScoped: true, reversible: true, risk: 'low' });
  assert.equal(decision.decision, 'auto');
  assert.equal(decision.auditRequired, true);
});

test('LF8 full access still blocks cross-project, credential, source overwrite and privilege risks', () => {
  for (const boundary of ['credential_exposure', 'scientific_source_overwrite', 'privilege_escalation', 'remote_push', 'remote_script_pipe']) {
    assert.equal(permission.evaluatePermissionAction({ mode: 'full', dimension: 'command', boundary }).decision, 'block');
  }
  assert.equal(permission.evaluatePermissionAction({ mode: 'full', dimension: 'filesystem', projectScoped: false }).decision, 'block');
});

test('LF8 irreversible and external actions require confirmation outside hard blocks', () => {
  assert.equal(permission.evaluatePermissionAction({ mode: 'full', dimension: 'external_application', externalSideEffect: true }).decision, 'confirm');
  assert.equal(permission.evaluatePermissionAction({ mode: 'full', dimension: 'filesystem', reversible: false }).decision, 'confirm');
  assert.equal(permission.evaluatePermissionAction({ mode: 'read', dimension: 'command' }).decision, 'block');
});

test('LF10 fault matrix covers all eight domains and bounded outcomes', () => {
  const result = resilience.validateFaultMatrix();
  assert.equal(result.ok, true, result.issues.join('\n'));
  assert.equal(result.faultCount, 8);
  assert.deepEqual(new Set(resilience.contract.faults.map((item) => item.domain)), new Set(resilience.contract.faultDomains));
});

test('LF10 every declared fault passes only with honest outcome and preserved evidence', () => {
  for (const fault of resilience.contract.faults) {
    const result = resilience.evaluateFault({ faultId: fault.id, observed: { outcome: fault.expected, falseSuccess: false, auditPreserved: true, projectIsolated: true, scientificTruthChanged: false, retryCount: 1, retryLimit: 2 } });
    assert.equal(result.passed, true, `${fault.id}: ${result.failures.join(',')}`);
    assert.match(result.evidenceHash, /^[a-f0-9]{64}$/);
  }
});

test('LF10 rejects false success, lost audit, truth changes and unbounded retries', () => {
  const result = resilience.evaluateFault({ faultId: 'provider_timeout', observed: { outcome: 'auto_recovered', falseSuccess: true, auditPreserved: false, projectIsolated: false, scientificTruthChanged: true, retryCount: 5, retryLimit: 2 } });
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures, ['outcome_mismatch', 'false_success', 'audit_missing', 'project_isolation_failed', 'scientific_truth_changed', 'retry_unbounded']);
});
