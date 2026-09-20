#!/usr/bin/env node

/**
 * Loop Validator Registry — unit tests.
 * Run via: node --test test/loop-validator-registry.test.mjs
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import { VALIDATOR_STATUSES, FINDING_SEVERITIES, registerValidator, setValidatorEnabled, dispatchValidator, findValidatorsForKind, findValidatorsForType, validateArtifact, validateDelivery, aggregateStatus, buildResult, buildUnavailableResult, buildValidResult, normalizeFinding, registerPluginManifest, getPluginValidatorId, listValidators, getValidatorInfo, clearRegistry } from '../core/shared-backend/loop-validator-registry.js';

// Clear and re-register before each test
beforeEach(() => {
  clearRegistry();
});

// ---------------------------------------------------------------------------
// LV-1: registration validation
// ---------------------------------------------------------------------------

describe('LV-1 registration validation', () => {
  it('registerValidator accepts valid def', () => {
    const id = registerValidator({
      id: 'test-v',
      version: '1.0.0',
      applicableKinds: ['table'],
      validate() { return buildValidResult('test-v', '1.0.0'); },
    });
    assert.strictEqual(id, 'test-v');
    assert.strictEqual(listValidators().length, 1);
  });

  it('registerValidator throws on missing id', () => {
    assert.throws(() => {
      registerValidator({ version: '1.0.0', applicableKinds: ['table'], validate() {} });
    }, /validator\.id must be a non-empty string/);
  });

  it('registerValidator throws on missing version', () => {
    assert.throws(() => {
      registerValidator({ id: 't', applicableKinds: ['table'], validate() {} });
    }, /validator\.version must be a non-empty string/);
  });

  it('registerValidator throws on empty applicableKinds', () => {
    assert.throws(() => {
      registerValidator({ id: 't', version: '1.0.0', applicableKinds: [], validate() {} });
    }, /validator\.applicableKinds must be a non-empty array/);
  });

  it('registerValidator throws on non-function validate', () => {
    assert.throws(() => {
      registerValidator({ id: 't', version: '1.0.0', applicableKinds: ['table'] });
    }, /validator\.validate must be a function/);
  });
});

// ---------------------------------------------------------------------------
// LV-2: enable/disable
// ---------------------------------------------------------------------------

describe('LV-2 enable/disable', () => {
  it('setValidatorEnabled toggles state', () => {
    registerValidator({ id: 'e1', version: '1.0.0', applicableKinds: ['table'], validate() {} });
    assert.strictEqual(getValidatorInfo('e1').enabled, true);
    setValidatorEnabled('e1', false);
    assert.strictEqual(getValidatorInfo('e1').enabled, false);
    setValidatorEnabled('e1', true);
    assert.strictEqual(getValidatorInfo('e1').enabled, true);
  });

  it('setValidatorEnabled returns false for unknown id', () => {
    assert.strictEqual(setValidatorEnabled('unknown', false), false);
  });

  it('disabled validator excluded from listValidators', () => {
    registerValidator({ id: 'd1', version: '1.0.0', applicableKinds: ['table'], validate() {} });
    setValidatorEnabled('d1', false);
    assert.strictEqual(listValidators().find((v) => v.id === 'd1'), undefined);
    assert.strictEqual(listValidators({ enabledOnly: false }).find((v) => v.id === 'd1')?.enabled, false);
  });
});

// ---------------------------------------------------------------------------
// LV-3: dispatchValidator
// ---------------------------------------------------------------------------

describe('LV-3 dispatchValidator', () => {
  it('dispatchValidator calls registered validate function', () => {
    registerValidator({
      id: 'disp',
      version: '1.0.0',
      applicableKinds: ['table'],
      validate(_artifact, _ctx) {
        return buildResult({ validatorId: 'disp', version: '1.0.0', status: VALIDATOR_STATUSES.VALID });
      },
    });
    const r = dispatchValidator('disp', { artifact: {} });
    assert.strictEqual(r?.status, VALIDATOR_STATUSES.VALID);
  });

  it('dispatchValidator returns null for unknown id', () => {
    assert.strictEqual(dispatchValidator('unknown', {}), null);
  });

  it('dispatchValidator returns null for disabled validator', () => {
    registerValidator({ id: 'dis2', version: '1.0.0', applicableKinds: ['table'], validate() {}, enabled: false });
    assert.strictEqual(dispatchValidator('dis2', { artifact: {} }), null);
  });

  it('dispatchValidator catches errors and returns unavailable', () => {
    registerValidator({
      id: 'err1',
      version: '1.0.0',
      applicableKinds: ['table'],
      validate() { throw new Error('boom'); },
    });
    const r = dispatchValidator('err1', { artifact: {} });
    assert.strictEqual(r?.status, VALIDATOR_STATUSES.UNAVAILABLE);
    assert.strictEqual(r?.findings[0]?.code, 'VALIDATOR_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// LV-4: findValidatorsForKind / findValidatorsForType
// ---------------------------------------------------------------------------

describe('LV-4 findValidatorsForKind / findValidatorsForType', () => {
  beforeEach(() => {
    registerValidator({ id: 'v1', version: '1.0.0', applicableKinds: ['table'], applicableArtifactTypes: ['csv'], validate() {}, priority: 1 });
    registerValidator({ id: 'v2', version: '1.0.0', applicableKinds: ['table'], applicableArtifactTypes: ['csv'], validate() {}, priority: 2 });
    registerValidator({ id: 'v3', version: '1.0.0', applicableKinds: ['plot'], applicableArtifactTypes: ['png'], validate() {}, priority: 3 });
  });

  it('findValidatorsForKind returns matching validators sorted by priority DESC', () => {
    const found = findValidatorsForKind('table');
    assert.strictEqual(found.length, 2);
    assert.strictEqual(found[0].id, 'v2'); // higher priority first
    assert.strictEqual(found[1].id, 'v1');
  });

  it('findValidatorsForKind is case-insensitive', () => {
    const found = findValidatorsForKind('TABLE');
    assert.strictEqual(found.length, 2);
  });

  it('findValidatorsForKind returns empty for unknown kind', () => {
    assert.deepStrictEqual(findValidatorsForKind('unknown'), []);
  });

  it('findValidatorsForType returns matching validators', () => {
    const found = findValidatorsForType('csv');
    assert.strictEqual(found.length, 2);
  });

  it('disabled validators excluded', () => {
    setValidatorEnabled('v1', false);
    const found = findValidatorsForKind('table');
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].id, 'v2');
  });
});

// ---------------------------------------------------------------------------
// LV-5: validateArtifact
// ---------------------------------------------------------------------------

describe('LV-5 validateArtifact', () => {
  beforeEach(() => {
    registerValidator({
      id: 'tbl',
      version: '1.0.0',
      applicableKinds: ['table'],
      validate() { return buildResult({ validatorId: 'tbl', version: '1.0.0', status: VALIDATOR_STATUSES.VALID }); },
    });
  });

  it('returns UNAVAILABLE for null artifact', () => {
    const r = validateArtifact(null);
    assert.strictEqual(r.overallStatus, VALIDATOR_STATUSES.UNAVAILABLE);
    assert.ok(r.findings.length > 0);
  });

  it('dispatches to applicable validators', () => {
    const r = validateArtifact({ kind: 'table' });
    assert.strictEqual(r.results.length, 1);
    assert.strictEqual(r.results[0].validatorId, 'tbl');
  });

  it('aggregates degraded correctly', () => {
    clearRegistry();
    registerValidator({
      id: 'vA',
      version: '1.0.0',
      applicableKinds: ['table'],
      validate() { return buildResult({ validatorId: 'vA', version: '1.0.0', status: VALIDATOR_STATUSES.VALID }); },
    });
    registerValidator({
      id: 'vB',
      version: '1.0.0',
      applicableKinds: ['table'],
      validate() { return buildResult({ validatorId: 'vB', version: '1.0.0', status: VALIDATOR_STATUSES.DEGRADED }); },
    });
    const r1 = validateArtifact({ kind: 'table' });
    assert.strictEqual(r1.overallStatus, VALIDATOR_STATUSES.DEGRADED);
  });

  it('blocked overrides degraded', () => {
    clearRegistry();
    registerValidator({
      id: 'vC',
      version: '1.0.0',
      applicableKinds: ['table'],
      validate() { return buildResult({ validatorId: 'vC', version: '1.0.0', status: VALIDATOR_STATUSES.DEGRADED }); },
    });
    registerValidator({
      id: 'vD',
      version: '1.0.0',
      applicableKinds: ['table'],
      validate() { return buildResult({ validatorId: 'vD', version: '1.0.0', status: VALIDATOR_STATUSES.BLOCKED }); },
    });
    const r2 = validateArtifact({ kind: 'table' });
    assert.strictEqual(r2.overallStatus, VALIDATOR_STATUSES.BLOCKED);
  });

  it('deduplicates validators from kind + type match', () => {
    clearRegistry();
    registerValidator({
      id: 'dup',
      version: '1.0.0',
      applicableKinds: ['table'],
      applicableArtifactTypes: ['csv'],
      validate() { return buildResult({ validatorId: 'dup', version: '1.0.0', status: VALIDATOR_STATUSES.VALID }); },
    });
    const r = validateArtifact({ kind: 'table', type: 'csv' });
    assert.strictEqual(r.results.length, 1);
  });
});

// ---------------------------------------------------------------------------
// LV-6: aggregateStatus
// ---------------------------------------------------------------------------

describe('LV-6 aggregateStatus', () => {
  it('blocked > degraded > valid/unavailable', () => {
    assert.strictEqual(aggregateStatus([VALIDATOR_STATUSES.BLOCKED, VALIDATOR_STATUSES.VALID]), VALIDATOR_STATUSES.BLOCKED);
    assert.strictEqual(aggregateStatus([VALIDATOR_STATUSES.DEGRADED, VALIDATOR_STATUSES.VALID]), VALIDATOR_STATUSES.DEGRADED);
    assert.strictEqual(aggregateStatus([VALIDATOR_STATUSES.VALID]), VALIDATOR_STATUSES.VALID);
    assert.strictEqual(aggregateStatus([]), VALIDATOR_STATUSES.UNAVAILABLE);
    assert.strictEqual(aggregateStatus([VALIDATOR_STATUSES.UNAVAILABLE, VALIDATOR_STATUSES.VALID]), VALIDATOR_STATUSES.VALID);
    assert.strictEqual(aggregateStatus([VALIDATOR_STATUSES.UNAVAILABLE]), VALIDATOR_STATUSES.UNAVAILABLE);
  });
});

// ---------------------------------------------------------------------------
// LV-7: buildResult / buildUnavailableResult / buildValidResult
// ---------------------------------------------------------------------------

describe('LV-7 buildResult builders', () => {
  it('buildResult creates frozen result', () => {
    const r = buildResult({ validatorId: 'x', version: '1.0.0', status: VALIDATOR_STATUSES.VALID, findings: [] });
    assert.strictEqual(Object.isFrozen(r), true);
    assert.strictEqual(Object.isFrozen(r.findings), true);
  });

  it('buildUnavailableResult has UNAVAILABLE status', () => {
    const r = buildUnavailableResult('x', '1.0.0', 'something failed');
    assert.strictEqual(r.status, VALIDATOR_STATUSES.UNAVAILABLE);
    assert.strictEqual(r.findings[0]?.code, 'VALIDATOR_UNAVAILABLE');
    assert.strictEqual(r.findings[0]?.message, 'something failed');
  });

  it('buildValidResult is valid with empty findings', () => {
    const r = buildValidResult('x', '1.0.0');
    assert.strictEqual(r.status, VALIDATOR_STATUSES.VALID);
    assert.deepStrictEqual(r.findings, []);
  });

  it('normalizeFinding converts strings to finding objects', () => {
    const f = normalizeFinding('simple message');
    assert.strictEqual(f.code, 'INFO');
    assert.strictEqual(f.message, 'simple message');
    assert.strictEqual(f.severity, FINDING_SEVERITIES.WARNING);
  });

  it('normalizeFinding preserves object findings', () => {
    const f = normalizeFinding({ code: 'X', message: 'y', severity: 'error' });
    assert.strictEqual(f.code, 'X');
    assert.strictEqual(f.severity, 'error');
  });
});

// ---------------------------------------------------------------------------
// LV-8: plugin manifest hook
// ---------------------------------------------------------------------------

describe('LV-8 plugin manifest hook', () => {
  it('registerPluginManifest stores and getPluginValidatorId returns it', () => {
    registerPluginManifest({ id: 'my-plugin', validatorId: 'my-validator' });
    assert.strictEqual(getPluginValidatorId('my-plugin'), 'my-validator');
  });

  it('getPluginValidatorId returns null for unknown plugin', () => {
    assert.strictEqual(getPluginValidatorId('unknown'), null);
  });
});

// ---------------------------------------------------------------------------
// LV-9: listValidators / getValidatorInfo
// ---------------------------------------------------------------------------

describe('LV-9 listValidators / getValidatorInfo', () => {
  it('listValidators returns sorted array', () => {
    registerValidator({ id: 'b', version: '1.0.0', applicableKinds: ['t'], validate() {}, priority: 1 });
    registerValidator({ id: 'a', version: '1.0.0', applicableKinds: ['t'], validate() {}, priority: 2 });
    const list = listValidators();
    assert.strictEqual(list[0].id, 'a'); // priority 2 first
    assert.strictEqual(list[1].id, 'b');
  });

  it('getValidatorInfo returns entry or null', () => {
    registerValidator({ id: 'info', version: '2.0.0', applicableKinds: ['t'], validate() {} });
    const info = getValidatorInfo('info');
    assert.strictEqual(info?.id, 'info');
    assert.strictEqual(info?.version, '2.0.0');
    assert.strictEqual(getValidatorInfo('unknown'), null);
  });
});

// ---------------------------------------------------------------------------
// LV-10: validateDelivery
// ---------------------------------------------------------------------------

describe('LV-10 validateDelivery', () => {
  it('returns unavailable when validator not registered', () => {
    const r = validateDelivery({ status: 'valid' });
    assert.strictEqual(r.status, VALIDATOR_STATUSES.UNAVAILABLE);
  });
});