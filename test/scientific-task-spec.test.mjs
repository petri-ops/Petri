import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const taskContract = require('../core/shared-backend/scientific-task-spec.js');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function validSpec(overrides = {}) {
  return {
    schemaVersion: 1,
    taskId: 'st_bulk_001',
    projectId: 'p_demo',
    conversationId: 'c_demo',
    originalRequest: '比较 KO 和 WT 的差异表达和功能通路。',
    question: {
      domain: 'transcriptomics',
      analysisUnit: 'biological_sample',
      questionType: 'differential_expression',
    },
    inputs: [
      { id: 'counts', role: 'counts', relativePath: 'data/counts.csv', sha256: HASH_A, sizeBytes: 120, schemaSummary: { columns: 8 } },
      { id: 'metadata', role: 'metadata', relativePath: 'data/metadata.csv', sha256: HASH_B, sizeBytes: 80, schemaSummary: { columns: ['sample', 'group'] } },
    ],
    design: {
      groups: ['WT', 'KO'],
      contrast: { factor: 'group', reference: 'WT', treatment: 'KO' },
      covariates: [],
      replicates: { WT: 3, KO: 3 },
      assumptions: ['independent biological replicates'],
      unresolved: [],
    },
    method: {
      category: 'differential_expression',
      candidateToolIds: ['deseq2'],
      selectionReason: 'integer count matrix with biological replicates',
    },
    requestedDeliverables: ['deg_table', 'volcano_plot', 'evidence_report'],
    acceptanceCriteria: ['all artifacts have provenance'],
    requiresUserDecision: [],
    clarification: { questionsAsked: [], confidence: 'high', userDecisions: [] },
    execution: { accessMode: 'read', automationMode: 'guided', decisionPolicyVersion: 1, resourcePolicyVersion: 1, resourceSnapshotRef: null },
    presentation: { language: 'zh-CN', explanationLevel: 'guided' },
    status: 'ready_for_confirmation',
    ...overrides,
  };
}

function validEnvelope(overrides = {}) {
  return {
    schemaVersion: 1,
    projectId: 'p_demo',
    conversationId: 'c_demo',
    interactionMode: 'task_draft',
    currentIntent: 'draft a differential expression task',
    explicitFileRefs: ['data/counts.csv'],
    recentMessageIds: ['msg_1', 'msg_2'],
    conversationSummaryRef: null,
    taskRef: 'st_bulk_001',
    activePlanRef: null,
    activeJobRef: null,
    activeArtifactRef: null,
    unresolvedDecisions: [],
    evidence: [{ source: 'workspace_read', relativePath: 'data/counts.csv', startLine: 1, endLine: 8, sha256: HASH_A, capturedAt: '2026-07-22T00:00:00.000Z', truncated: true }],
    modelContext: { profileId: 'model_agent', contextWindow: 128000, maxOutput: 8000, capabilitySnapshotHash: HASH_B, estimatorVersion: 1 },
    contextBudget: { maxUnits: 100000, usedUnits: 20000, reservedOutput: 8000, safetyMargin: 5000 },
    invalidation: { projectVersion: 'pv_1', conversationVersion: 'cv_2', taskSpecHash: HASH_A, evidenceDigest: HASH_B },
    accessMode: 'read',
    automationMode: 'guided',
    ...overrides,
  };
}

function validCheckpoint(overrides = {}) {
  return {
    schemaVersion: 1,
    checkpointId: 'ctxcp_001',
    projectId: 'p_demo',
    conversationId: 'c_demo',
    sourceMessageRange: { firstId: 'msg_1', lastId: 'msg_10', count: 10 },
    sourceDigest: HASH_A,
    policyVersion: 1,
    generatedBy: { mode: 'deterministic+summary', modelProfileId: 'model_summary', rulesVersion: 1 },
    summary: '用户要比较 KO 和 WT；必须保留原始 counts。',
    taskRefs: ['st_bulk_001'],
    confirmedDecisions: [{ id: 'contrast', answer: 'KO vs WT' }],
    rejectedOptions: ['do not remove outliers automatically'],
    unresolvedDecisions: [],
    constraints: ['do not alter raw input'],
    evidenceRefs: ['ev_1'],
    toolTraceRefs: ['trace_1'],
    jobRefs: [],
    artifactRefs: [],
    editManifestRefs: [],
    supersedes: null,
    coverage: { requiredFieldsPresent: true, missing: [] },
    createdAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

test('ScientificTaskSpec v1 normalizes set-like fields and produces a stable hash', () => {
  const first = validSpec({
    design: { ...validSpec().design, groups: ['WT', 'KO', 'WT'] },
    method: { ...validSpec().method, candidateToolIds: ['deseq2', 'limma', 'deseq2'] },
  });
  const second = validSpec({
    inputs: [...validSpec().inputs].reverse(),
    design: { ...validSpec().design, groups: ['KO', 'WT'] },
    method: { ...validSpec().method, candidateToolIds: ['limma', 'deseq2'] },
  });
  assert.deepEqual(taskContract.normalizeScientificTaskSpec(first), taskContract.normalizeScientificTaskSpec(second));
  assert.equal(taskContract.hashScientificTaskSpec(first), taskContract.hashScientificTaskSpec(second));
});

test('ScientificTaskSpec redacts credentials and rejects private reasoning persistence', () => {
  const normalized = taskContract.normalizeScientificTaskSpec(validSpec({
    originalRequest: 'use api_key=sk-abcdefghijklmnopqrstuvwxyz123456',
    inputs: [{ relativePath: 'data/counts.csv', sha256: HASH_A, sizeBytes: 1, schemaSummary: { apiKey: 'secret-value' } }],
  }));
  assert.match(normalized.originalRequest, /\[REDACTED\]/);
  assert.equal(normalized.inputs[0].schemaSummary.apiKey, '[REDACTED]');

  const result = taskContract.validateScientificTaskSpec(validSpec({ chainOfThought: 'must not persist' }));
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((item) => item.code === 'private_reasoning_forbidden'));
});

test('schema validation reports unsupported versions and illegal automation values', () => {
  const result = taskContract.validateScientificTaskSpec(validSpec({ schemaVersion: 2, execution: { ...validSpec().execution, automationMode: 'automatic' } }));
  assert.ok(result.issues.some((item) => item.code === 'schema_version_unsupported'));
  assert.ok(result.issues.some((item) => item.code === 'automation_mode_invalid'));
  const envelope = taskContract.validateConversationContextEnvelope(validEnvelope({ schemaVersion: 2, interactionMode: 'task_auto' }));
  assert.ok(envelope.issues.some((item) => item.code === 'schema_version_unsupported'));
  assert.ok(envelope.issues.some((item) => item.code === 'interaction_mode_invalid'));
  const checkpoint = taskContract.validateContextCheckpoint(validCheckpoint({ schemaVersion: 2, generatedBy: { mode: 'llm_magic', modelProfileId: 'model_summary', rulesVersion: 1 } }));
  assert.ok(checkpoint.issues.some((item) => item.code === 'schema_version_unsupported'));
  assert.ok(checkpoint.issues.some((item) => item.code === 'checkpoint_generator_mode_invalid'));
});

test('missing contrast information forces requires_user_decision in every automation mode', () => {
  for (const automationMode of ['guided', 'confirm', 'trusted']) {
    const result = taskContract.validateScientificTaskSpec(validSpec({
      design: { ...validSpec().design, contrast: {}, unresolved: ['contrast'] },
      requiresUserDecision: [{ id: 'contrast', question: '哪一组是处理组？', required: true }],
      execution: { ...validSpec().execution, automationMode },
      status: 'confirmed',
    }));
    assert.equal(result.ok, true);
    assert.equal(result.spec.status, 'requires_user_decision');
  }
});

test('absolute and escaping input paths are rejected', () => {
  for (const relativePath of ['/Users/demo/counts.csv', '../counts.csv', 'C:\\data\\counts.csv']) {
    const result = taskContract.validateScientificTaskSpec(validSpec({ inputs: [{ relativePath, sha256: HASH_A, sizeBytes: 1 }] }));
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((item) => item.code === 'input_path_invalid'));
  }
});

test('confirmed tasks require immutable input hashes', () => {
  const result = taskContract.validateScientificTaskSpec(validSpec({ status: 'confirmed', inputs: [{ relativePath: 'data/counts.csv', sha256: null, sizeBytes: 1 }] }));
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((item) => item.code === 'confirmed_input_hash_required'));
});

test('task status transitions are explicit and terminal states cannot reopen silently', () => {
  const confirmed = taskContract.transitionScientificTaskSpec(validSpec(), 'confirmed');
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.spec.status, 'confirmed');
  assert.match(confirmed.specHash, /^[a-f0-9]{64}$/);

  const running = taskContract.transitionScientificTaskSpec(confirmed.spec, 'running');
  const completed = taskContract.transitionScientificTaskSpec(running.spec, 'completed');
  assert.equal(completed.ok, true);
  assert.equal(taskContract.transitionScientificTaskSpec(completed.spec, 'draft').error, 'task_transition_not_allowed');
});

test('ordinary conversation never creates a ScientificTaskSpec without explicit task intent', () => {
  assert.equal(taskContract.shouldCreateScientificTaskSpec({ interactionMode: 'conversation', explicitTaskIntent: true }), false);
  assert.equal(taskContract.shouldCreateScientificTaskSpec({ interactionMode: 'context_assist', explicitTaskIntent: true }), false);
  assert.equal(taskContract.shouldCreateScientificTaskSpec({ interactionMode: 'task_draft', explicitTaskIntent: false }), false);
  assert.equal(taskContract.shouldCreateScientificTaskSpec({ interactionMode: 'task_draft', explicitTaskIntent: true }), true);
});

test('ConversationContextEnvelope v1 validates scope, evidence and budget and hashes stably', () => {
  const result = taskContract.validateConversationContextEnvelope(validEnvelope());
  assert.equal(result.ok, true);
  assert.match(taskContract.hashConversationContextEnvelope(validEnvelope()), /^[a-f0-9]{64}$/);
  assert.equal(taskContract.hashConversationContextEnvelope(validEnvelope()), taskContract.hashConversationContextEnvelope({ ...validEnvelope(), explicitFileRefs: ['data/counts.csv', 'data/counts.csv'] }));
});

test('ordinary conversation cannot attach a task and over-budget envelopes are rejected', () => {
  const conversation = taskContract.validateConversationContextEnvelope(validEnvelope({ interactionMode: 'conversation', taskRef: 'st_forbidden' }));
  assert.ok(conversation.issues.some((item) => item.code === 'conversation_task_ref_forbidden'));

  const overBudget = taskContract.validateConversationContextEnvelope(validEnvelope({ contextBudget: { maxUnits: 100, usedUnits: 90, reservedOutput: 20, safetyMargin: 10 } }));
  assert.ok(overBudget.issues.some((item) => item.code === 'context_budget_exceeded'));
});

test('ContextCheckpoint v1 stores a source digest without retaining raw message text', () => {
  const messages = [
    { id: 'msg_1', role: 'user', content: '不要删除原始样本。' },
    { id: 'msg_2', role: 'assistant', content: '已记录。' },
  ];
  const digest = taskContract.sourceMessageDigest(messages);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.ok(!digest.includes('原始样本'));
  const result = taskContract.validateContextCheckpoint(validCheckpoint({ sourceDigest: digest }));
  assert.equal(result.ok, true);
});

test('summary-assisted checkpoints require a model profile and consistent coverage', () => {
  const missingProfile = taskContract.validateContextCheckpoint(validCheckpoint({ generatedBy: { mode: 'deterministic+summary', modelProfileId: null, rulesVersion: 1 } }));
  assert.ok(missingProfile.issues.some((item) => item.code === 'summary_model_profile_required'));
  const inconsistent = taskContract.validateContextCheckpoint(validCheckpoint({ coverage: { requiredFieldsPresent: true, missing: ['constraints'] } }));
  assert.ok(inconsistent.issues.some((item) => item.code === 'checkpoint_coverage_inconsistent'));
});

test('checkpoint supersession preserves conversation/project scope', () => {
  const previous = validCheckpoint();
  const current = validCheckpoint({ checkpointId: 'ctxcp_002', supersedes: 'ctxcp_001', sourceMessageRange: { firstId: 'msg_1', lastId: 'msg_20', count: 20 } });
  assert.equal(taskContract.validateCheckpointSupersession(current, previous).ok, true);
  assert.equal(taskContract.validateCheckpointSupersession({ ...current, conversationId: 'c_other' }, previous).error, 'checkpoint_scope_mismatch');
});

test('exact questions require rereading raw messages or traces', () => {
  assert.equal(taskContract.shouldRereadCheckpointSource({ questionType: 'exact_parameter' }), true);
  assert.equal(taskContract.shouldRereadCheckpointSource({ requiresExactEvidence: true }), true);
  assert.equal(taskContract.shouldRereadCheckpointSource({ questionType: 'narrative_summary' }), false);
});
