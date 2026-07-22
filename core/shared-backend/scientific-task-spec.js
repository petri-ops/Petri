'use strict';

const crypto = require('crypto');
const path = require('path');
const { redactSensitiveValue } = require('./redaction');

const SCIENTIFIC_TASK_SPEC_VERSION = 1;
const CONVERSATION_CONTEXT_ENVELOPE_VERSION = 1;
const CONTEXT_CHECKPOINT_VERSION = 1;

const TASK_STATUSES = Object.freeze([
  'draft',
  'requires_user_decision',
  'ready_for_confirmation',
  'confirmed',
  'running',
  'completed',
  'blocked',
  'cancelled',
]);
const INTERACTION_MODES = Object.freeze([
  'conversation',
  'context_assist',
  'task_draft',
  'task_execute',
  'replay',
]);
const ACCESS_MODES = Object.freeze(['read', 'full']);
const AUTOMATION_MODES = Object.freeze(['guided', 'confirm', 'trusted']);
const EXPLANATION_LEVELS = Object.freeze(['concise', 'guided', 'technical']);
const CONFIDENCE_LEVELS = Object.freeze(['unknown', 'low', 'medium', 'high']);

const STATUS_TRANSITIONS = Object.freeze({
  draft: Object.freeze(['requires_user_decision', 'ready_for_confirmation', 'cancelled']),
  requires_user_decision: Object.freeze(['draft', 'ready_for_confirmation', 'cancelled']),
  ready_for_confirmation: Object.freeze(['requires_user_decision', 'confirmed', 'cancelled']),
  confirmed: Object.freeze(['running', 'cancelled']),
  running: Object.freeze(['completed', 'blocked', 'cancelled']),
  blocked: Object.freeze(['draft', 'requires_user_decision', 'cancelled']),
  completed: Object.freeze([]),
  cancelled: Object.freeze([]),
});

const PRIVATE_REASONING_KEYS = new Set([
  'chainOfThought',
  'chain_of_thought',
  'privateReasoning',
  'private_reasoning',
  'hiddenThoughts',
  'hidden_thoughts',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function stringValue(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function nullableString(value) {
  const normalized = stringValue(value);
  return normalized || null;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function uniqueStrings(values, { sort = true } = {}) {
  const output = [...new Set((Array.isArray(values) ? values : []).map((item) => stringValue(item)).filter(Boolean))];
  return sort ? output.sort() : output;
}

function normalizeRelativePath(value) {
  const raw = stringValue(value).replace(/\\/g, '/');
  if (!raw) return '';
  if (/^[A-Za-z]:\//.test(raw) || raw.startsWith('/')) return raw;
  const normalized = path.posix.normalize(raw);
  return normalized === '.' ? '' : normalized.replace(/^\.\//, '');
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || !value) return false;
  if (value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) return false;
  const normalized = value.replace(/\\/g, '/');
  return !normalized.split('/').includes('..') && path.posix.normalize(normalized) === normalized;
}

function normalizeDecision(value, index = 0) {
  if (typeof value === 'string') {
    return {
      id: `decision_${index + 1}`,
      question: value.trim(),
      reason: '',
      required: true,
      options: [],
      status: 'unresolved',
      answer: null,
    };
  }
  const item = value && typeof value === 'object' ? value : {};
  return {
    id: stringValue(item.id, `decision_${index + 1}`),
    question: stringValue(item.question),
    reason: stringValue(item.reason),
    required: item.required !== false,
    options: uniqueStrings(item.options),
    status: ['unresolved', 'confirmed', 'rejected'].includes(item.status) ? item.status : 'unresolved',
    answer: item.answer == null ? null : redactSensitiveValue(item.answer),
  };
}

function normalizeInput(value) {
  const item = value && typeof value === 'object' ? value : {};
  return {
    id: nullableString(item.id),
    role: nullableString(item.role),
    relativePath: normalizeRelativePath(item.relativePath),
    sha256: nullableString(item.sha256)?.toLowerCase() || null,
    sizeBytes: Math.max(0, finiteNumber(item.sizeBytes, 0)),
    schemaSummary: item.schemaSummary && typeof item.schemaSummary === 'object'
      ? redactSensitiveValue(item.schemaSummary)
      : {},
    sourceArtifactRef: nullableString(item.sourceArtifactRef),
  };
}

function unresolvedDecisions(spec) {
  return [
    ...(spec.design?.unresolved || []),
    ...(spec.requiresUserDecision || []).filter((item) => item.required && item.status === 'unresolved'),
  ];
}

function deriveScientificTaskStatus(spec) {
  if (unresolvedDecisions(spec).length > 0) return 'requires_user_decision';
  if (spec.status && TASK_STATUSES.includes(spec.status)) return spec.status;
  return 'draft';
}

function normalizeScientificTaskSpec(input = {}) {
  const source = redactSensitiveValue(input && typeof input === 'object' ? input : {});
  const normalized = {
    schemaVersion: SCIENTIFIC_TASK_SPEC_VERSION,
    taskId: stringValue(source.taskId),
    projectId: stringValue(source.projectId),
    conversationId: stringValue(source.conversationId),
    originalRequest: stringValue(source.originalRequest),
    question: {
      domain: stringValue(source.question?.domain),
      analysisUnit: stringValue(source.question?.analysisUnit),
      questionType: stringValue(source.question?.questionType),
    },
    inputs: (Array.isArray(source.inputs) ? source.inputs : [])
      .map(normalizeInput)
      .sort((left, right) => `${left.relativePath}:${left.role || ''}`.localeCompare(`${right.relativePath}:${right.role || ''}`)),
    design: {
      groups: uniqueStrings(source.design?.groups),
      contrast: source.design?.contrast && typeof source.design.contrast === 'object'
        ? stableValue(redactSensitiveValue(source.design.contrast))
        : {},
      covariates: uniqueStrings(source.design?.covariates),
      replicates: source.design?.replicates && typeof source.design.replicates === 'object'
        ? stableValue(redactSensitiveValue(source.design.replicates))
        : {},
      assumptions: uniqueStrings(source.design?.assumptions),
      unresolved: uniqueStrings(source.design?.unresolved),
    },
    method: {
      category: stringValue(source.method?.category),
      candidateToolIds: uniqueStrings(source.method?.candidateToolIds),
      selectionReason: stringValue(source.method?.selectionReason),
    },
    requestedDeliverables: uniqueStrings(source.requestedDeliverables),
    acceptanceCriteria: uniqueStrings(source.acceptanceCriteria),
    requiresUserDecision: (Array.isArray(source.requiresUserDecision) ? source.requiresUserDecision : [])
      .map(normalizeDecision)
      .sort((left, right) => left.id.localeCompare(right.id)),
    clarification: {
      questionsAsked: uniqueStrings(source.clarification?.questionsAsked, { sort: false }),
      confidence: CONFIDENCE_LEVELS.includes(source.clarification?.confidence)
        ? source.clarification.confidence
        : 'unknown',
      userDecisions: Array.isArray(source.clarification?.userDecisions)
        ? redactSensitiveValue(source.clarification.userDecisions)
        : [],
    },
    execution: {
      accessMode: ACCESS_MODES.includes(source.execution?.accessMode) ? source.execution.accessMode : 'read',
      automationMode: AUTOMATION_MODES.includes(source.execution?.automationMode)
        ? source.execution.automationMode
        : 'guided',
      decisionPolicyVersion: positiveInteger(source.execution?.decisionPolicyVersion, 1),
      resourcePolicyVersion: positiveInteger(source.execution?.resourcePolicyVersion, 1),
      resourceSnapshotRef: nullableString(source.execution?.resourceSnapshotRef),
    },
    presentation: {
      language: stringValue(source.presentation?.language, 'zh-CN'),
      explanationLevel: EXPLANATION_LEVELS.includes(source.presentation?.explanationLevel)
        ? source.presentation.explanationLevel
        : 'guided',
    },
    status: TASK_STATUSES.includes(source.status) ? source.status : 'draft',
  };
  normalized.status = deriveScientificTaskStatus(normalized);
  return normalized;
}

function diagnostic(code, pathValue, message) {
  return { code, path: pathValue, message };
}

function privateReasoningPaths(value, prefix = '', ancestors = new WeakSet()) {
  if (!value || typeof value !== 'object' || ancestors.has(value)) return [];
  ancestors.add(value);
  try {
    const paths = [];
    for (const [key, child] of Object.entries(value)) {
      const childPath = prefix ? `${prefix}.${key}` : key;
      if (PRIVATE_REASONING_KEYS.has(key)) paths.push(childPath);
      paths.push(...privateReasoningPaths(child, childPath, ancestors));
    }
    return paths;
  } finally {
    ancestors.delete(value);
  }
}

function validateScientificTaskSpec(input, options = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const spec = options.normalized === true ? input : normalizeScientificTaskSpec(input);
  const issues = [];
  const requireText = (value, field) => {
    if (typeof value !== 'string' || value.length === 0) issues.push(diagnostic('required', field, `${field} is required`));
  };
  requireText(spec.taskId, 'taskId');
  requireText(spec.projectId, 'projectId');
  requireText(spec.conversationId, 'conversationId');
  requireText(spec.originalRequest, 'originalRequest');
  requireText(spec.question.domain, 'question.domain');
  requireText(spec.question.analysisUnit, 'question.analysisUnit');
  requireText(spec.question.questionType, 'question.questionType');
  requireText(spec.method.category, 'method.category');
  if (raw.schemaVersion !== SCIENTIFIC_TASK_SPEC_VERSION) issues.push(diagnostic('schema_version_unsupported', 'schemaVersion', 'ScientificTaskSpec schemaVersion must be 1'));
  if (raw.status !== undefined && !TASK_STATUSES.includes(raw.status)) issues.push(diagnostic('task_status_invalid', 'status', 'Unknown task status'));
  if (raw.execution?.accessMode !== undefined && !ACCESS_MODES.includes(raw.execution.accessMode)) issues.push(diagnostic('access_mode_invalid', 'execution.accessMode', 'Unknown access mode'));
  if (raw.execution?.automationMode !== undefined && !AUTOMATION_MODES.includes(raw.execution.automationMode)) issues.push(diagnostic('automation_mode_invalid', 'execution.automationMode', 'Unknown automation mode'));
  if (!Array.isArray(spec.inputs) || spec.inputs.length === 0) issues.push(diagnostic('inputs_required', 'inputs', 'At least one input snapshot is required'));
  for (const [index, item] of (Array.isArray(raw.inputs) ? raw.inputs : []).entries()) {
    if (!Number.isFinite(Number(item?.sizeBytes)) || Number(item.sizeBytes) < 0) issues.push(diagnostic('input_size_invalid', `inputs[${index}].sizeBytes`, 'sizeBytes must be an explicit non-negative number'));
  }
  for (const [index, item] of spec.inputs.entries()) {
    if (!isSafeRelativePath(item.relativePath)) issues.push(diagnostic('input_path_invalid', `inputs[${index}].relativePath`, 'Input paths must be normalized repository/project-relative paths'));
    if (item.sha256 !== null && !/^[a-f0-9]{64}$/.test(item.sha256)) issues.push(diagnostic('input_hash_invalid', `inputs[${index}].sha256`, 'sha256 must be 64 lowercase hex or null'));
    if (!Number.isFinite(item.sizeBytes) || item.sizeBytes < 0) issues.push(diagnostic('input_size_invalid', `inputs[${index}].sizeBytes`, 'sizeBytes must be non-negative'));
  }
  if (!TASK_STATUSES.includes(spec.status)) issues.push(diagnostic('task_status_invalid', 'status', 'Unknown task status'));
  const pending = unresolvedDecisions(spec);
  if (pending.length > 0 && !['draft', 'requires_user_decision', 'blocked'].includes(spec.status)) {
    issues.push(diagnostic('unresolved_decision_blocks_execution', 'status', 'Unresolved scientific decisions prevent confirmation or execution'));
  }
  if (spec.status === 'requires_user_decision' && pending.length === 0) {
    issues.push(diagnostic('decision_status_without_decision', 'status', 'requires_user_decision needs at least one unresolved decision'));
  }
  if (['confirmed', 'running', 'completed'].includes(spec.status)) {
    for (const [index, item] of spec.inputs.entries()) {
      if (!item.sha256) issues.push(diagnostic('confirmed_input_hash_required', `inputs[${index}].sha256`, 'Confirmed tasks require immutable input hashes'));
    }
  }
  for (const reasoningPath of privateReasoningPaths(raw)) issues.push(diagnostic('private_reasoning_forbidden', reasoningPath, 'Private reasoning must not be persisted in ScientificTaskSpec'));
  return { ok: issues.length === 0, spec, issues };
}

function hashScientificTaskSpec(input) {
  const result = validateScientificTaskSpec(input);
  if (!result.ok) {
    const error = new Error('scientific_task_spec_invalid');
    error.code = 'scientific_task_spec_invalid';
    error.issues = result.issues;
    throw error;
  }
  return sha256(stableStringify(result.spec));
}

function transitionScientificTaskSpec(input, nextStatus) {
  const result = validateScientificTaskSpec(input);
  if (!result.ok) return { ok: false, error: 'scientific_task_spec_invalid', issues: result.issues };
  if (!TASK_STATUSES.includes(nextStatus)) return { ok: false, error: 'task_status_invalid', from: result.spec.status, to: nextStatus };
  const allowed = STATUS_TRANSITIONS[result.spec.status] || [];
  if (!allowed.includes(nextStatus)) return { ok: false, error: 'task_transition_not_allowed', from: result.spec.status, to: nextStatus, allowed: [...allowed] };
  const candidate = { ...result.spec, status: nextStatus };
  const normalized = normalizeScientificTaskSpec(candidate);
  if (normalized.status !== nextStatus) {
    return { ok: false, error: 'unresolved_decision_blocks_execution', from: result.spec.status, to: nextStatus, status: normalized.status };
  }
  const validated = validateScientificTaskSpec(normalized, { normalized: true });
  if (!validated.ok) return { ok: false, error: 'scientific_task_spec_invalid', issues: validated.issues };
  return { ok: true, spec: normalized, from: result.spec.status, to: nextStatus, specHash: hashScientificTaskSpec(normalized) };
}

function shouldCreateScientificTaskSpec(context = {}) {
  return ['task_draft', 'task_execute', 'replay'].includes(context.interactionMode) && context.explicitTaskIntent === true;
}

function normalizeEvidence(value) {
  const item = value && typeof value === 'object' ? value : {};
  return {
    source: stringValue(item.source),
    relativePath: normalizeRelativePath(item.relativePath),
    startLine: Math.max(1, positiveInteger(item.startLine, 1)),
    endLine: Math.max(1, positiveInteger(item.endLine, 1)),
    sha256: nullableString(item.sha256)?.toLowerCase() || null,
    capturedAt: nullableString(item.capturedAt),
    truncated: item.truncated === true,
  };
}

function normalizeConversationContextEnvelope(input = {}) {
  const source = redactSensitiveValue(input && typeof input === 'object' ? input : {});
  return {
    schemaVersion: CONVERSATION_CONTEXT_ENVELOPE_VERSION,
    projectId: stringValue(source.projectId),
    conversationId: stringValue(source.conversationId),
    interactionMode: INTERACTION_MODES.includes(source.interactionMode) ? source.interactionMode : 'conversation',
    currentIntent: stringValue(source.currentIntent),
    explicitFileRefs: uniqueStrings(source.explicitFileRefs).map(normalizeRelativePath),
    recentMessageIds: uniqueStrings(source.recentMessageIds, { sort: false }),
    conversationSummaryRef: nullableString(source.conversationSummaryRef),
    taskRef: nullableString(source.taskRef),
    activePlanRef: nullableString(source.activePlanRef),
    activeJobRef: nullableString(source.activeJobRef),
    activeArtifactRef: nullableString(source.activeArtifactRef),
    unresolvedDecisions: (Array.isArray(source.unresolvedDecisions) ? source.unresolvedDecisions : []).map(normalizeDecision),
    evidence: (Array.isArray(source.evidence) ? source.evidence : []).map(normalizeEvidence),
    modelContext: {
      profileId: stringValue(source.modelContext?.profileId),
      contextWindow: Math.max(0, finiteNumber(source.modelContext?.contextWindow, 0)),
      maxOutput: Math.max(0, finiteNumber(source.modelContext?.maxOutput, 0)),
      capabilitySnapshotHash: nullableString(source.modelContext?.capabilitySnapshotHash)?.toLowerCase() || null,
      estimatorVersion: positiveInteger(source.modelContext?.estimatorVersion, 1),
    },
    contextBudget: {
      maxUnits: Math.max(0, finiteNumber(source.contextBudget?.maxUnits, 0)),
      usedUnits: Math.max(0, finiteNumber(source.contextBudget?.usedUnits, 0)),
      reservedOutput: Math.max(0, finiteNumber(source.contextBudget?.reservedOutput, 0)),
      safetyMargin: Math.max(0, finiteNumber(source.contextBudget?.safetyMargin, 0)),
    },
    invalidation: {
      projectVersion: nullableString(source.invalidation?.projectVersion),
      conversationVersion: nullableString(source.invalidation?.conversationVersion),
      taskSpecHash: nullableString(source.invalidation?.taskSpecHash)?.toLowerCase() || null,
      evidenceDigest: nullableString(source.invalidation?.evidenceDigest)?.toLowerCase() || null,
    },
    accessMode: ACCESS_MODES.includes(source.accessMode) ? source.accessMode : 'read',
    automationMode: AUTOMATION_MODES.includes(source.automationMode) ? source.automationMode : 'guided',
  };
}

function validateConversationContextEnvelope(input, options = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const envelope = options.normalized === true ? input : normalizeConversationContextEnvelope(input);
  const issues = [];
  if (raw.schemaVersion !== CONVERSATION_CONTEXT_ENVELOPE_VERSION) issues.push(diagnostic('schema_version_unsupported', 'schemaVersion', 'ConversationContextEnvelope schemaVersion must be 1'));
  if (raw.interactionMode !== undefined && !INTERACTION_MODES.includes(raw.interactionMode)) issues.push(diagnostic('interaction_mode_invalid', 'interactionMode', 'Unknown interaction mode'));
  if (raw.accessMode !== undefined && !ACCESS_MODES.includes(raw.accessMode)) issues.push(diagnostic('access_mode_invalid', 'accessMode', 'Unknown access mode'));
  if (raw.automationMode !== undefined && !AUTOMATION_MODES.includes(raw.automationMode)) issues.push(diagnostic('automation_mode_invalid', 'automationMode', 'Unknown automation mode'));
  if (!envelope.projectId) issues.push(diagnostic('required', 'projectId', 'projectId is required'));
  if (!envelope.conversationId) issues.push(diagnostic('required', 'conversationId', 'conversationId is required'));
  if (!INTERACTION_MODES.includes(envelope.interactionMode)) issues.push(diagnostic('interaction_mode_invalid', 'interactionMode', 'Unknown interaction mode'));
  if (envelope.interactionMode === 'conversation' && envelope.taskRef !== null) issues.push(diagnostic('conversation_task_ref_forbidden', 'taskRef', 'Ordinary conversation must not create or attach a new task'));
  for (const [index, ref] of envelope.explicitFileRefs.entries()) {
    if (!isSafeRelativePath(ref)) issues.push(diagnostic('file_ref_invalid', `explicitFileRefs[${index}]`, 'File references must be relative'));
  }
  for (const [index, item] of envelope.evidence.entries()) {
    if (!item.source) issues.push(diagnostic('evidence_source_required', `evidence[${index}].source`, 'Evidence source is required'));
    if (!isSafeRelativePath(item.relativePath)) issues.push(diagnostic('evidence_path_invalid', `evidence[${index}].relativePath`, 'Evidence paths must be relative'));
    if (!item.sha256 || !/^[a-f0-9]{64}$/.test(item.sha256)) issues.push(diagnostic('evidence_hash_invalid', `evidence[${index}].sha256`, 'Evidence requires a SHA-256'));
    if (item.endLine < item.startLine) issues.push(diagnostic('evidence_range_invalid', `evidence[${index}]`, 'endLine must not precede startLine'));
    if (!item.capturedAt || Number.isNaN(Date.parse(item.capturedAt))) issues.push(diagnostic('evidence_time_invalid', `evidence[${index}].capturedAt`, 'capturedAt must be an ISO timestamp'));
  }
  const budget = envelope.contextBudget;
  if (budget.maxUnits <= 0) issues.push(diagnostic('context_budget_required', 'contextBudget.maxUnits', 'A positive context budget is required'));
  if (budget.usedUnits + budget.reservedOutput + budget.safetyMargin > budget.maxUnits) issues.push(diagnostic('context_budget_exceeded', 'contextBudget', 'Used, reserved, and safety units exceed maxUnits'));
  if (envelope.modelContext.contextWindow <= 0) issues.push(diagnostic('model_context_window_required', 'modelContext.contextWindow', 'A positive model context window is required'));
  if (!envelope.modelContext.profileId) issues.push(diagnostic('model_profile_required', 'modelContext.profileId', 'Model profile is required'));
  for (const [field, value] of [
    ['modelContext.capabilitySnapshotHash', envelope.modelContext.capabilitySnapshotHash],
    ['invalidation.taskSpecHash', envelope.invalidation.taskSpecHash],
    ['invalidation.evidenceDigest', envelope.invalidation.evidenceDigest],
  ]) {
    if (value !== null && !/^[a-f0-9]{64}$/.test(value)) issues.push(diagnostic('context_hash_invalid', field, `${field} must be a SHA-256 or null`));
  }
  return { ok: issues.length === 0, envelope, issues };
}

function hashConversationContextEnvelope(input) {
  const result = validateConversationContextEnvelope(input);
  if (!result.ok) {
    const error = new Error('conversation_context_envelope_invalid');
    error.code = 'conversation_context_envelope_invalid';
    error.issues = result.issues;
    throw error;
  }
  return sha256(stableStringify(result.envelope));
}

function sourceMessageDigest(messages = []) {
  const normalized = (Array.isArray(messages) ? messages : []).map((item) => ({
    id: stringValue(item?.id),
    role: stringValue(item?.role),
    contentSha256: sha256(String(item?.content || '')),
  }));
  return sha256(stableStringify(normalized));
}

function normalizeContextCheckpoint(input = {}) {
  const source = redactSensitiveValue(input && typeof input === 'object' ? input : {});
  const normalizeRefList = (value) => uniqueStrings(value);
  return {
    schemaVersion: CONTEXT_CHECKPOINT_VERSION,
    checkpointId: stringValue(source.checkpointId),
    projectId: stringValue(source.projectId),
    conversationId: stringValue(source.conversationId),
    sourceMessageRange: {
      firstId: stringValue(source.sourceMessageRange?.firstId),
      lastId: stringValue(source.sourceMessageRange?.lastId),
      count: Math.max(0, finiteNumber(source.sourceMessageRange?.count, 0)),
    },
    sourceDigest: nullableString(source.sourceDigest)?.toLowerCase() || null,
    policyVersion: positiveInteger(source.policyVersion, 1),
    generatedBy: {
      mode: ['deterministic', 'deterministic+summary'].includes(source.generatedBy?.mode)
        ? source.generatedBy.mode
        : 'deterministic',
      modelProfileId: nullableString(source.generatedBy?.modelProfileId),
      rulesVersion: positiveInteger(source.generatedBy?.rulesVersion, 1),
    },
    summary: stringValue(source.summary),
    taskRefs: normalizeRefList(source.taskRefs),
    confirmedDecisions: Array.isArray(source.confirmedDecisions) ? redactSensitiveValue(source.confirmedDecisions) : [],
    rejectedOptions: Array.isArray(source.rejectedOptions) ? redactSensitiveValue(source.rejectedOptions) : [],
    unresolvedDecisions: (Array.isArray(source.unresolvedDecisions) ? source.unresolvedDecisions : []).map(normalizeDecision),
    constraints: Array.isArray(source.constraints) ? redactSensitiveValue(source.constraints) : [],
    evidenceRefs: normalizeRefList(source.evidenceRefs),
    toolTraceRefs: normalizeRefList(source.toolTraceRefs),
    jobRefs: normalizeRefList(source.jobRefs),
    artifactRefs: normalizeRefList(source.artifactRefs),
    editManifestRefs: normalizeRefList(source.editManifestRefs),
    supersedes: nullableString(source.supersedes),
    coverage: {
      requiredFieldsPresent: source.coverage?.requiredFieldsPresent === true,
      missing: uniqueStrings(source.coverage?.missing),
    },
    createdAt: nullableString(source.createdAt),
  };
}

function validateContextCheckpoint(input, options = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const checkpoint = options.normalized === true ? input : normalizeContextCheckpoint(input);
  const issues = [];
  if (raw.schemaVersion !== CONTEXT_CHECKPOINT_VERSION) issues.push(diagnostic('schema_version_unsupported', 'schemaVersion', 'ContextCheckpoint schemaVersion must be 1'));
  if (raw.generatedBy?.mode !== undefined && !['deterministic', 'deterministic+summary'].includes(raw.generatedBy.mode)) issues.push(diagnostic('checkpoint_generator_mode_invalid', 'generatedBy.mode', 'Unknown checkpoint generator mode'));
  for (const field of ['checkpointId', 'projectId', 'conversationId']) {
    if (!checkpoint[field]) issues.push(diagnostic('required', field, `${field} is required`));
  }
  if (!checkpoint.sourceMessageRange.firstId || !checkpoint.sourceMessageRange.lastId || !Number.isInteger(checkpoint.sourceMessageRange.count) || checkpoint.sourceMessageRange.count <= 0) issues.push(diagnostic('source_message_range_invalid', 'sourceMessageRange', 'A non-empty integer source message range is required'));
  if (!checkpoint.sourceDigest || !/^[a-f0-9]{64}$/.test(checkpoint.sourceDigest)) issues.push(diagnostic('source_digest_invalid', 'sourceDigest', 'sourceDigest must be a SHA-256'));
  if (checkpoint.generatedBy.mode === 'deterministic+summary' && !checkpoint.generatedBy.modelProfileId) issues.push(diagnostic('summary_model_profile_required', 'generatedBy.modelProfileId', 'Summary-assisted checkpoints must identify the model profile'));
  if (checkpoint.supersedes === checkpoint.checkpointId) issues.push(diagnostic('checkpoint_self_supersede', 'supersedes', 'A checkpoint cannot supersede itself'));
  if (checkpoint.coverage.requiredFieldsPresent && checkpoint.coverage.missing.length > 0) issues.push(diagnostic('checkpoint_coverage_inconsistent', 'coverage', 'Coverage cannot be complete while fields are missing'));
  if (!checkpoint.createdAt || Number.isNaN(Date.parse(checkpoint.createdAt))) issues.push(diagnostic('checkpoint_time_invalid', 'createdAt', 'createdAt must be an ISO timestamp'));
  return { ok: issues.length === 0, checkpoint, issues };
}

function validateCheckpointSupersession(currentInput, previousInput) {
  const current = validateContextCheckpoint(currentInput);
  const previous = validateContextCheckpoint(previousInput);
  if (!current.ok || !previous.ok) return { ok: false, error: 'checkpoint_invalid', issues: [...current.issues, ...previous.issues] };
  if (current.checkpoint.projectId !== previous.checkpoint.projectId || current.checkpoint.conversationId !== previous.checkpoint.conversationId) return { ok: false, error: 'checkpoint_scope_mismatch' };
  if (current.checkpoint.supersedes !== previous.checkpoint.checkpointId) return { ok: false, error: 'checkpoint_supersedes_mismatch' };
  if (current.checkpoint.sourceMessageRange.count < previous.checkpoint.sourceMessageRange.count) return { ok: false, error: 'checkpoint_source_range_regression' };
  if (Date.parse(current.checkpoint.createdAt) < Date.parse(previous.checkpoint.createdAt)) return { ok: false, error: 'checkpoint_time_regression' };
  return { ok: true, checkpoint: current.checkpoint };
}

function shouldRereadCheckpointSource(request = {}) {
  return request.requiresExactEvidence === true || ['exact_quote', 'exact_parameter', 'exact_file_content', 'tool_failure_detail'].includes(request.questionType);
}

module.exports = {
  SCIENTIFIC_TASK_SPEC_VERSION,
  CONVERSATION_CONTEXT_ENVELOPE_VERSION,
  CONTEXT_CHECKPOINT_VERSION,
  TASK_STATUSES,
  STATUS_TRANSITIONS,
  INTERACTION_MODES,
  ACCESS_MODES,
  AUTOMATION_MODES,
  normalizeScientificTaskSpec,
  validateScientificTaskSpec,
  hashScientificTaskSpec,
  deriveScientificTaskStatus,
  transitionScientificTaskSpec,
  shouldCreateScientificTaskSpec,
  normalizeConversationContextEnvelope,
  validateConversationContextEnvelope,
  hashConversationContextEnvelope,
  sourceMessageDigest,
  normalizeContextCheckpoint,
  validateContextCheckpoint,
  validateCheckpointSupersession,
  shouldRereadCheckpointSource,
  stableStringify,
  isSafeRelativePath,
};
