#!/usr/bin/env node

/**
 * Loop Failure Diagnoser — unit tests (CJS).
 * Run via: node --test test/loop-failure-diagnoser.test.cjs
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const {
  diagnoseFailure,
  listFaultTypes,
  getFaultType,
  classifyConfidence,
} = require('../core/shared-backend/loop-failure-diagnoser');

beforeEach(() => {}); // no-op for API consistency

// ---------------------------------------------------------------------------
// FD-1: ENOENT / transient_runtime
// ---------------------------------------------------------------------------

describe('FD-1 transient_runtime (ENOENT)', () => {
  it('classifies ENOENT as transient_runtime', () => {
    const d = diagnoseFailure({ error: 'ENOENT: no such file or directory' });
    assert.strictEqual(d.faultType, 'transient_runtime');
  });

  it('classifies EBUSY as transient_runtime', () => {
    const d = diagnoseFailure({ error: 'EBUSY: resource busy or locked' });
    assert.strictEqual(d.faultType, 'transient_runtime');
  });

  it('defaultBehavior is auto_retry', () => {
    const d = diagnoseFailure({ error: 'ETXTBSY: text file busy' });
    assert.strictEqual(d.defaultBehavior, 'auto_retry');
  });

  it('suggests retry strategies', () => {
    const d = diagnoseFailure({ error: 'EAGAIN: resource temporarily unavailable' });
    assert.ok(d.repairStrategies.includes('retry_same_params'));
    assert.ok(d.repairStrategies.includes('retry_with_reconcile'));
  });

  it('confidence >= 0.5 for transient patterns', () => {
    const d = diagnoseFailure({ error: 'child process exited with code 1' });
    assert.ok(d.confidence >= 0.5);
    assert.strictEqual(d.classificationMethod, 'pattern_match');
  });
});

// ---------------------------------------------------------------------------
// FD-2: transient_provider (rate limit / gateway errors)
// ---------------------------------------------------------------------------

describe('FD-2 transient_provider', () => {
  it('classifies 429 rate limit', () => {
    const d = diagnoseFailure({ error: 'HTTP 429: rate limit exceeded' });
    assert.strictEqual(d.faultType, 'transient_provider');
  });

  it('classifies 502 gateway error', () => {
    const d = diagnoseFailure({ error: 'HTTP 502: Bad Gateway' });
    assert.strictEqual(d.faultType, 'transient_provider');
  });

  it('classifies connection reset', () => {
    const d = diagnoseFailure({ error: 'ECONNRESET: connection reset by peer' });
    assert.strictEqual(d.faultType, 'transient_provider');
  });

  it('classifies timeout', () => {
    const d = diagnoseFailure({ error: 'ETIMEDOUT: connection timed out' });
    assert.strictEqual(d.faultType, 'transient_provider');
  });

  it('suggests backoff and fallback', () => {
    const d = diagnoseFailure({ error: 'upstream connect error' });
    assert.ok(d.repairStrategies.includes('provider_backoff_retry'));
    assert.ok(d.repairStrategies.includes('fallback_provider'));
  });

  it('confidence 0.9 for clear provider signals', () => {
    const d = diagnoseFailure({ error: 'HTTP 503: Service Unavailable' });
    assert.strictEqual(d.confidence, 0.9);
  });
});

// ---------------------------------------------------------------------------
// FD-3: invalid_arguments
// ---------------------------------------------------------------------------

describe('FD-3 invalid_arguments', () => {
  it('classifies reason_code INVALID_ARGUMENTS', () => {
    const d = diagnoseFailure({ reason_code: 'INVALID_ARGUMENTS' });
    assert.strictEqual(d.faultType, 'invalid_arguments');
    assert.strictEqual(d.confidence, 1.0);
    assert.strictEqual(d.classificationMethod, 'reason_code');
  });

  it('classifies missing required argument', () => {
    const d = diagnoseFailure({ error: 'missing required argument: contrast' });
    assert.strictEqual(d.faultType, 'invalid_arguments');
  });

  it('classifies out of range', () => {
    const d = diagnoseFailure({ error: 'pvalue threshold out of range: expected [0,1], got 5' });
    assert.strictEqual(d.faultType, 'invalid_arguments');
  });

  it('suggests fix strategies', () => {
    const d = diagnoseFailure({ error: 'invalid type: expected number, got string' });
    assert.ok(d.repairStrategies.includes('fix_schema_violation'));
    assert.ok(d.repairStrategies.includes('fix_enum_or_range'));
  });
});

// ---------------------------------------------------------------------------
// FD-4: input_format
// ---------------------------------------------------------------------------

describe('FD-4 input_format', () => {
  it('classifies missing column', () => {
    const d = diagnoseFailure({ error: 'column "gene_name" not found in input file' });
    assert.strictEqual(d.faultType, 'input_format');
  });

  it('classifies INPUT_FORMAT_MISMATCH reason code', () => {
    const d = diagnoseFailure({ reason_code: 'INPUT_FORMAT_MISMATCH' });
    assert.strictEqual(d.faultType, 'input_format');
    assert.strictEqual(d.confidence, 1.0);
  });

  it('classifies encoding error', () => {
    const d = diagnoseFailure({ error: 'encoding error: invalid UTF-8 byte sequence' });
    assert.strictEqual(d.faultType, 'input_format');
  });

  it('suggests transform strategies', () => {
    const d = diagnoseFailure({ error: 'dimension mismatch: expected 100 rows, got 50' });
    assert.ok(d.repairStrategies.includes('transform_input_format'));
  });
});

// ---------------------------------------------------------------------------
// FD-5: runtime_not_ready
// ---------------------------------------------------------------------------

describe('FD-5 runtime_not_ready', () => {
  it('classifies missing package', () => {
    const d = diagnoseFailure({ error: 'package "DESeq2" not found in library path' });
    assert.strictEqual(d.faultType, 'runtime_not_ready');
  });

  it('classifies TOOL_RUNTIME_NOT_READY reason code', () => {
    const d = diagnoseFailure({ reason_code: 'TOOL_RUNTIME_NOT_READY' });
    assert.strictEqual(d.faultType, 'runtime_not_ready');
    assert.strictEqual(d.confidence, 1.0);
  });

  it('classifies interpreter not found', () => {
    const d = diagnoseFailure({ error: 'python3: interpreter not found' });
    assert.strictEqual(d.faultType, 'runtime_not_ready');
  });

  it('suggests ensure_capability', () => {
    const d = diagnoseFailure({ error: 'namespace "DESeq2" not loaded' });
    assert.ok(d.repairStrategies.includes('ensure_capability'));
  });
});

// ---------------------------------------------------------------------------
// FD-6: artifact_invalid
// ---------------------------------------------------------------------------

describe('FD-6 artifact_invalid', () => {
  it('classifies ARTIFACT_VALIDATION_FAILED reason code', () => {
    const d = diagnoseFailure({ reason_code: 'ARTIFACT_VALIDATION_FAILED' });
    assert.strictEqual(d.faultType, 'artifact_invalid');
    assert.strictEqual(d.confidence, 1.0);
  });

  it('classifies artifact not found', () => {
    const d = diagnoseFailure({ error: 'artifact "counts_matrix.csv" not found' });
    assert.strictEqual(d.faultType, 'artifact_invalid');
  });

  it('classifies hash mismatch', () => {
    const d = diagnoseFailure({ error: 'SHA-256 hash mismatch for artifact "report.html"' });
    assert.strictEqual(d.faultType, 'artifact_invalid');
  });

  it('suggests rerun_upstream', () => {
    const d = diagnoseFailure({ error: 'required artifact "metadata.csv" is missing' });
    assert.ok(d.repairStrategies.includes('rerun_upstream'));
  });
});

// ---------------------------------------------------------------------------
// FD-7: method_not_applicable + user_input_required
// ---------------------------------------------------------------------------

describe('FD-7 method_not_applicable / user_input_required', () => {
  it('classifies METHOD_NOT_APPLICABLE', () => {
    const d = diagnoseFailure({ reason_code: 'METHOD_NOT_APPLICABLE' });
    assert.strictEqual(d.faultType, 'method_not_applicable');
    assert.strictEqual(d.confidence, 1.0);
  });

  it('classifies insufficient samples', () => {
    const d = diagnoseFailure({ error: 'method requires at least 3 replicates, found 2' });
    assert.strictEqual(d.faultType, 'method_not_applicable');
  });

  it('classifies SCIENTIFIC_DESIGN_MISSING', () => {
    const d = diagnoseFailure({ reason_code: 'USER_INPUT_REQUIRED' });
    assert.strictEqual(d.faultType, 'user_input_required');
    assert.strictEqual(d.confidence, 1.0);
  });

  it('classifies contrast not specified', () => {
    const d = diagnoseFailure({ error: 'contrast not specified: please define treatment vs control' });
    assert.strictEqual(d.faultType, 'user_input_required');
  });

  it('method_not_applicable requires user', () => {
    const d = diagnoseFailure({ error: 'method preconditions not met' });
    assert.strictEqual(d.defaultBehavior, 'require_user');
  });
});

// ---------------------------------------------------------------------------
// FD-8: resource_pressure
// ---------------------------------------------------------------------------

describe('FD-8 resource_pressure', () => {
  it('classifies OOM', () => {
    const d = diagnoseFailure({ error: 'Killed: out of memory (OOM)' });
    assert.strictEqual(d.faultType, 'resource_pressure');
    assert.strictEqual(d.confidence, 0.95);
  });

  it('classifies disk full', () => {
    const d = diagnoseFailure({ error: 'ENOSPC: no space left on device' });
    assert.strictEqual(d.faultType, 'resource_pressure');
    assert.strictEqual(d.confidence, 0.95);
  });

  it('classifies CPU limit', () => {
    const d = diagnoseFailure({ error: 'CPU time limit exceeded' });
    assert.strictEqual(d.faultType, 'resource_pressure');
  });

  it('suggests reduce resource', () => {
    const d = diagnoseFailure({ error: 'memory limit exceeded' });
    assert.ok(d.repairStrategies.includes('reduce_resource_request'));
    assert.ok(d.repairStrategies.includes('chunk_workflow'));
  });
});

// ---------------------------------------------------------------------------
// FD-9: external_side_effect
// ---------------------------------------------------------------------------

describe('FD-9 external_side_effect', () => {
  it('classifies upload blocked', () => {
    const d = diagnoseFailure({ error: 'upload to external server blocked by security policy' });
    assert.strictEqual(d.faultType, 'external_side_effect');
    assert.strictEqual(d.defaultBehavior, 'block');
  });

  it('classifies paid operation', () => {
    const d = diagnoseFailure({ error: 'paid operation attempted without authorization' });
    assert.strictEqual(d.faultType, 'external_side_effect');
  });

  it('high confidence for dangerous ops', () => {
    const d = diagnoseFailure({ error: 'external write operation detected' });
    assert.strictEqual(d.confidence, 0.95);
  });
});

// ---------------------------------------------------------------------------
// FD-10: HLE-3 validator integration
// ---------------------------------------------------------------------------

describe('FD-10 HLE-3 validator integration', () => {
  it('blocked input-snapshot → artifact_invalid', () => {
    const d = diagnoseFailure({}, {
      artifactValidationResults: [{ validatorId: 'input-snapshot', status: 'blocked' }],
    });
    assert.strictEqual(d.faultType, 'artifact_invalid');
    assert.strictEqual(d.confidence, 0.95);
    assert.strictEqual(d.classificationMethod, 'validator_result');
  });

  it('blocked counts-matrix → input_format', () => {
    const d = diagnoseFailure({}, {
      artifactValidationResults: [{ validatorId: 'counts-matrix', status: 'blocked' }],
    });
    assert.strictEqual(d.faultType, 'input_format');
  });

  it('blocked de-results → method_not_applicable', () => {
    const d = diagnoseFailure({}, {
      artifactValidationResults: [{ validatorId: 'de-results', status: 'blocked' }],
    });
    assert.strictEqual(d.faultType, 'method_not_applicable');
    assert.strictEqual(d.defaultBehavior, 'require_user');
  });

  it('unavailable validators → unknown_failure', () => {
    const d = diagnoseFailure({}, {
      artifactValidationResults: [{ validatorId: 'counts-matrix', status: 'unavailable' }],
    });
    assert.strictEqual(d.faultType, 'unknown_failure');
    assert.strictEqual(d.confidence, 0.3);
  });

  it('reason_code takes priority over validator results', () => {
    const d = diagnoseFailure(
      { reason_code: 'INVALID_ARGUMENTS' },
      { artifactValidationResults: [{ validatorId: 'counts-matrix', status: 'blocked' }] },
    );
    assert.strictEqual(d.faultType, 'invalid_arguments');
    assert.strictEqual(d.confidence, 1.0);
    assert.strictEqual(d.classificationMethod, 'reason_code');
  });
});

// ---------------------------------------------------------------------------
// FD-11: listing and utilities
// ---------------------------------------------------------------------------

describe('FD-11 listing and utilities', () => {
  it('listFaultTypes returns all 10 fault types', () => {
    const list = listFaultTypes();
    assert.strictEqual(list.length, 10);
    const ids = list.map((f) => f.faultType);
    assert.ok(ids.includes('transient_runtime'));
    assert.ok(ids.includes('user_input_required'));
    assert.ok(ids.includes('external_side_effect'));
  });

  it('getFaultType returns definition or null', () => {
    const ft = getFaultType('resource_pressure');
    assert.strictEqual(ft.faultType, 'resource_pressure');
    assert.strictEqual(ft.defaultBehavior, 'auto_repair');
    assert.strictEqual(getFaultType('unknown'), null);
  });

  it('classifyConfidence returns value in [0, 1]', () => {
    assert.ok(classifyConfidence('unknown_failure', '') >= 0);
    assert.ok(classifyConfidence('external_side_effect', '') <= 1);
  });

  it('diagnosis result is frozen', () => {
    const d = diagnoseFailure({ error: 'OOM' });
    assert.ok(Object.isFrozen(d));
    assert.ok(Object.isFrozen(d.findings));
    assert.ok(Object.isFrozen(d.repairStrategies));
  });

  it('findings include error message', () => {
    const d = diagnoseFailure({ error: 'test error message' });
    const errFinding = d.findings.find((f) => f.code === 'ERROR_MESSAGE');
    assert.ok(errFinding);
    assert.ok(errFinding.message.includes('test error'));
  });

  it('confidence is capped at 1.0', () => {
    const d = diagnoseFailure({ reason_code: 'INVALID_ARGUMENTS' });
    assert.ok(d.confidence <= 1.0);
  });
});

// ---------------------------------------------------------------------------
// FD-12: unknown_failure fallback
// ---------------------------------------------------------------------------

describe('FD-12 unknown_failure fallback', () => {
  it('unrecognised error → unknown_failure', () => {
    const d = diagnoseFailure({ error: 'something completely unknown and unusual' });
    assert.strictEqual(d.faultType, 'unknown_failure');
    assert.strictEqual(d.confidence, 0.1);
  });

  it('no error → unknown_failure', () => {
    const d = diagnoseFailure({});
    assert.strictEqual(d.faultType, 'unknown_failure');
  });

  it('requires_user for unknown', () => {
    const d = diagnoseFailure({ error: 'completely novel error' });
    assert.strictEqual(d.defaultBehavior, 'require_user');
  });

  it('ask_user_design in strategies for unknown', () => {
    const d = diagnoseFailure({ error: 'mystery error' });
    assert.ok(d.repairStrategies.includes('ask_user_design'));
  });
});