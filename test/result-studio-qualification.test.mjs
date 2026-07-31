import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  REQUIRED_TASKS,
  REQUIRED_ENVIRONMENTS,
  REQUIRED_TRACE_STEPS,
  REQUIRED_INVARIANTS,
  RESULT_STUDIO_QUALIFICATION_VERSION,
  RESULT_STUDIO_PRODUCT_TRACE_VERSION,
  validateProductTrace,
  evaluateResultStudioQualification,
  classifyHistoricalEvidence,
} = require('../core/shared-backend/result-studio-qualification');
const {
  buildTableInteractionManifest,
  buildQuerySelection,
  describeSelectionForAgent,
} = require('../core/shared-backend/artifact-interaction');
const { planResultEdit } = require('../core/shared-backend/result-edit-intent');
const { computeExecutionProvenanceHash } = require('../core/shared-backend/execution-provenance');

const evidenceKindForStep = {
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
};

function productTrace(taskId, index, environmentTags = REQUIRED_ENVIRONMENTS) {
  const evidence = [];
  const steps = REQUIRED_TRACE_STEPS.map((id, stepIndex) => {
    const evidenceRefs = evidenceKindForStep[id].map((kind, kindIndex) => {
      const evidenceId = `ev_${index}_${stepIndex}_${kindIndex}`;
      evidence.push({
        id: evidenceId,
        kind,
        sourceRef: `${kind}:trace-${index}/event-${stepIndex}-${kindIndex}`,
        digest: String(index + stepIndex + kindIndex + 1).padStart(64, 'a').slice(-64),
        observedAt: `2026-07-25T08:${String(stepIndex).padStart(2, '0')}:00.000Z`,
      });
      return evidenceId;
    });
    return { id, status: 'observed', eventId: `event_${index}_${stepIndex}`, evidenceRefs };
  });
  return {
    schemaVersion: RESULT_STUDIO_PRODUCT_TRACE_VERSION,
    traceId: `trace-product-${index}`,
    taskId,
    sourceCommit: 'a'.repeat(40),
    projectRefHash: 'b'.repeat(64),
    conversationRefHash: 'c'.repeat(64),
    appMode: 'packaged_desktop_app',
    platform: 'macos-arm64',
    providerClass: index % 2 === 0 ? 'deepseek' : 'openai-compatible',
    userSuppliedInternalIds: false,
    startedAt: '2026-07-25T08:00:00.000Z',
    completedAt: '2026-07-25T09:00:00.000Z',
    environmentTags,
    evidence,
    steps,
    invariants: REQUIRED_INVARIANTS.map((id) => ({
      id,
      status: 'observed_pass',
      evidenceRefs: [evidence[0].id],
    })),
  };
}

test('RS-P0 rejects the stored RS9 summary because it has no continuous product traces', () => {
  const historical = JSON.parse(readFileSync(new URL('../acceptance/g0-result-studio/rs9-product-acceptance.json', import.meta.url)));
  const verdict = evaluateResultStudioQualification(historical);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.checks.schema, false);
  assert.equal(verdict.checks.allTracesValid, false);
  assert.deepEqual(verdict.missingTasks, REQUIRED_TASKS);
});

test('RS-P0 continuous trace contract requires ordered observed events and source-backed invariants', () => {
  const valid = productTrace(REQUIRED_TASKS[0], 0);
  assert.equal(validateProductTrace(valid).valid, true, JSON.stringify(validateProductTrace(valid)));

  const incomplete = structuredClone(valid);
  incomplete.steps.splice(4, 1);
  incomplete.invariants[0] = { ...incomplete.invariants[0], status: 'asserted_constant', evidenceRefs: [] };
  const verdict = validateProductTrace(incomplete);
  assert.equal(verdict.valid, false);
  assert.ok(verdict.issues.includes('trace_steps_not_complete_and_ordered'));
  assert.ok(verdict.issues.includes(`trace_invariant_not_observed_pass:${REQUIRED_INVARIANTS[0]}`));
  assert.ok(verdict.issues.includes(`trace_invariant_evidence_missing:${REQUIRED_INVARIANTS[0]}`));
});

test('RS-P0 refuses manual booleans, unsafe refs and user-supplied internal IDs', () => {
  const trace = productTrace(REQUIRED_TASKS[0], 0);
  trace.userSuppliedInternalIds = true;
  trace.evidence[0].kind = 'manual_boolean';
  trace.evidence[0].sourceRef = '/Users/example/private.json';
  const verdict = validateProductTrace(trace);
  assert.equal(verdict.valid, false);
  assert.ok(verdict.issues.includes('trace_user_supplied_internal_ids_not_disproved'));
  assert.ok(verdict.issues.includes(`trace_evidence_kind_not_qualifying:${trace.evidence[0].id}`));
  assert.ok(verdict.issues.includes(`trace_evidence_kind_forbidden:${trace.evidence[0].id}`));
  assert.ok(verdict.issues.includes(`trace_evidence_ref_unsafe:${trace.evidence[0].id}`));
});

test('RS-P0 qualification v2 only passes five valid continuous traces and two Provider classes', () => {
  const productTraces = REQUIRED_TASKS.map((taskId, index) => productTrace(taskId, index));
  const valid = evaluateResultStudioQualification({
    schemaVersion: RESULT_STUDIO_QUALIFICATION_VERSION,
    productTraces,
    privacyClean: true,
  });
  assert.equal(valid.passed, true, JSON.stringify(valid));

  const incomplete = evaluateResultStudioQualification({
    schemaVersion: RESULT_STUDIO_QUALIFICATION_VERSION,
    productTraces: productTraces.slice(0, 4).map((trace) => ({ ...trace, providerClass: 'deepseek' })),
    privacyClean: true,
  });
  assert.equal(incomplete.passed, false);
  assert.equal(incomplete.missingTasks.length, 1);
  assert.equal(incomplete.checks.twoRealProviders, false);
});

test('RS-P0 classifies every RS9 input as historical and non-qualifying', () => {
  for (const id of ['rs9-product-acceptance', 'rs9-provider-acceptance', 'rs9-visual-acceptance', 'rs9-visual-table-seed']) {
    const classification = classifyHistoricalEvidence(id);
    assert.equal(classification.qualificationEligible, false);
    assert.notEqual(classification.classification, 'unknown_unclassified');
    assert.ok(classification.reasons.length > 0);
  }
});

test('selection contract can describe a synthetic 27-gene query but does not qualify the product UI', () => {
  const rows = Array.from({ length: 27 }, (_, index) => ({
    gene_id: `ENSG${String(index + 1).padStart(11, '0')}`,
    padj: 0.001 + index / 100000,
  }));
  const manifest = buildTableInteractionManifest({
    artifactId: 'deg_table', revisionId: 'rev_deg', columns: ['gene_id', 'padj'], rows,
    declaredIdField: 'gene_id', rowCount: 18240,
  });
  const selection = buildQuerySelection({
    manifest,
    filter: { op: 'and', clauses: [{ field: 'padj', op: '<=', value: 0.05 }, { field: 'selected', op: '=', value: true }] },
    matchedCount: 27,
    sampleEntityIds: rows.map((row) => row.gene_id),
  });
  const agent = describeSelectionForAgent(selection);
  assert.equal(selection.durable, true);
  assert.equal(selection.matchedCount, 27);
  assert.equal(agent.entityCount, 27);
  assert.equal(agent.sampleEntityIds.length, 12);
  assert.equal(agent.truncated, true);
  assert.match(selection.filterHash, /^[a-f0-9]{64}$/);
});

test('intent planner includes the downstream enrichment subgraph from a trusted persisted graph without claiming a product trace', () => {
  const executionProvenance = {
    executionProvenanceVersion: 1,
    toolJobId: 'tj_deg',
    projectId: 'p_rs9',
    script: { snapshotPath: 'results/jobs/tj_deg/run.R', sha256: 'a'.repeat(64) },
    inputs: [{ id: 'counts', relativePath: 'inputs/counts.csv', sha256: 'b'.repeat(64), sourceArtifactRef: 'rev_counts' }],
    artifacts: [{ id: 'deg_table', filename: 'deg.csv', sha256: 'c'.repeat(64) }],
  };
  executionProvenance.provenanceHash = computeExecutionProvenanceHash(executionProvenance);
  const toolJob = {
    id: 'tj_deg', project_id: 'p_rs9', status: 'completed',
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'deg_table', type: 'table' }],
      executionProvenance,
    },
  };
  const result = planResultEdit({
    projectId: 'p_rs9', artifactId: 'deg_table', revisionId: 'rev_deg', toolJob,
    requestedOutcome: '将 padj 阈值改为 0.01 并更新下游富集',
    proposedParameterPatch: { padj_cutoff: 0.01 },
    parameterImpactRules: { padj_cutoff: 'scientific_recompute' },
    // The planner only receives this shape after the server has projected it
    // from persistent Workflow Truth; callers cannot supply a bare DAG.
    workflowPlan: {
      workflowTruthVersion: 1,
      authority: 'sqlite_job_artifact_truth',
      graphId: 'wfg_rs9_qualification_test',
      sourceDigest: 'd'.repeat(64),
      rootToolJobId: 'tj_counts',
      steps: [
      { id: 'deg', toolJobId: 'tj_deg', dependsOn: ['counts'] },
      { id: 'counts', toolJobId: 'tj_counts', dependsOn: [] },
      { id: 'volcano', toolJobId: 'tj_volcano', dependsOn: ['deg'] },
      { id: 'enrichment', toolJobId: 'tj_enrich', dependsOn: ['deg'] },
      ],
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.status, 'confirmation_required');
  assert.equal(result.intent.editClass, 'scientific_recompute');
  assert.deepEqual(result.intent.affectedNodeIds, ['deg', 'volcano', 'enrichment']);
});
