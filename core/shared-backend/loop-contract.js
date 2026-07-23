'use strict';

/**
 * Loop Contract v1 — versioned, immutable, hashable.
 *
 * The Loop is the durable record of how an agent (or any controller)
 * advanced toward a goal on a single conversation. Every step is an
 * Iteration that contains a Decision and (optionally) an Action and
 * Evidence. Snapshots are compressed state used for replay and recovery.
 *
 * Invariants:
 *  - Every persisted record carries a stable SHA-256 `hash` derived from
 *    a canonical JSON serialization of its semantic fields. Fields like
 *    `createdAt` and `id` are NOT included in the hash, so semantically
 *    identical records hash identically across processes and restarts.
 *  - `actionKey` is the idempotency key for a proposed action. Two
 *    iterations with the same `actionKey` on the same `loopRunId` must
 *    be deduplicated; never executed twice.
 *  - All free-text payloads (publicConclusion, observationDigest,
 *    decisionReasonCode, evidenceRef) pass through `redactSensitiveValue`
 *    BEFORE serialization to the database. Raw Provider responses and
 *    stack traces NEVER enter the Loop ledger.
 *  - Status transitions are a finite-state machine. Invalid transitions
 *    throw; they do not silently mutate state.
 *
 * This module is pure (no I/O, no db, no network). The persistence
 * layer (SQLite) lives in `core/r-server/db.js`. The route layer
 * (`/api/loop/iterate`) lives in `core/r-server/routes/harness.js`.
 *
 * HLE-1 scope: schema + canonicalize + hash + reason codes + redaction.
 * HLE-2 scope: controller (observe → decide → validate → execute →
 *              record → evaluate exit).
 */

const crypto = require('crypto');
const { redactSensitiveValue } = require('./redaction');

const LOOP_CONTRACT_VERSION = 1;

const LOOP_RUN_STATUSES = Object.freeze([
  'planned',
  'running',
  'waiting_for_user',
  'blocked',
  'completed',
  'failed',
  'cancelled',
]);

const ITERATION_STATUSES = Object.freeze([
  'pending',
  'running',
  'succeeded',
  'failed',
  'blocked',
  'skipped',
]);

const ACTION_TYPES = Object.freeze([
  'plan',
  'run_tool',
  'wait_for_user',
  'verify',
  'repair',
  'finalize',
  'cancel',
]);

const DECISION_OUTCOMES = Object.freeze([
  'continue',
  'retry',
  'block',
  'wait',
  'complete',
  'cancel',
]);

const EVIDENCE_KINDS = Object.freeze([
  'tool_output',
  'artifact_pointer',
  'user_input',
  'checkpoint',
  'plan_step',
  'observation',
]);

const REASON_CODES = Object.freeze({
  // plan / decide
  NORMAL_PLAN_GENERATED: 'NORMAL_PLAN_GENERATED',
  PLAN_REVISED: 'PLAN_REVISED',
  PLAN_OSCILLATION_DETECTED: 'PLAN_OSCILLATION_DETECTED',
  NO_PROGRESS_CYCLE_DETECTED: 'NO_PROGRESS_CYCLE_DETECTED',
  // tool execution
  VALID_INPUTS_CONFIRMED: 'VALID_INPUTS_CONFIRMED',
  INPUT_FORMAT_MISMATCH: 'INPUT_FORMAT_MISMATCH',
  INVALID_ARGUMENTS: 'INVALID_ARGUMENTS',
  TOOL_RUNTIME_NOT_READY: 'TOOL_RUNTIME_NOT_READY',
  METHOD_NOT_APPLICABLE: 'METHOD_NOT_APPLICABLE',
  TRANSIENT_RUNTIME_RETRY: 'TRANSIENT_RUNTIME_RETRY',
  TOOL_SUCCEEDED: 'TOOL_SUCCEEDED',
  TOOL_VERIFIED: 'TOOL_VERIFIED',
  // termination
  ALL_NODES_VERIFIED: 'ALL_NODES_VERIFIED',
  SCIENTIFIC_DESIGN_MISSING: 'SCIENTIFIC_DESIGN_MISSING',
  USER_CANCELLED: 'USER_CANCELLED',
  GOAL_ACHIEVED: 'GOAL_ACHIEVED',
  // recovery
  RECOVERY_REQUIRED: 'RECOVERY_REQUIRED',
  STALLED_JOB_RECOVERED: 'STALLED_JOB_RECOVERED',
});

const TERMINAL_LOOP_STATUSES = new Set(['completed', 'failed', 'cancelled']);

const LOOP_STATUS_TRANSITIONS = Object.freeze({
  planned: new Set(['running', 'cancelled']),
  running: new Set(['waiting_for_user', 'blocked', 'completed', 'failed', 'cancelled']),
  waiting_for_user: new Set(['running', 'blocked', 'completed', 'failed', 'cancelled']),
  blocked: new Set(['running', 'completed', 'failed', 'cancelled']),
  completed: new Set(),
  failed: new Set(['running', 'cancelled']),
  cancelled: new Set(),
});

const ITERATION_STATUS_TRANSITIONS = Object.freeze({
  pending: new Set(['running', 'skipped']),
  running: new Set(['succeeded', 'failed', 'blocked', 'skipped']),
  succeeded: new Set(),
  failed: new Set(['running', 'skipped']),
  blocked: new Set(['running', 'skipped']),
  skipped: new Set(),
});

const SEMANTIC_FIELD_KEYS = Object.freeze({
  loopRun: Object.freeze([
    'loopRunId',
    'projectId',
    'conversationId',
    'taskSpecRef',
    'automationMode',
    'loopStatus',
    'createdAt',
    'updatedAt',
    'metadata',
  ]),
  iteration: Object.freeze([
    'loopRunId',
    'sequence',
    'observedStateDigest',
    'goalGapIds',
    'proposedAction',
    'decision',
    'decisionReasonCode',
    'publicConclusion',
    'status',
    'createdAt',
  ]),
  action: Object.freeze([
    'actionKey',
    'actionType',
    'toolId',
    'inputs',
    'params',
    'expectedArtifactKinds',
    'attempt',
  ]),
  evidence: Object.freeze([
    'evidenceId',
    'kind',
    'ref',
    'summaryDigest',
    'createdAt',
  ]),
  decision: Object.freeze([
    'decision',
    'decisionReasonCode',
    'confidence',
    'notes',
  ]),
});

function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`);
  return `{${parts.join(',')}}`;
}

function canonicalStringify(value) {
  return canonicalize(value);
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function stableHash(semanticFields) {
  return sha256Hex(canonicalStringify(semanticFields));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireKeys(obj, keys, label) {
  if (!isPlainObject(obj)) {
    throw new TypeError(`${label} must be an object`);
  }
  const missing = keys.filter((k) => obj[k] === undefined || obj[k] === null || obj[k] === '');
  if (missing.length > 0) {
    throw new TypeError(`${label} missing required keys: ${missing.join(', ')}`);
  }
}

function requireEnum(value, enumValues, label) {
  if (!enumValues.includes(value)) {
    throw new TypeError(
      `${label} must be one of [${enumValues.join(', ')}]; got ${JSON.stringify(value)}`,
    );
  }
}

function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function generateActionKey(parts) {
  const joined = [
    parts.loopRunId || '',
    String(parts.sequence ?? ''),
    parts.actionType || '',
    parts.toolId || '',
    stableHash({
      inputs: parts.inputs || null,
      params: parts.params || null,
      expectedArtifactKinds: parts.expectedArtifactKinds || null,
      attempt: parts.attempt || 1,
    }),
  ].join('|');
  return sha256Hex(joined);
}

function nowIso() {
  return new Date().toISOString();
}

function validateLoopRun(input, { allowPartial = false } = {}) {
  const required = ['loopRunId', 'projectId', 'conversationId', 'loopStatus'];
  requireKeys(input, required, 'loopRun');
  requireEnum(input.loopStatus, LOOP_RUN_STATUSES, 'loopRun.loopStatus');
  if (typeof input.loopRunId !== 'string' || !input.loopRunId) {
    throw new TypeError('loopRun.loopRunId must be a non-empty string');
  }
  if (typeof input.projectId !== 'string' || !input.projectId) {
    throw new TypeError('loopRun.projectId must be a non-empty string');
  }
  if (typeof input.conversationId !== 'string' || !input.conversationId) {
    throw new TypeError('loopRun.conversationId must be a non-empty string');
  }
  if (!allowPartial) {
    if (!input.taskSpecRef || typeof input.taskSpecRef !== 'string') {
      throw new TypeError('loopRun.taskSpecRef must be a non-empty string');
    }
    if (input.automationMode) {
      requireEnum(
        input.automationMode,
        ['guided', 'confirm', 'trusted'],
        'loopRun.automationMode',
      );
    }
  }
  return input;
}

function validateIteration(input, { allowPartial = false } = {}) {
  const required = [
    'loopRunId',
    'sequence',
    'observedStateDigest',
    'decision',
    'decisionReasonCode',
    'status',
  ];
  requireKeys(input, required, 'iteration');
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new TypeError('iteration.sequence must be a positive integer');
  }
  requireEnum(input.decision, DECISION_OUTCOMES, 'iteration.decision');
  requireEnum(input.status, ITERATION_STATUSES, 'iteration.status');
  if (typeof input.observedStateDigest !== 'string') {
    throw new TypeError('iteration.observedStateDigest must be a string');
  }
  if (typeof input.decisionReasonCode !== 'string' || !input.decisionReasonCode) {
    throw new TypeError('iteration.decisionReasonCode must be a non-empty string');
  }
  if (input.publicConclusion !== undefined && typeof input.publicConclusion !== 'string') {
    throw new TypeError('iteration.publicConclusion must be a string when present');
  }
  if (input.goalGapIds !== undefined && !Array.isArray(input.goalGapIds)) {
    throw new TypeError('iteration.goalGapIds must be an array when present');
  }
  if (input.proposedAction !== undefined && input.proposedAction !== null) {
    validateAction(input.proposedAction, { allowPartial: true });
  }
  if (!allowPartial) {
    if (typeof input.publicConclusion !== 'string' || input.publicConclusion.length === 0) {
      throw new TypeError('iteration.publicConclusion must be a non-empty string');
    }
  }
  return input;
}

function validateAction(input, { allowPartial = false } = {}) {
  if (input === null || input === undefined) {
    return null;
  }
  if (!isPlainObject(input)) {
    throw new TypeError('action must be an object');
  }
  requireEnum(input.actionType, ACTION_TYPES, 'action.actionType');
  if (input.actionType === 'run_tool') {
    if (!input.toolId || typeof input.toolId !== 'string') {
      throw new TypeError('action.toolId is required when actionType=run_tool');
    }
  }
  return input;
}

function validateEvidence(input, { allowPartial = false } = {}) {
  if (input === null || input === undefined) {
    return null;
  }
  requireKeys(input, ['evidenceId', 'kind', 'ref'], 'evidence');
  requireEnum(input.kind, EVIDENCE_KINDS, 'evidence.kind');
  return input;
}

function validateDecision(input) {
  requireKeys(input, ['decision', 'decisionReasonCode'], 'decision');
  requireEnum(input.decision, DECISION_OUTCOMES, 'decision.decision');
  return input;
}

function checkStatusTransition(fromStatus, toStatus, transitions) {
  if (fromStatus === toStatus) return true;
  const allowed = transitions[fromStatus];
  if (!allowed) {
    throw new TypeError(`Unknown source status: ${fromStatus}`);
  }
  if (!allowed.has(toStatus)) {
    throw new TypeError(
      `Invalid status transition: ${fromStatus} -> ${toStatus}`,
    );
  }
  return true;
}

function checkLoopStatusTransition(fromStatus, toStatus) {
  return checkStatusTransition(fromStatus, toStatus, LOOP_STATUS_TRANSITIONS);
}

function checkIterationStatusTransition(fromStatus, toStatus) {
  return checkStatusTransition(fromStatus, toStatus, ITERATION_STATUS_TRANSITIONS);
}

function isTerminalLoopStatus(status) {
  return TERMINAL_LOOP_STATUSES.has(status);
}

function buildLoopRun(input) {
  const base = {
    loopRunId: input.loopRunId || generateId('loop'),
    projectId: input.projectId,
    conversationId: input.conversationId,
    taskSpecRef: input.taskSpecRef || null,
    automationMode: input.automationMode || 'guided',
    loopStatus: input.loopStatus || 'planned',
    createdAt: input.createdAt || nowIso(),
    updatedAt: input.updatedAt || nowIso(),
    metadata: redactSensitiveValue(input.metadata || {}),
  };
  validateLoopRun(base);
  const hash = stableHash(pickSemanticFields(base, SEMANTIC_FIELD_KEYS.loopRun));
  return { ...base, hash };
}

function buildIteration(input, { allowPartial = true } = {}) {
  const base = {
    iterationId: input.iterationId || generateId('iter'),
    loopRunId: input.loopRunId,
    sequence: input.sequence,
    observedStateDigest: redactSensitiveValue(input.observedStateDigest || ''),
    goalGapIds: Array.isArray(input.goalGapIds) ? input.goalGapIds.slice() : [],
    proposedAction: input.proposedAction
      ? buildAction(input.proposedAction, { partial: true })
      : null,
    decision: input.decision,
    decisionReasonCode: input.decisionReasonCode,
    confidence: typeof input.confidence === 'number' ? input.confidence : null,
    notes: redactSensitiveValue(input.notes || null),
    publicConclusion: redactSensitiveValue(input.publicConclusion || ''),
    status: input.status || 'pending',
    createdAt: input.createdAt || nowIso(),
    parentIterationHash: input.parentIterationHash || null,
  };
  validateIteration(base, { allowPartial });
  const hash = stableHash(pickSemanticFields(base, SEMANTIC_FIELD_KEYS.iteration));
  return { ...base, hash };
}

function buildAction(input, { partial = false } = {}) {
  if (!input) return null;
  const actionId = input.actionId || generateId('action');
  const attempt = Number.isInteger(input.attempt) ? input.attempt : 1;
  const base = {
    actionId,
    actionKey:
      input.actionKey ||
      generateActionKey({
        loopRunId: input.loopRunId || null,
        sequence: input.sequence || null,
        actionType: input.actionType,
        toolId: input.toolId || null,
        inputs: input.inputs || null,
        params: input.params || null,
        expectedArtifactKinds: input.expectedArtifactKinds || null,
        attempt,
      }),
    actionType: input.actionType,
    toolId: input.toolId || null,
    inputs: redactSensitiveValue(input.inputs || null),
    params: redactSensitiveValue(input.params || null),
    expectedArtifactKinds: Array.isArray(input.expectedArtifactKinds)
      ? input.expectedArtifactKinds.slice()
      : [],
    attempt,
  };
  validateAction(base, { allowPartial: partial });
  const hash = stableHash(pickSemanticFields(base, SEMANTIC_FIELD_KEYS.action));
  return { ...base, hash };
}

function buildEvidence(input) {
  if (!input) return null;
  const base = {
    evidenceId: input.evidenceId || generateId('evid'),
    loopRunId: input.loopRunId || null,
    iterationId: input.iterationId || null,
    kind: input.kind,
    ref: redactSensitiveValue(input.ref),
    summaryDigest: redactSensitiveValue(input.summaryDigest || ''),
    createdAt: input.createdAt || nowIso(),
    parentEvidenceHash: input.parentEvidenceHash || null,
  };
  validateEvidence(base);
  const hash = stableHash(pickSemanticFields(base, SEMANTIC_FIELD_KEYS.evidence));
  return { ...base, hash };
}

function buildDecision(input) {
  const base = {
    decision: input.decision,
    decisionReasonCode: input.decisionReasonCode,
    confidence: typeof input.confidence === 'number' ? input.confidence : null,
    notes: redactSensitiveValue(input.notes || null),
  };
  validateDecision(base);
  const hash = stableHash(pickSemanticFields(base, SEMANTIC_FIELD_KEYS.decision));
  return { ...base, hash };
}

function pickSemanticFields(obj, keys) {
  const out = {};
  for (const k of keys) {
    out[k] = obj[k] === undefined ? null : obj[k];
  }
  return out;
}

function deriveIterationHash(semanticFields) {
  return stableHash(semanticFields);
}

function projectLoopRunPartial(loopRun) {
  return {
    loopRunId: loopRun.loopRunId,
    loopStatus: loopRun.loopStatus || 'planned',
    isPartial: true,
    partialReason: 'legacy_no_loop_data',
    taskSpecRef: loopRun.taskSpecRef || null,
    projectId: loopRun.projectId,
    conversationId: loopRun.conversationId,
  };
}

module.exports = {
  LOOP_CONTRACT_VERSION,
  LOOP_RUN_STATUSES,
  ITERATION_STATUSES,
  ACTION_TYPES,
  DECISION_OUTCOMES,
  EVIDENCE_KINDS,
  REASON_CODES,
  TERMINAL_LOOP_STATUSES,
  LOOP_STATUS_TRANSITIONS,
  ITERATION_STATUS_TRANSITIONS,
  SEMANTIC_FIELD_KEYS,
  canonicalStringify,
  sha256Hex,
  stableHash,
  generateId,
  generateActionKey,
  validateLoopRun,
  validateIteration,
  validateAction,
  validateEvidence,
  validateDecision,
  checkLoopStatusTransition,
  checkIterationStatusTransition,
  isTerminalLoopStatus,
  buildLoopRun,
  buildIteration,
  buildAction,
  buildEvidence,
  buildDecision,
  pickSemanticFields,
  deriveIterationHash,
  projectLoopRunPartial,
  redactSensitiveValue,
};