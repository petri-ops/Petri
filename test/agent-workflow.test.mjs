// vendor/biof3-core/test/agent-workflow.mjs — Phase 6 agent workflow runtime tests
// Unit tests for agent-workflow.js pure functions (no DB, no side effects).
// Run: node --test vendor/biof3-core/test/agent-workflow.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  STEP_STATUSES,
  createAgentWorkflowPlan,
  bindVerifiedArtifact,
  projectStepStatuses,
  projectWorkflowPlan,
  validateLineageEntry,
  runToolJobs,
  listAgentWorkflowTemplates,
} = require('../core/shared-backend/agent-workflow.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubJob(overrides = {}) {
  return {
    id: 'tj_1',
    tool_id: 'deseq2',
    status: 'completed',
    result_json: null,
    result: null,
    ack_status: null,
    error: null,
    ...overrides,
  };
}

function harnessState(job) {
  const result = job.result_json || job.result || {};
  return {
    harnessWorkflowStateVersion: 1,
    jobId: job.id,
    toolId: job.tool_id,
    jobStatus: job.status,
    terminal: ['completed', 'failed', 'cancelled'].includes(job.status),
    recoverable: false,
    resumeFrom: null,
    artifactTruth: result.artifactTruth || null,
    artifactDiagnostics: [],
    artifactCount: (result.artifacts || []).length,
    error: job.error,
    nextActions: [],
    stages: [],
  };
}

// ---------------------------------------------------------------------------
// STEP_STATUSES
// ---------------------------------------------------------------------------

test('STEP_STATUSES contains all 9 lifecycle statuses', () => {
  const expected = [
    'waiting_for_dependency',
    'ready',
    'waiting_for_confirmation',
    'queued',
    'running',
    'recoverable',
    'blocked',
    'complete',
    'cancelled',
  ];
  assert.deepEqual(STEP_STATUSES, expected);
});

// ---------------------------------------------------------------------------
// createAgentWorkflowPlan
// ---------------------------------------------------------------------------

test('createAgentWorkflowPlan rejects unknown templateId', () => {
  assert.throws(
    () => createAgentWorkflowPlan({ templateId: 'nonexistent' }),
    /unknown_workflow_template/
  );
});

test('createAgentWorkflowPlan marks steps without available tools as blocked', () => {
  const plan = createAgentWorkflowPlan({ templateId: 'bulk-rna-core', availableToolIds: [] });
  const blocked = plan.steps.filter((s) => s.status === 'blocked');
  assert.equal(blocked.length, plan.steps.length, '所有步骤都应被标记为 blocked（无可用工具）');
  assert.equal(plan.status, 'blocked');
});

test('createAgentWorkflowPlan marks steps with satisfied dependencies as ready', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
    initialInputs: { counts: '/data/counts.csv' },
  });
  const ready = plan.steps.filter((s) => s.status === 'ready');
  assert.ok(ready.length > 0, '有满足依赖的步骤应标记为 ready');
  const blocked = plan.steps.filter((s) => s.status === 'blocked');
  assert.equal(blocked.length, 0, '所有步骤都有可用工具，不应有 blocked');
});

test('createAgentWorkflowPlan sets status to ready when no steps are blocked', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.autoExecute, false);
  assert.equal(plan.executionPolicy, 'agent_led_existing_tools');
});

test('createAgentWorkflowPlan passes initialInputs only to root steps', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
    initialInputs: { counts: '/data/counts.csv', coldata: '/data/groups.csv' },
  });
  const differential = plan.steps.find((s) => s.id === 'differential');
  assert.deepEqual(differential.inputs, { counts: '/data/counts.csv', coldata: '/data/groups.csv' });
  const volcano = plan.steps.find((s) => s.id === 'volcano');
  assert.deepEqual(volcano.inputs, {}, '下游步骤不应继承 initialInputs');
});

// ---------------------------------------------------------------------------
// projectStepStatuses
// ---------------------------------------------------------------------------

test('projectStepStatuses maps queued job to queued step status', () => {
  const steps = [{ id: 'step1', status: 'waiting_for_dependency', dependsOn: [] }];
  const jobs = [{ id: 'tj_1', status: 'queued', stepId: 'step1' }];
  const result = projectStepStatuses(steps, jobs);
  assert.equal(result[0].status, 'queued');
});

test('projectStepStatuses maps running job to running step status', () => {
  const steps = [{ id: 'step1', status: 'ready', dependsOn: [] }];
  const jobs = [{ id: 'tj_1', status: 'running', stepId: 'step1' }];
  const result = projectStepStatuses(steps, jobs);
  assert.equal(result[0].status, 'running');
});

test('projectStepStatuses maps failed job with recoverable diagnostics to recoverable', () => {
  const steps = [{ id: 'step1', status: 'running', dependsOn: [] }];
  const jobs = [{
    id: 'tj_1',
    status: 'failed',
    stepId: 'step1',
    result_json: JSON.stringify({
      artifactDiagnostics: [{ code: 'missing_file', recoverable: true }],
    }),
  }];
  const result = projectStepStatuses(steps, jobs);
  assert.equal(result[0].status, 'recoverable');
});

test('projectStepStatuses maps completed job with valid truth to complete', () => {
  const steps = [{ id: 'step1', status: 'running', dependsOn: [] }];
  const jobs = [{
    id: 'tj_1',
    status: 'completed',
    stepId: 'step1',
    result_json: JSON.stringify({
      artifactTruth: { status: 'valid', validCount: 1 },
      artifacts: [{ name: 'result.csv' }],
    }),
  }];
  const result = projectStepStatuses(steps, jobs);
  assert.equal(result[0].status, 'complete');
});

test('projectStepStatuses maps pending ack to waiting_for_confirmation', () => {
  const steps = [{ id: 'step1', status: 'queued', dependsOn: [] }];
  const jobs = [{ id: 'tj_1', status: 'pending', stepId: 'step1', ack_status: 'pending' }];
  const result = projectStepStatuses(steps, jobs);
  assert.equal(result[0].status, 'waiting_for_confirmation');
});

test('projectStepStatuses maps rejected ack to cancelled', () => {
  const steps = [{ id: 'step1', status: 'running', dependsOn: [] }];
  const jobs = [{ id: 'tj_1', status: 'failed', stepId: 'step1', ack_status: 'rejected' }];
  const result = projectStepStatuses(steps, jobs);
  assert.equal(result[0].status, 'cancelled');
});

test('projectStepStatuses carries through toolJobId from matching job', () => {
  const steps = [{ id: 'step1', status: 'waiting_for_dependency', dependsOn: [] }];
  const jobs = [{ id: 'tj_abc', status: 'queued', stepId: 'step1', toolJobId: 'tj_abc' }];
  const result = projectStepStatuses(steps, jobs);
  assert.equal(result[0].toolJobId, 'tj_abc');
});

test('projectStepStatuses leaves step unchanged when no matching job', () => {
  const steps = [{ id: 'step1', status: 'blocked', dependsOn: [] }];
  const jobs = [{ id: 'tj_1', status: 'completed' }];
  const result = projectStepStatuses(steps, jobs);
  assert.equal(result[0].status, 'blocked');
});

test('projectStepStatuses is stable on empty steps', () => {
  const result = projectStepStatuses([], []);
  assert.deepEqual(result, []);
});

test('projectStepStatuses is stable on null/undefined job arrays', () => {
  const steps = [{ id: 's1', status: 'ready', dependsOn: [] }];
  assert.deepEqual(projectStepStatuses(steps, null)[0].status, 'ready');
  assert.deepEqual(projectStepStatuses(steps, undefined)[0].status, 'ready');
});

// ---------------------------------------------------------------------------
// projectWorkflowPlan
// ---------------------------------------------------------------------------

test('projectWorkflowPlan marks plan complete when all steps complete', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  const jobs = [
    { id: 'tj_1', status: 'completed', result_json: JSON.stringify({ artifactTruth: { status: 'valid' }, artifacts: [] }), stepId: 'differential' },
    { id: 'tj_2', status: 'completed', result_json: JSON.stringify({ artifactTruth: { status: 'valid' }, artifacts: [] }), stepId: 'deg-standardization' },
    { id: 'tj_3', status: 'completed', result_json: JSON.stringify({ artifactTruth: { status: 'valid' }, artifacts: [] }), stepId: 'volcano' },
    { id: 'tj_4', status: 'completed', result_json: JSON.stringify({ artifactTruth: { status: 'valid' }, artifacts: [] }), stepId: 'enrichment' },
  ];
  const result = projectWorkflowPlan(plan, jobs);
  assert.equal(result.status, 'complete');
  assert.equal(result.terminal, true);
  assert.equal(result.recoverable, false);
  assert.deepEqual(result.readyStepIds, []);
  assert.equal(result.resumeFromStepId, null);
});

test('projectWorkflowPlan reports readyStepIds from satisfied dependencies', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  const jobs = [
    { id: 'tj_1', status: 'completed', result_json: JSON.stringify({ artifactTruth: { status: 'valid' }, artifacts: [] }), stepId: 'differential' },
    { id: 'tj_2', status: 'completed', result_json: JSON.stringify({ artifactTruth: { status: 'valid' }, artifacts: [] }), stepId: 'deg-standardization' },
    { id: 'tj_3', status: 'queued', stepId: 'volcano' },
    { id: 'tj_4', status: 'queued', stepId: 'enrichment' },
  ];
  const result = projectWorkflowPlan(plan, jobs);
  assert.ok(result.readyStepIds.includes('volcano'), 'volcano 的依赖已完成，应在 readyStepIds');
  assert.ok(result.readyStepIds.includes('enrichment'), 'enrichment 的依赖已完成，应在 readyStepIds');
  assert.equal(result.terminal, false);
});

test('projectWorkflowPlan sets resumeFromStepId to first incomplete non-terminal step', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  const jobs = [
    { id: 'tj_1', status: 'completed', result_json: JSON.stringify({ artifactTruth: { status: 'valid' }, artifacts: [] }), stepId: 'differential' },
    { id: 'tj_2', status: 'completed', result_json: JSON.stringify({ artifactTruth: { status: 'valid' }, artifacts: [] }), stepId: 'deg-standardization' },
    { id: 'tj_3', status: 'queued', stepId: 'volcano' },
    { id: 'tj_4', status: 'blocked', stepId: 'enrichment' },
  ];
  const result = projectWorkflowPlan(plan, jobs);
  assert.equal(result.resumeFromStepId, 'volcano', 'volcano 是第一个非 terminal 的步骤');
});

test('projectWorkflowPlan sets recoverable when any step is recoverable', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  const jobs = [
    { id: 'tj_1', status: 'failed', result_json: JSON.stringify({ artifactTruth: { status: 'degraded' }, artifacts: [] }), stepId: 'differential' },
    { id: 'tj_2', status: 'queued', stepId: 'deg-standardization' },
    { id: 'tj_3', status: 'queued', stepId: 'volcano' },
    { id: 'tj_4', status: 'queued', stepId: 'enrichment' },
  ];
  const result = projectWorkflowPlan(plan, jobs);
  assert.equal(result.recoverable, true);
});

test('projectWorkflowPlan generates nextActions for waiting_for_confirmation steps', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  const jobs = [
    { id: 'tj_1', status: 'pending', ack_status: 'pending', stepId: 'differential' },
    { id: 'tj_2', status: 'queued', stepId: 'deg-standardization' },
    { id: 'tj_3', status: 'queued', stepId: 'volcano' },
    { id: 'tj_4', status: 'queued', stepId: 'enrichment' },
  ];
  const result = projectWorkflowPlan(plan, jobs);
  assert.ok(result.nextActions.some((a) => a.id === 'confirm_differential'), '应有 confirm_differential action');
});

test('projectWorkflowPlan generates nextActions for recoverable steps', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  const jobs = [
    { id: 'tj_1', status: 'failed', result_json: JSON.stringify({ artifactTruth: { status: 'degraded' }, artifacts: [] }), stepId: 'differential' },
    { id: 'tj_2', status: 'blocked', stepId: 'volcano' },
    { id: 'tj_3', status: 'queued', stepId: 'enrichment' },
  ];
  const result = projectWorkflowPlan(plan, jobs);
  assert.ok(result.nextActions.some((a) => a.id === 'recover_differential'), '应有 recover_differential action');
  assert.ok(result.nextActions.some((a) => a.id === 'unblock_volcano'), '应有 unblock_volcano action');
});

test('projectWorkflowPlan returns original plan when version mismatch', () => {
  const plan = { agentWorkflowPlanVersion: 99 };
  const result = projectWorkflowPlan(plan, []);
  assert.equal(result, plan);
});

// ---------------------------------------------------------------------------
// bindVerifiedArtifact
// ---------------------------------------------------------------------------

test('bindVerifiedArtifact rejects invalid artifactTruth', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  assert.throws(
    () => bindVerifiedArtifact(plan, {
      fromStepId: 'differential',
      toStepId: 'volcano',
      inputId: 'deg_table',
      artifact: { path: '/results/deg.csv' },
      artifactTruth: { status: 'invalid' },
    }),
    /artifact_not_verified/
  );
});

test('bindVerifiedArtifact rejects wrong dependency', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  assert.throws(
    () => bindVerifiedArtifact(plan, {
      fromStepId: 'volcano', // volcano depends on differential, not the other way
      toStepId: 'differential',
      inputId: 'deg_table',
      artifact: { path: '/results/deg.csv' },
      artifactTruth: { status: 'valid' },
    }),
    /workflow_dependency_mismatch/
  );
});

test('bindVerifiedArtifact binds valid artifact and marks step ready', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  const result = bindVerifiedArtifact(plan, {
    fromStepId: 'differential',
    toStepId: 'deg-standardization',
    inputId: 'deg_results',
    artifact: { path: '/results/deg.csv', name: 'deg.csv' },
    artifactTruth: { status: 'valid' },
  });
  const degStd = result.steps.find((s) => s.id === 'deg-standardization');
  assert.equal(degStd.inputs.deg_results, '/results/deg.csv');
  assert.equal(result.lineage.length, 1);
  assert.equal(result.lineage[0].artifactTruthStatus, 'valid');
});

test('bindVerifiedArtifact is idempotent on duplicate bind', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  const opts = {
    fromStepId: 'differential',
    toStepId: 'deg-standardization',
    inputId: 'deg_results',
    artifact: { path: '/results/deg.csv', name: 'deg.csv' },
    artifactTruth: { status: 'valid' },
  };
  const first = bindVerifiedArtifact(plan, opts);
  const second = bindVerifiedArtifact(first, { ...opts, artifact: { path: '/results/deg_v2.csv', name: 'deg_v2.csv' } });
  assert.equal(second.lineage.length, 1, '重复绑定应替换而非追加');
  assert.equal(second.lineage[0].artifactPath, '/results/deg_v2.csv');
});

test('bindVerifiedArtifact rejects missing artifact value', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  assert.throws(
    () => bindVerifiedArtifact(plan, {
      fromStepId: 'deg-standardization',
      toStepId: 'volcano',
      inputId: 'deg_table',
      artifact: {},
      artifactTruth: { status: 'valid' },
    }),
    /artifact_location_missing/
  );
});

test('bindVerifiedArtifact prefers canonicalPath over path', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  const result = bindVerifiedArtifact(plan, {
    fromStepId: 'deg-standardization',
    toStepId: 'volcano',
    inputId: 'deg_table',
    artifact: { path: '/local/results.csv', canonicalPath: '/work/biof3/results.csv' },
    artifactTruth: { status: 'valid' },
  });
  assert.equal(result.steps.find((s) => s.id === 'volcano').inputs.deg_table, '/work/biof3/results.csv');
});

// ---------------------------------------------------------------------------
// validateLineageEntry
// ---------------------------------------------------------------------------

test('validateLineageEntry returns ok for valid entry', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  const entry = {
    fromStepId: 'differential',
    toStepId: 'deg-standardization',
    inputId: 'deg_results',
    artifactTruthStatus: 'valid',
    artifactPath: '/results/deg.csv',
    artifactType: 'table',
  };
  const result = validateLineageEntry(entry, plan);
  assert.equal(result.ok, true);
});

test('validateLineageEntry rejects non-valid artifactTruthStatus', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  const entry = {
    fromStepId: 'differential',
    toStepId: 'volcano',
    inputId: 'deg_table',
    artifactTruthStatus: 'invalid',
    artifactPath: '/results/deg.csv',
  };
  const result = validateLineageEntry(entry, plan);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'artifact_not_verified');
});

test('validateLineageEntry rejects missing artifactPath', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  const entry = {
    fromStepId: 'differential',
    toStepId: 'volcano',
    inputId: 'deg_table',
    artifactTruthStatus: 'valid',
  };
  const result = validateLineageEntry(entry, plan);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'artifact_location_missing');
});

test('validateLineageEntry rejects artifact type mismatch', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  const entry = {
    fromStepId: 'differential',
    toStepId: 'volcano',
    inputId: 'deg_table',
    artifactTruthStatus: 'valid',
    artifactPath: '/results/deg.csv',
    artifactType: 'plot', // volcano expects 'table'
  };
  const result = validateLineageEntry(entry, plan);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'artifact_type_mismatch');
});

// ---------------------------------------------------------------------------
// runToolJobs
// ---------------------------------------------------------------------------

test('runToolJobs returns empty array when getToolJobFn is not a function', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  plan.steps[0].toolJobId = 'tj_1';
  assert.deepEqual(runToolJobs(plan, null), []);
  assert.deepEqual(runToolJobs(plan, undefined), []);
});

test('runToolJobs returns enriched jobs with _stepId', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  // New DAG: [differential, deg-standardization, volcano, enrichment]
  plan.steps[0].toolJobId = 'tj_diff';    // differential
  plan.steps[1].toolJobId = 'tj_deg';     // deg-standardization
  const getJob = (id) => ({ id, tool_id: 'deseq2', status: 'completed', result_json: '{}' });
  const result = runToolJobs(plan, getJob);
  assert.equal(result.length, 2);
  assert.equal(result[0]._stepId, 'differential');
  assert.equal(result[1]._stepId, 'deg-standardization');
});

test('runToolJobs skips steps without toolJobId', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  // No toolJobId set on any steps
  const result = runToolJobs(plan, (id) => ({ id }));
  assert.equal(result.length, 0);
});

test('runToolJobs skips null jobs returned by getToolJobFn', () => {
  const plan = createAgentWorkflowPlan({
    templateId: 'bulk-rna-core',
    availableToolIds: ['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea'],
  });
  plan.steps[0].toolJobId = 'tj_gone';
  const getJob = (id) => (id === 'tj_gone' ? null : { id, tool_id: 'x', status: 'completed' });
  const result = runToolJobs(plan, getJob);
  assert.equal(result.length, 0);
});

// ---------------------------------------------------------------------------
// listAgentWorkflowTemplates
// ---------------------------------------------------------------------------

test('listAgentWorkflowTemplates returns all templates', () => {
  const result = listAgentWorkflowTemplates(['deseq2', 'volcano-plot', 'enrichment']);
  assert.equal(result.length, 3);
  const ids = result.map((t) => t.id);
  assert.ok(ids.includes('bulk-rna-core'));
  assert.ok(ids.includes('deg-result-refinement'));
  assert.ok(ids.includes('coexpression-network'));
  assert.equal(ids.includes('single-cell-core'), false);
});

test('listAgentWorkflowTemplates marks template unavailable when tools are missing', () => {
  const result = listAgentWorkflowTemplates(['volcano-plot']); // only volcano-plot available
  const bulk = result.find((t) => t.id === 'bulk-rna-core');
  assert.equal(bulk.available, false);
  assert.equal(bulk.supportedStepCount, 1);
  assert.equal(bulk.stepCount, 4); // [differential, deg-standardization, volcano, enrichment]
});

test('listAgentWorkflowTemplates marks template available when all tools present', () => {
  const result = listAgentWorkflowTemplates(['deseq2', 'deg-standardizer', 'volcano-plot', 'go-kegg', 'gsea']);
  const bulk = result.find((t) => t.id === 'bulk-rna-core');
  assert.equal(bulk.available, true);
  assert.equal(bulk.supportedStepCount, 4);
});
