'use strict';

/**
 * Loop Validator Registry v1 — centralized artifact and delivery verification.
 *
 * Pure functions: no I/O, no DB, no network.
 * All actual validation logic lives in registered validator functions.
 *
 * HLE-3 scope:
 *  - Validator Contract: four-state result (valid / degraded / blocked / unavailable)
 *  - Registry: register / dispatch / list / versioned resolution
 *  - Plugin hook: connect manifest fields to module-specific validators
 *  - Built-in validators: input-snapshot, metadata, counts-matrix, DE-table,
 *    heatmap-data, enrichment-statistics, delivery-integrity
 *  - Hook into Loop Controller: after tool execution, validators run before
 *    iteration completes; results feed into loop's evidence/decision
 *
 * NOT in scope:
 *  - Actually executing validators (tool_executor lives in biof3-server)
 *  - Writing validator results to DB (done by integration layer)
 *  - Replacing existing artifact-truth.js (different concern: tool execution vs loop evidence)
 *
 * Integration contract:
 *  - After tool execution completes, integration layer calls:
 *      validateArtifact(artifact, context) → ValidatorResult
 *      validateDelivery(deliveryRecord) → ValidatorResult
 *  - Results are appended as LoopEvidence and feed into Loop Controller's
 *    evaluateExit() for completion decision.
 */

const { stableHash, redactSensitiveValue } = require('./loop-contract');

// ---------------------------------------------------------------------------
// Validator result contract
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ValidatorFinding
 * @property {string} code       - Machine-readable finding code (e.g. 'COLUMN_COUNT_MISMATCH')
 * @property {string} message   - Human-readable message (may be shown to user)
 * @property {'error'|'warning'} severity
 * @property {Object} [context] - Additional structured context
 */

/**
 * @typedef {Object} ValidatorResult
 * @property {'valid'|'degraded'|'blocked'|'unavailable'} status
 * @property {string} validatorId
 * @property {string} version
 * @property {string[]} applicableKinds   - artifact kinds this validator handles
 * @property {string[]} findings
 * @property {string} [detail]   - Optional explanation for degraded/blocked
 */

/**
 * @typedef {Object} ValidationContext
 * @property {Object} artifact       - The artifact being validated
 * @property {Object} [jobRecord]   - Tool job record (if available)
 * @property {Object} [provenance]  - Provenance record (if available)
 * @property {Object} [dagNode]    - DAG node definition (toolId, inputs, etc.)
 * @property {Object} [toolMetadata] - Tool capability metadata
 */

// ---------------------------------------------------------------------------
// Validator types
// ---------------------------------------------------------------------------

const VALIDATOR_TYPES = Object.freeze({
  INPUT_SNAPSHOT: 'input-snapshot',
  ARTIFACT_SCHEMA: 'artifact-schema',
  DELIVERY_INTEGRITY: 'delivery-integrity',
  STATISTICAL: 'statistical',
  SCIENTIFIC: 'scientific',
  LINEAGE: 'lineage',
});

const VALIDATOR_STATUSES = Object.freeze({
  VALID: 'valid',
  DEGRADED: 'degraded',
  BLOCKED: 'blocked',
  UNAVAILABLE: 'unavailable',
});

const FINDING_SEVERITIES = Object.freeze({
  ERROR: 'error',
  WARNING: 'warning',
});

// ---------------------------------------------------------------------------
// Internal registry
// ---------------------------------------------------------------------------

const _registry = new Map();
let _pluginHooks = [];

/**
 * Register a validator.
 *
 * @param {Object} def
 * @param {string} def.id            - Unique validator ID (e.g. 'counts-matrix')
 * @param {string} def.name          - Display name
 * @param {string} def.version       - Semantic version
 * @param {string} def.type          - One of VALIDATOR_TYPES
 * @param {string[]} def.applicableKinds - Artifact kinds (e.g. ['table', 'json'])
 * @param {Function} def.validate    - (artifact, context) => ValidatorResult
 * @param {Object} [def.pluginManifest] - Optional plugin manifest to link
 */
function registerValidator(def) {
  if (!def || typeof def.id !== 'string' || !def.id) {
    throw new TypeError('validator.id must be a non-empty string');
  }
  if (!def.version || typeof def.version !== 'string') {
    throw new TypeError('validator.version must be a non-empty string');
  }
  if (!Array.isArray(def.applicableKinds) || def.applicableKinds.length === 0) {
    throw new TypeError('validator.applicableKinds must be a non-empty array');
  }
  if (typeof def.validate !== 'function') {
    throw new TypeError('validator.validate must be a function');
  }

  const entry = {
    id: def.id,
    name: def.name || def.id,
    version: def.version,
    type: def.type || VALIDATOR_TYPES.ARTIFACT_SCHEMA,
    applicableKinds: Object.freeze([...def.applicableKinds]),
    applicableArtifactTypes: Object.freeze([...(def.applicableArtifactTypes || [])]),
    pluginManifest: def.pluginManifest || null,
    validate: def.validate,
    enabled: def.enabled !== false,
    priority: typeof def.priority === 'number' ? def.priority : 0,
  };

  _registry.set(def.id, entry);
  return def.id;
}

/**
 * Override the enabled state of a validator.
 * @param {string} validatorId
 * @param {boolean} enabled
 */
function setValidatorEnabled(validatorId, enabled) {
  const entry = _registry.get(validatorId);
  if (!entry) return false;
  entry.enabled = !!enabled;
  return true;
}

/**
 * Dispatch a validator by ID.
 * @param {string} validatorId
 * @param {ValidationContext} context
 * @returns {ValidatorResult|null}
 */
function dispatchValidator(validatorId, context) {
  const entry = _registry.get(validatorId);
  if (!entry || !entry.enabled) return null;
  try {
    return entry.validate(context.artifact, context);
  } catch (err) {
    return buildUnavailableResult(validatorId, entry.version, String(err.message));
  }
}

/**
 * Find validators applicable to an artifact by kind.
 * @param {string} artifactKind
 * @returns {Object[]} sorted by priority DESC
 */
function findValidatorsForKind(artifactKind) {
  if (!artifactKind) return [];
  const kind = String(artifactKind).toLowerCase();
  return [..._registry.values()]
    .filter((e) => e.enabled && e.applicableKinds.map((k) => String(k).toLowerCase()).includes(kind))
    .sort((a, b) => b.priority - a.priority);
}

/**
 * Find validators applicable to an artifact by type.
 * @param {string} artifactType
 * @returns {Object[]}
 */
function findValidatorsForType(artifactType) {
  if (!artifactType) return [];
  const type = String(artifactType).toLowerCase();
  return [..._registry.values()]
    .filter((e) => e.enabled && e.applicableArtifactTypes.map((t) => String(t).toLowerCase()).includes(type))
    .sort((a, b) => b.priority - a.priority);
}

/**
 * Validate an artifact against all applicable validators.
 * Returns an aggregate result.
 *
 * @param {Object} artifact
 * @param {ValidationContext} context
 * @returns {{ results: ValidatorResult[], overallStatus: string }}
 */
function validateArtifact(artifact, context = {}) {
  if (!artifact || typeof artifact !== 'object') {
    return {
      results: [],
      overallStatus: VALIDATOR_STATUSES.UNAVAILABLE,
      findings: [{ code: 'ARTIFACT_MISSING', message: 'No artifact provided', severity: 'error' }],
    };
  }

  const kind = String(artifact.kind || artifact.type || '').toLowerCase();
  const type = String(artifact.type || '').toLowerCase();
  const validators = [
    ...findValidatorsForKind(kind),
    ...findValidatorsForType(type),
  ].filter((v, i, arr) => arr.findIndex((x) => x.id === v.id) === i); // dedupe

  if (validators.length === 0) {
    return {
      results: [],
      overallStatus: VALIDATOR_STATUSES.UNAVAILABLE,
      findings: [{ code: 'NO_APPLICABLE_VALIDATOR', message: `No validator for kind=${kind}`, severity: 'warning' }],
    };
  }

  const results = [];
  for (const validator of validators) {
    const result = dispatchValidator(validator.id, { ...context, artifact });
    if (result) results.push(result);
  }

  const findings = results.flatMap((r) => r.findings || []);
  const overallStatus = aggregateStatus(results.map((r) => r.status));

  return { results, overallStatus, findings };
}

/**
 * Validate a delivery record (delivery manifest / task completion).
 * @param {Object} deliveryRecord
 * @returns {ValidatorResult}
 */
function validateDelivery(deliveryRecord) {
  const validatorId = 'delivery-integrity';
  const entry = _registry.get(validatorId);
  if (!entry || !entry.enabled) {
    return buildUnavailableResult(validatorId, '1.0.0', 'delivery-integrity validator not registered');
  }
  try {
    return entry.validate(deliveryRecord, {});
  } catch (err) {
    return buildUnavailableResult(validatorId, entry.version, String(err.message));
  }
}

/**
 * Aggregate a list of statuses into a single status.
 * blocked > degraded > valid > unavailable
 *
 * @param {string[]} statuses
 * @returns {string}
 */
function aggregateStatus(statuses) {
  if (!statuses || statuses.length === 0) return VALIDATOR_STATUSES.UNAVAILABLE;
  if (statuses.includes(VALIDATOR_STATUSES.BLOCKED)) return VALIDATOR_STATUSES.BLOCKED;
  if (statuses.includes(VALIDATOR_STATUSES.DEGRADED)) return VALIDATOR_STATUSES.DEGRADED;
  // VALID > UNAVAILABLE: if all statuses are VALID or UNAVAILABLE → VALID
  if (statuses.every((s) => s === VALIDATOR_STATUSES.VALID || s === VALIDATOR_STATUSES.UNAVAILABLE)) {
    return statuses.includes(VALIDATOR_STATUSES.VALID) ? VALIDATOR_STATUSES.VALID : VALIDATOR_STATUSES.UNAVAILABLE;
  }
  return VALIDATOR_STATUSES.UNAVAILABLE;
}

// ---------------------------------------------------------------------------
// Result builders
// ---------------------------------------------------------------------------

function buildResult({ validatorId, version = '1.0.0', status, findings = [], detail = null }) {
  const findingsArray = findings.map(normalizeFinding);
  return Object.freeze({
    validatorId,
    version,
    status,
    findings: Object.freeze(findingsArray),
    detail: detail ? redactSensitiveValue(detail) : null,
  });
}

function buildUnavailableResult(validatorId, version, reason) {
  return buildResult({
    validatorId,
    version,
    status: VALIDATOR_STATUSES.UNAVAILABLE,
    findings: [
      {
        code: 'VALIDATOR_UNAVAILABLE',
        message: String(reason),
        severity: FINDING_SEVERITIES.ERROR,
      },
    ],
  });
}

function buildValidResult(validatorId, version) {
  return buildResult({ validatorId, version, status: VALIDATOR_STATUSES.VALID, findings: [] });
}

function normalizeFinding(finding) {
  if (typeof finding === 'string') {
    return Object.freeze({ code: 'INFO', message: finding, severity: FINDING_SEVERITIES.WARNING });
  }
  return Object.freeze({
    code: finding.code || 'UNKNOWN',
    message: finding.message || String(finding),
    severity: finding.severity || FINDING_SEVERITIES.WARNING,
    context: finding.context || null,
  });
}

// ---------------------------------------------------------------------------
// Plugin manifest hook
// ---------------------------------------------------------------------------

/**
 * Register a plugin manifest hook.
 * @param {Object} manifest - plugin manifest with validatorId field
 */
function registerPluginManifest(manifest) {
  if (!manifest || !manifest.id) return;
  _pluginHooks.push({ id: manifest.id, manifest: Object.freeze({ ...manifest }) });
}

/**
 * Get the plugin-specific validator ID for a plugin.
 * @param {string} pluginId
 * @returns {string|null}
 */
function getPluginValidatorId(pluginId) {
  const hook = _pluginHooks.find((h) => h.id === pluginId);
  return hook ? hook.manifest.validatorId || null : null;
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

function listValidators({ enabledOnly = true } = {}) {
  return [..._registry.values()]
    .filter((e) => !enabledOnly || e.enabled)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return String(a.id).localeCompare(b.id);
    })
    .map((e) => ({
      id: e.id,
      name: e.name,
      version: e.version,
      type: e.type,
      applicableKinds: e.applicableKinds,
      enabled: e.enabled,
    }));
}

function getValidatorInfo(validatorId) {
  const e = _registry.get(validatorId);
  if (!e) return null;
  return { id: e.id, name: e.name, version: e.version, type: e.type, applicableKinds: e.applicableKinds, enabled: e.enabled };
}

function clearRegistry() {
  _registry.clear();
  _pluginHooks = [];
}

module.exports = {
  VALIDATOR_TYPES,
  VALIDATOR_STATUSES,
  FINDING_SEVERITIES,
  registerValidator,
  setValidatorEnabled,
  dispatchValidator,
  findValidatorsForKind,
  findValidatorsForType,
  validateArtifact,
  validateDelivery,
  aggregateStatus,
  buildResult,
  buildUnavailableResult,
  buildValidResult,
  normalizeFinding,
  registerPluginManifest,
  getPluginValidatorId,
  listValidators,
  getValidatorInfo,
  clearRegistry,
};