'use strict';

const crypto = require('node:crypto');

const RESULT_STUDIO_QUALIFICATION_VERSION = 2;
const RESULT_STUDIO_PRODUCT_TRACE_VERSION = 1;

const REQUIRED_TASKS = Object.freeze([
  'deg_selection_to_enrichment',
  'volcano_ai_presentation_edit',
  'heatmap_manual_then_ai_edit',
  'scientific_threshold_recompute',
  'historical_alternative_compare',
]);

const REQUIRED_ENVIRONMENTS = Object.freeze([
  'managed_non_git',
  'existing_clean_git',
  'existing_dirty_git',
  'restart_and_interruption',
  'light_theme',
  'dark_theme',
  'viewport_820',
  'viewport_wide',
  'two_real_providers',
]);

const REQUIRED_TRACE_STEPS = Object.freeze([
  'conversation',
  'open_artifact',
  'selection_or_manual_edit',
  'agent_context_envelope',
  'provider_tool_call',
  'result_edit_intent',
  'changeset',
  'real_job',
  'artifact_truth_and_validator',
  'candidate_revision',
  'compare',
  'adopt_or_revert',
  'restart_or_reopen',
  'replay_verification',
]);

const REQUIRED_INVARIANTS = Object.freeze([
  'source_data_preserved',
  'artifact_history_preserved',
  'unrelated_git_wip_preserved',
  'no_false_success',
  'no_partial_adopt',
  'no_silent_loss',
  'independent_replayable_scripts',
]);

const QUALIFYING_EVIDENCE_KINDS = Object.freeze([
  'conversation_event',
  'ui_event',
  'context_snapshot',
  'provider_tool_call',
  'database_record',
  'git_record',
  'artifact_truth',
  'validator_record',
  'restart_event',
  'replay_record',
  'packaged_runtime',
  'screenshot',
]);

const FORBIDDEN_EVIDENCE_KINDS = Object.freeze([
  'manual_boolean',
  'asserted_constant',
  'test_pass_summary',
  'prompt_expected_json',
]);

const STEP_EVIDENCE_KINDS = Object.freeze({
  conversation: ['conversation_event'],
  open_artifact: ['ui_event'],
  selection_or_manual_edit: ['ui_event'],
  agent_context_envelope: ['context_snapshot'],
  provider_tool_call: ['provider_tool_call'],
  result_edit_intent: ['database_record'],
  changeset: ['database_record', 'git_record'],
  real_job: ['database_record'],
  artifact_truth_and_validator: ['artifact_truth', 'validator_record'],
  candidate_revision: ['database_record', 'git_record'],
  compare: ['ui_event'],
  adopt_or_revert: ['database_record', 'git_record'],
  restart_or_reopen: ['restart_event'],
  replay_verification: ['replay_record'],
});

const HISTORICAL_EVIDENCE_POLICY = Object.freeze({
  'rs9-product-acceptance': Object.freeze({
    classification: 'synthetic_integration_summary',
    qualificationEligible: false,
    reasons: Object.freeze([
      'tasks_composed_from_independent_test_results',
      'invariants_contain_asserted_constants',
      'no_continuous_product_trace',
    ]),
  }),
  'rs9-provider-acceptance': Object.freeze({
    classification: 'provider_prompt_probe',
    qualificationEligible: false,
    reasons: Object.freeze([
      'expected_json_embedded_in_prompt',
      'no_result_studio_tool_call',
      'no_job_artifact_revision_chain',
    ]),
  }),
  'rs9-visual-acceptance': Object.freeze({
    classification: 'renderer_fixture_review',
    qualificationEligible: false,
    reasons: Object.freeze([
      'inspection_booleans_are_human_assertions',
      'screenshots_do_not_prove_task_completion',
      'no_continuous_product_trace',
    ]),
  }),
  'rs9-visual-table-seed': Object.freeze({
    classification: 'renderer_database_seed',
    qualificationEligible: false,
    reasons: Object.freeze([
      'tool_jobs_artifacts_revisions_and_changesets_created_directly',
      'does_not_execute_admitted_plugin_through_product_flow',
    ]),
  }),
});

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/.test(String(value || ''));
}

function isCommit(value) {
  return /^[a-f0-9]{40}$/.test(String(value || ''));
}

function isSafeEvidenceRef(value) {
  const ref = String(value || '');
  return ref.length > 0
    && ref.length <= 512
    && !ref.startsWith('/')
    && !/^[A-Za-z]:[\\/]/.test(ref)
    && !/^https?:\/\//i.test(ref)
    && !ref.includes('..');
}

function uniqueIds(items) {
  const ids = (Array.isArray(items) ? items : []).map((item) => item && item.id).filter(Boolean);
  return ids.length === new Set(ids).size;
}

function validateProductTrace(trace = {}) {
  const issues = [];
  if (!trace || typeof trace !== 'object') return Object.freeze({ valid: false, issues: ['trace_not_object'] });
  if (trace.schemaVersion !== RESULT_STUDIO_PRODUCT_TRACE_VERSION) issues.push('trace_schema_version_mismatch');
  if (typeof trace.traceId !== 'string' || trace.traceId.length < 8) issues.push('trace_id_invalid');
  if (!REQUIRED_TASKS.includes(trace.taskId)) issues.push('trace_task_unknown');
  if (!isCommit(trace.sourceCommit)) issues.push('trace_source_commit_invalid');
  if (!isSha256(trace.projectRefHash)) issues.push('trace_project_ref_hash_invalid');
  if (!isSha256(trace.conversationRefHash)) issues.push('trace_conversation_ref_hash_invalid');
  if (trace.appMode !== 'packaged_desktop_app') issues.push('trace_not_packaged_app');
  if (trace.platform !== 'macos-arm64') issues.push('trace_platform_not_qualified');
  if (typeof trace.providerClass !== 'string' || trace.providerClass.length === 0) issues.push('trace_provider_class_missing');
  if (trace.userSuppliedInternalIds !== false) issues.push('trace_user_supplied_internal_ids_not_disproved');
  if (!Number.isFinite(Date.parse(trace.startedAt || ''))) issues.push('trace_started_at_invalid');
  if (!Number.isFinite(Date.parse(trace.completedAt || ''))) issues.push('trace_completed_at_invalid');
  if (Date.parse(trace.completedAt || '') < Date.parse(trace.startedAt || '')) issues.push('trace_time_order_invalid');

  const evidence = Array.isArray(trace.evidence) ? trace.evidence : [];
  if (!uniqueIds(evidence)) issues.push('trace_evidence_ids_duplicate');
  const evidenceById = new Map();
  for (const item of evidence) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || item.id.length === 0) {
      issues.push('trace_evidence_id_invalid');
      continue;
    }
    evidenceById.set(item.id, item);
    if (!QUALIFYING_EVIDENCE_KINDS.includes(item.kind)) issues.push(`trace_evidence_kind_not_qualifying:${item.id}`);
    if (FORBIDDEN_EVIDENCE_KINDS.includes(item.kind)) issues.push(`trace_evidence_kind_forbidden:${item.id}`);
    if (!isSafeEvidenceRef(item.sourceRef)) issues.push(`trace_evidence_ref_unsafe:${item.id}`);
    if (!isSha256(item.digest)) issues.push(`trace_evidence_digest_invalid:${item.id}`);
    if (!Number.isFinite(Date.parse(item.observedAt || ''))) issues.push(`trace_evidence_observed_at_invalid:${item.id}`);
  }

  const steps = Array.isArray(trace.steps) ? trace.steps : [];
  if (!uniqueIds(steps)) issues.push('trace_step_ids_duplicate');
  const observedStepIds = steps.map((step) => step && step.id);
  if (JSON.stringify(observedStepIds) !== JSON.stringify(REQUIRED_TRACE_STEPS)) issues.push('trace_steps_not_complete_and_ordered');
  for (const step of steps) {
    if (!step || !REQUIRED_TRACE_STEPS.includes(step.id)) continue;
    if (step.status !== 'observed') issues.push(`trace_step_not_observed:${step.id}`);
    if (typeof step.eventId !== 'string' || step.eventId.length === 0) issues.push(`trace_step_event_id_missing:${step.id}`);
    const refs = Array.isArray(step.evidenceRefs) ? step.evidenceRefs : [];
    if (refs.length === 0) issues.push(`trace_step_evidence_missing:${step.id}`);
    const kinds = new Set();
    for (const ref of refs) {
      const item = evidenceById.get(ref);
      if (!item) issues.push(`trace_step_evidence_unknown:${step.id}:${ref}`);
      else kinds.add(item.kind);
    }
    for (const requiredKind of STEP_EVIDENCE_KINDS[step.id] || []) {
      if (!kinds.has(requiredKind)) issues.push(`trace_step_evidence_kind_missing:${step.id}:${requiredKind}`);
    }
  }

  const invariants = Array.isArray(trace.invariants) ? trace.invariants : [];
  if (!uniqueIds(invariants)) issues.push('trace_invariant_ids_duplicate');
  const invariantById = new Map(invariants.map((item) => [item && item.id, item]));
  for (const id of REQUIRED_INVARIANTS) {
    const invariant = invariantById.get(id);
    if (!invariant) {
      issues.push(`trace_invariant_missing:${id}`);
      continue;
    }
    if (invariant.status !== 'observed_pass') issues.push(`trace_invariant_not_observed_pass:${id}`);
    const refs = Array.isArray(invariant.evidenceRefs) ? invariant.evidenceRefs : [];
    if (refs.length === 0) issues.push(`trace_invariant_evidence_missing:${id}`);
    for (const ref of refs) if (!evidenceById.has(ref)) issues.push(`trace_invariant_evidence_unknown:${id}:${ref}`);
  }

  const environmentTags = new Set(Array.isArray(trace.environmentTags) ? trace.environmentTags : []);
  if (environmentTags.size === 0) issues.push('trace_environment_tags_missing');
  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze([...new Set(issues)]),
    traceDigest: sha256(JSON.stringify(trace)),
  });
}

function evaluateResultStudioQualification(report = {}) {
  const traces = Array.isArray(report.productTraces) ? report.productTraces : [];
  const validated = traces.map((trace) => ({ trace, verdict: validateProductTrace(trace) }));
  const validTraces = validated.filter(({ verdict }) => verdict.valid).map(({ trace }) => trace);
  const taskIds = new Set(validTraces.map((trace) => trace.taskId));
  const providerClasses = new Set(validTraces.map((trace) => trace.providerClass));
  const environments = new Set(validTraces.flatMap((trace) => trace.environmentTags || []));
  const missingTasks = REQUIRED_TASKS.filter((id) => !taskIds.has(id));
  const missingEnvironments = REQUIRED_ENVIRONMENTS.filter((id) => !environments.has(id));
  const checks = {
    schema: report.schemaVersion === RESULT_STUDIO_QUALIFICATION_VERSION,
    allTracesValid: traces.length > 0 && validTraces.length === traces.length,
    taskMatrix: missingTasks.length === 0,
    environmentMatrix: missingEnvironments.length === 0,
    twoRealProviders: providerClasses.size >= 2,
    packagedOnly: validTraces.length > 0 && validTraces.every((trace) => trace.appMode === 'packaged_desktop_app'),
    privacy: report.privacyClean === true,
  };
  const passed = Object.values(checks).every(Boolean);
  return Object.freeze({
    passed,
    checks: Object.freeze(checks),
    missingTasks: Object.freeze(missingTasks),
    missingEnvironments: Object.freeze(missingEnvironments),
    invalidTraces: Object.freeze(validated.filter(({ verdict }) => !verdict.valid).map(({ trace, verdict }) => ({ traceId: trace.traceId || null, issues: verdict.issues }))),
    providerClassCount: providerClasses.size,
    qualificationDigest: sha256(JSON.stringify({ checks, missingTasks, missingEnvironments, traceDigests: validated.map(({ verdict }) => verdict.traceDigest) })),
  });
}

function classifyHistoricalEvidence(id) {
  const classification = HISTORICAL_EVIDENCE_POLICY[id];
  return classification || Object.freeze({
    classification: 'unknown_unclassified',
    qualificationEligible: false,
    reasons: Object.freeze(['evidence_not_registered']),
  });
}

module.exports = {
  RESULT_STUDIO_QUALIFICATION_VERSION,
  RESULT_STUDIO_PRODUCT_TRACE_VERSION,
  REQUIRED_TASKS,
  REQUIRED_ENVIRONMENTS,
  REQUIRED_TRACE_STEPS,
  REQUIRED_INVARIANTS,
  QUALIFYING_EVIDENCE_KINDS,
  FORBIDDEN_EVIDENCE_KINDS,
  HISTORICAL_EVIDENCE_POLICY,
  validateProductTrace,
  evaluateResultStudioQualification,
  classifyHistoricalEvidence,
};
