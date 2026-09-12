'use strict';

/**
 * Loop Failure Diagnoser v1 — classifies tool_job failures into stable fault types.
 *
 * Pure functions: no I/O, no DB, no network.
 *
 * HLE-4 scope:
 *  - Classify a failed tool_job + error into one of 10 fault types.
 *  - Attach machine-readable code, human message, evidence, and suggested repair strategies.
 *  - Each classification is deterministic: same inputs → same output.
 *
 * NOT in scope:
 *  - Actually executing repair strategies (live in integration layer)
 *  - Provider-level retry logic (live in agent-runner)
 *  - Capability provisioning (live in capability-provisioning.js)
 *
 * Integration:
 *  - Integration layer calls diagnoseFailure(job, context) after tool execution fails.
 *  - Result drives RepairStrategy selection in loop-repair-strategy.js.
 *  - Diagnosed type is stored as LoopEvidence (kind: 'failure_diagnosis').
 */

const {
  REASON_CODES,
} = require('./loop-contract');

// ---------------------------------------------------------------------------
// Fault type definitions
// ---------------------------------------------------------------------------

/**
 * All 10 fault types with their default behavior and suggested strategies.
 * Keyed by lowercase faultType for O(1) lookup.
 */
const FAULT_TYPES = {
  transient_runtime: {
    faultType: 'transient_runtime',
    defaultBehavior: 'auto_retry',
    repairStrategies: ['retry_with_reconcile', 'retry_same_params'],
    message: 'Temporary runtime condition (file lock, brief process error)',
  },
  transient_provider: {
    faultType: 'transient_provider',
    defaultBehavior: 'auto_retry',
    repairStrategies: ['provider_backoff_retry', 'fallback_provider'],
    message: 'Transient provider condition (rate limit, gateway timeout, connection reset)',
  },
  invalid_arguments: {
    faultType: 'invalid_arguments',
    defaultBehavior: 'auto_repair',
    repairStrategies: ['fix_schema_violation', 'fix_enum_or_range'],
    message: 'Invalid tool arguments (schema violation, out-of-range, wrong type)',
  },
  input_format: {
    faultType: 'input_format',
    defaultBehavior: 'auto_repair',
    repairStrategies: ['transform_input_format', 'validate_input_schema'],
    message: 'Input file format problem (column name mismatch, encoding, matrix orientation)',
  },
  runtime_not_ready: {
    faultType: 'runtime_not_ready',
    defaultBehavior: 'auto_repair',
    repairStrategies: ['ensure_capability', 'provision_runtime'],
    message: 'Runtime or capability not ready (R/Python missing, package absent)',
  },
  artifact_invalid: {
    faultType: 'artifact_invalid',
    defaultBehavior: 'auto_repair',
    repairStrategies: ['rerun_upstream', 'reconcile_artifact', 'repair_artifact_content'],
    message: 'Artifact validation failed (missing file, wrong hash, invalid structure)',
  },
  method_not_applicable: {
    faultType: 'method_not_applicable',
    defaultBehavior: 'require_user',
    repairStrategies: ['replan_subgraph', 'compare_method_candidates'],
    message: 'Method preconditions not met (requires redesign or alternative)',
  },
  user_input_required: {
    faultType: 'user_input_required',
    defaultBehavior: 'require_user',
    repairStrategies: ['ask_user_design'],
    message: 'Blocked pending user input',
  },
  resource_pressure: {
    faultType: 'resource_pressure',
    defaultBehavior: 'auto_repair',
    repairStrategies: ['reduce_resource_request', 'chunk_workflow', 'suggest_alternative'],
    message: 'Resource constraint (memory, disk, or compute risk)',
  },
  external_side_effect: {
    faultType: 'external_side_effect',
    defaultBehavior: 'block',
    repairStrategies: ['require_user_authorization'],
    message: 'External side effect attempted (upload, publish, paid operation outside workspace)',
  },
};

Object.freeze(FAULT_TYPES);

// ---------------------------------------------------------------------------
// Diagnosis rules — pattern matching on error + reason code
// ---------------------------------------------------------------------------

/**
 * Pattern: [regexOrString, faultType, extraStrategies[], message]
 * Evaluated in order; first match wins.
 */
const DIAGNOSIS_RULES = [
  // TRANSIENT_RUNTIME
  [/ENOENT|no such file|file not found/i, 'transient_runtime', ['validate_input_schema'], 'File not found during execution'],
  [/ETXTBSY|text file busy/i, 'transient_runtime', ['retry_with_reconcile'], 'Text file busy — temporary lock'],
  [/EBUSY|resource busy/i, 'transient_runtime', ['retry_with_reconcile'], 'Resource busy — temporary lock'],
  [/EAGAIN|resource temporarily unavailable/i, 'transient_runtime', ['retry_same_params'], 'Temporary resource unavailable'],
  [/child process exited with code (1|2|127)/i, 'transient_runtime', ['retry_with_reconcile'], 'Child process failed'],

  // TRANSIENT_PROVIDER
  [/429|rate.limit|too many requests/i, 'transient_provider', ['provider_backoff_retry'], 'Provider rate limit hit'],
  [/502|503|504|gateway.timeout|bad gateway|service unavailable/i, 'transient_provider', ['provider_backoff_retry', 'fallback_provider'], 'Provider gateway error'],
  [/connection reset|connection refused|ECONNRESET|ECONNREFUSED/i, 'transient_provider', ['provider_backoff_retry', 'fallback_provider'], 'Connection error to provider'],
  [/timeout|timed.out|ETIMEDOUT/i, 'transient_provider', ['provider_backoff_retry'], 'Provider request timed out'],
  [/upstream connect error|handshake failed/i, 'transient_provider', ['provider_backoff_retry'], 'Provider handshake/connect error'],

  // INVALID_ARGUMENTS — more specific patterns before broader ones
  [REASON_CODES.INVALID_ARGUMENTS, 'invalid_arguments', [], 'Argument validation failed'],
  [/missing required argument|required.*argument|argument.*required/i, 'invalid_arguments', ['fix_schema_violation'], 'Missing required argument'],
  [/invalid type|type mismatch(?!.*matrix)/i, 'invalid_arguments', ['fix_schema_violation'], 'Invalid argument type'],
  [/out of range|not in allowed values/i, 'invalid_arguments', ['fix_enum_or_range'], 'Out-of-range or invalid enum'],
  [/enumerated value.*not allowed|value.*not in enum/i, 'invalid_arguments', ['fix_enum_or_range'], 'Invalid enumerated value'],

  // INPUT_FORMAT — before INVALID_ARGUMENTS broad patterns
  [REASON_CODES.INPUT_FORMAT_MISMATCH, 'input_format', [], 'Input format mismatch'],
  [/column.*not found|missing column|no such column/i, 'input_format', ['transform_input_format'], 'Required input column missing'],
  [/encoding error|invalid utf|byte.*invalid/i, 'input_format', ['transform_input_format'], 'File encoding error'],
  [/dimension mismatch|expected matrix|rows.*columns.*mismatch/i, 'input_format', ['transform_input_format'], 'Matrix dimension mismatch'],

  // RUNTIME_NOT_READY
  [REASON_CODES.TOOL_RUNTIME_NOT_READY, 'runtime_not_ready', [], 'Runtime not ready'],
  [/package.*not found|no package|namespace.*not loaded/i, 'runtime_not_ready', ['ensure_capability'], 'R/Python package not installed'],
  [/\binterpreter not found|\bR\b.*not found|\bPython\b.*not found/i, 'runtime_not_ready', ['provision_runtime'], 'Language interpreter not available'],
  [/capability.*not ready|capability.*missing/i, 'runtime_not_ready', ['ensure_capability'], 'Required capability not ready'],

  // ARTIFACT_INVALID — more specific before runtime_not_ready (both have "not found")
  [REASON_CODES.ARTIFACT_VALIDATION_FAILED, 'artifact_invalid', [], 'Artifact validation failed'],
  [/artifact.*not found|artifact.*missing|cannot find artifact/i, 'artifact_invalid', ['reconcile_artifact', 'rerun_upstream'], 'Artifact referenced but not found'],
  [/hash mismatch|sha256.*mismatch|checksum.*fail/i, 'artifact_invalid', ['reconcile_artifact'], 'Artifact hash mismatch'],
  [/required artifact missing/i, 'artifact_invalid', ['rerun_upstream'], 'Required artifact missing'],

  // METHOD_NOT_APPLICABLE
  [REASON_CODES.METHOD_NOT_APPLICABLE, 'method_not_applicable', [], 'Method not applicable'],
  [/method.*precondition|precondition.*not met|assumptions.*violated/i, 'method_not_applicable', ['compare_method_candidates'], 'Method preconditions not met'],
  [/insufficient.*(samples|data|replicates|cells)|not enough.*(data|samples|replicates)|requires.*(samples|cells|replicates)/i, 'method_not_applicable', ['replan_subgraph'], 'Insufficient data for method'],

  // USER_INPUT_REQUIRED（原 SCIENTIFIC_DESIGN_MISSING，BLOCK-83 D12 中性化）
  [REASON_CODES.USER_INPUT_REQUIRED, 'user_input_required', [], 'Scientific design ambiguous'],
  [/contrast.*not specified|contrast.*missing|define.*contrast/i, 'user_input_required', ['ask_user_design'], 'Contrast not specified'],
  [/batch.*effect|batch.*confound|paired.*missing/i, 'user_input_required', ['ask_user_design'], 'Batch effect or pairing design ambiguous'],

  // RESOURCE_PRESSURE
  [/out of memory|OOM|memory limit|killed.*memory/i, 'resource_pressure', ['reduce_resource_request', 'chunk_workflow'], 'Out of memory'],
  [/disk full|no space left|ENOSPC/i, 'resource_pressure', ['reduce_resource_request'], 'Disk space exhausted'],
  [/CPU limit|cpu.*exceeded|process.*timeout/i, 'resource_pressure', ['chunk_workflow', 'suggest_alternative'], 'CPU or time limit exceeded'],

  // EXTERNAL_SIDE_EFFECT
  [/upload.*blocked|download.*blocked|external.*write/i, 'external_side_effect', ['require_user_authorization'], 'External operation attempted'],
  [/paid.*operation|billing.*error|charge.*failed/i, 'external_side_effect', ['require_user_authorization'], 'Paid operation attempted'],
];

// ---------------------------------------------------------------------------
// Main diagnosis function
// ---------------------------------------------------------------------------

/**
 * Classify a tool_job failure into a fault type.
 *
 * @param {Object} job
 * @param {Object} [context]
 * @param {string} [context.error]    - error message override
 * @param {string} [context.toolId]    - tool ID for additional context
 * @param {Array}  [context.artifactValidationResults] - ValidatorResult[] from HLE-3
 * @returns {Object} diagnosis result
 */
function diagnoseFailure(job, context = {}) {
  const jobError = job?.error || context.error || '';
  const reasonCode = job?.reason_code || job?.failure_reason_code || context.reasonCode || null;
  const toolId = job?.tool_id || context.toolId || null;

  // Step 1: Reason code mapping (highest priority — explicit codes are deterministic)
  if (reasonCode) {
    const mapped = mapReasonCodeToFaultType(reasonCode, jobError, context);
    if (mapped) return mapped;
  }

  // Step 2: Artifact validation results (HLE-3 integration)
  if (context.artifactValidationResults && context.artifactValidationResults.length > 0) {
    const avResult = diagnoseFromValidationResults(context.artifactValidationResults);
    if (avResult) return avResult;
  }

  // Step 3: Pattern matching on error string
  for (const rule of DIAGNOSIS_RULES) {
    const [pattern, faultType, extraStrategies, message] = rule;
    const matches = typeof pattern === 'string'
      ? jobError.includes(pattern)
      : pattern.test(jobError);

    if (matches) {
      const ft = FAULT_TYPES[faultType];
      if (!ft) continue; // should not happen
      return buildDiagnosis({
        faultType,
        defaultBehavior: ft.defaultBehavior,
        strategies: [...ft.repairStrategies, ...(extraStrategies || [])],
        message: message || ft.message,
        reasonCode,
        jobError,
        toolId,
        classificationMethod: 'pattern_match',
        confidence: classifyConfidence(faultType, jobError),
      });
    }
  }

  // Step 4: Fallback
  return buildDiagnosis({
    faultType: 'unknown_failure',
    defaultBehavior: 'require_user',
    strategies: ['ask_user_design'],
    message: `Unknown failure: ${truncate(jobError, 100)}`,
    reasonCode,
    jobError,
    toolId,
    classificationMethod: 'fallback',
    confidence: 0.1,
  });
}

/**
 * Map explicit REASON_CODEs to fault types deterministically.
 */
function mapReasonCodeToFaultType(reasonCode, error, context) {
  const map = {
    [REASON_CODES.INVALID_ARGUMENTS]: 'invalid_arguments',
    [REASON_CODES.INPUT_FORMAT_MISMATCH]: 'input_format',
    [REASON_CODES.TOOL_RUNTIME_NOT_READY]: 'runtime_not_ready',
    [REASON_CODES.TRANSIENT_RUNTIME_RETRY]: 'transient_runtime',
    [REASON_CODES.ARTIFACT_VALIDATION_FAILED]: 'artifact_invalid',
    [REASON_CODES.METHOD_NOT_APPLICABLE]: 'method_not_applicable',
    [REASON_CODES.USER_INPUT_REQUIRED]: 'user_input_required',
    // 存量兼容：BLOCK-83 之前持久化的任务记录仍带旧值。
    SCIENTIFIC_DESIGN_MISSING: 'user_input_required',
  };

  const faultType = map[reasonCode];
  if (!faultType) return null;

  const ft = FAULT_TYPES[faultType];
  if (!ft) return null; // should not happen

  return buildDiagnosis({
    faultType,
    defaultBehavior: ft.defaultBehavior,
    strategies: ft.repairStrategies,
    message: `${ft.message} (reasonCode: ${reasonCode})`,
    reasonCode,
    jobError: error,
    toolId: context.toolId || null,
    classificationMethod: 'reason_code',
    confidence: 1.0,
  });
}

/**
 * Diagnose from HLE-3 validator results embedded in context.
 */
function diagnoseFromValidationResults(validatorResults) {
  if (!validatorResults || validatorResults.length === 0) return null;

  const blocked = validatorResults.filter((r) => r.status === 'blocked');
  const unavailable = validatorResults.filter((r) => r.status === 'unavailable');

  if (blocked.some((r) => r.validatorId === 'input-snapshot')) {
    return buildDiagnosis({
      faultType: 'artifact_invalid',
      defaultBehavior: 'auto_repair',
      strategies: ['reconcile_artifact'],
      message: 'Input artifact file missing or invalid (input-snapshot validator)',
      classificationMethod: 'validator_result',
      confidence: 0.95,
    });
  }
  if (blocked.some((r) => r.validatorId === 'counts-matrix')) {
    return buildDiagnosis({
      faultType: 'input_format',
      defaultBehavior: 'auto_repair',
      strategies: ['transform_input_format'],
      message: 'Counts matrix structure invalid (counts-matrix validator)',
      classificationMethod: 'validator_result',
      confidence: 0.9,
    });
  }
  if (blocked.some((r) => r.validatorId === 'de-results')) {
    return buildDiagnosis({
      faultType: 'method_not_applicable',
      defaultBehavior: 'require_user',
      strategies: ['replan_subgraph', 'compare_method_candidates'],
      message: 'DE results invalid — method preconditions may not be met',
      classificationMethod: 'validator_result',
      confidence: 0.8,
    });
  }
  if (blocked.some((r) => r.validatorId === 'delivery-integrity')) {
    return buildDiagnosis({
      faultType: 'artifact_invalid',
      defaultBehavior: 'auto_repair',
      strategies: ['rerun_upstream'],
      message: 'Delivery manifest incomplete — upstream artifacts missing',
      classificationMethod: 'validator_result',
      confidence: 0.95,
    });
  }
  if (unavailable.length > 0 && blocked.length === 0) {
    return buildDiagnosis({
      faultType: 'unknown_failure',
      defaultBehavior: 'require_user',
      strategies: ['ask_user_design'],
      message: 'Validation unavailable — cannot determine root cause',
      classificationMethod: 'validator_result',
      confidence: 0.3,
    });
  }
  return null;
}

/**
 * Build a diagnosis result object.
 */
function buildDiagnosis({ faultType, defaultBehavior, strategies, message, reasonCode, jobError, toolId, classificationMethod, confidence }) {
  const findings = [];
  if (jobError) findings.push({ code: 'ERROR_MESSAGE', message: truncate(jobError, 200), severity: 'error' });
  if (reasonCode) findings.push({ code: 'REASON_CODE', message: reasonCode, severity: 'warning' });
  if (toolId) findings.push({ code: 'TOOL_ID', message: toolId, severity: 'info' });

  return Object.freeze({
    faultType,
    defaultBehavior,
    repairStrategies: Object.freeze([...(new Set(strategies))]), // dedupe
    message,
    classificationMethod,
    confidence: Math.max(0, Math.min(1, confidence)),
    findings: Object.freeze(findings),
    reasonCode: reasonCode || null,
  });
}

/**
 * Classify confidence based on fault type and error characteristics.
 */
function classifyConfidence(faultType, error) {
  if (faultType === 'unknown_failure') return 0.1;
  if (faultType === 'external_side_effect') return 0.95;
  if (/timeout|rate.limit|429|502|503|504/i.test(error)) return 0.9;
  if (/memory|killed|OOM|ENOSPC/i.test(error)) return 0.95;
  if (/not found|ENOENT/i.test(error)) return 0.7;
  return 0.6;
}

/**
 * Truncate a string to maxLen.
 */
function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…';
}

/**
 * List all known fault types.
 */
function listFaultTypes() {
  return Object.values(FAULT_TYPES).map((ft) => ({
    faultType: ft.faultType,
    defaultBehavior: ft.defaultBehavior,
    repairStrategies: ft.repairStrategies,
    message: ft.message,
  }));
}

/**
 * Get a fault type definition.
 */
function getFaultType(faultType) {
  return FAULT_TYPES[faultType] || null;
}

module.exports = {
  FAULT_TYPES,
  diagnoseFailure,
  mapReasonCodeToFaultType,
  diagnoseFromValidationResults,
  listFaultTypes,
  getFaultType,
  classifyConfidence,
};