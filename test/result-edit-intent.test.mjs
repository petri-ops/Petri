import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyParameterPatch,
  computeResultAffectedSubgraph,
  locateResultSource,
  planResultEdit,
  validateResultEditIntent,
} = require('../core/shared-backend/result-edit-intent');

function sourceJob(overrides = {}) {
  return {
    id: 'tj_plot',
    project_id: 'p_1',
    tool_id: 'volcano-plot',
    status: 'completed',
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'volcano_plot', name: 'volcano.png', type: 'plot' }],
      executionProvenance: {
        toolJobId: 'tj_plot',
        projectId: 'p_1',
        script: { snapshotPath: '/results/tj_plot/run-script.R', sha256: 'a'.repeat(64) },
        inputs: [{ id: 'deg', relativePath: 'inputs/deg.csv', sha256: 'b'.repeat(64), sourceArtifactRef: 'deg_table' }],
        artifacts: [{ id: 'volcano_plot', filename: 'volcano.png', sha256: 'c'.repeat(64) }],
      },
    },
    ...overrides,
  };
}

function workflow() {
  return {
    agentWorkflowPlanVersion: 1,
    steps: [
      { id: 'deg', toolJobId: 'tj_deg', dependsOn: [] },
      { id: 'plot', toolJobId: 'tj_plot', dependsOn: ['deg'] },
      { id: 'report', toolJobId: 'tj_report', dependsOn: ['plot'] },
    ],
  };
}

function plan(overrides = {}) {
  return planResultEdit({
    projectId: 'p_1',
    toolJob: sourceJob(),
    toolJobId: 'tj_plot',
    artifactId: 'volcano_plot',
    revisionId: 'rev_1',
    requestedOutcome: 'change the plot',
    workflowPlan: workflow(),
    ...overrides,
  });
}

test('RS4 explicit presentation metadata limits a palette edit to the source plotting node', () => {
  const result = plan({
    proposedParameterPatch: { palette: 'viridis' },
    parameterImpactRules: { palette: 'presentation' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'ready');
  assert.equal(result.intent.editClass, 'presentation_rerender');
  assert.deepEqual(result.intent.affectedNodeIds, ['plot']);
  assert.equal(result.intent.requiresScientificConfirmation, false);
  assert.deepEqual(result.execution, { performed: false, toolJobCreated: false, changeSetCreated: false });
});

test('RS4 declared scientific threshold recomputes source and downstream nodes', () => {
  const result = plan({
    proposedParameterPatch: { padj_cutoff: 0.01 },
    parameterImpactRules: { padj_cutoff: 'scientific' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'confirmation_required');
  assert.equal(result.intent.editClass, 'scientific_recompute');
  assert.deepEqual(result.intent.affectedNodeIds, ['plot', 'report']);
  assert.equal(result.intent.requiresScientificConfirmation, true);
});

test('RS4 protects design formula and workflow method changes regardless of a weaker declaration', () => {
  const design = classifyParameterPatch({
    proposedParameterPatch: { design_formula: '~ batch + condition' },
    parameterImpactRules: { design_formula: 'presentation' },
  });
  assert.equal(design.editClass, 'scientific_recompute');
  assert.equal(design.requiresScientificConfirmation, true);

  const method = classifyParameterPatch({
    proposedParameterPatch: { method: 'edgeR' },
    parameterImpactRules: { method: 'presentation' },
  });
  assert.equal(method.editClass, 'workflow_replan');
  assert.equal(method.requiresScientificConfirmation, true);
});

test('RS4 unknown parameters conservatively require scientific recomputation', () => {
  const result = plan({ proposedParameterPatch: { color: '#ff0000' } });
  assert.equal(result.intent.editClass, 'scientific_recompute');
  assert.equal(result.intent.requiresScientificConfirmation, true);
  assert.equal(result.parameterImpacts[0].source, 'conservative_unknown_parameter');
});

test('RS4 fails closed when script, inputs, artifact, revision, or DAG is missing', () => {
  const brokenJob = sourceJob();
  brokenJob.result.executionProvenance.script = { snapshotPath: null, sha256: null };
  brokenJob.result.executionProvenance.inputs = [];
  const result = plan({
    toolJob: brokenJob,
    artifactId: 'not-an-artifact-filename.png',
    revisionId: '',
    workflowPlan: null,
    proposedParameterPatch: { threshold: 1 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.intent.affectedNodeIds, []);
  const codes = new Set(result.diagnostics.map((item) => item.code));
  for (const code of ['source_artifact_not_found', 'source_script_missing', 'source_inputs_missing', 'source_revision_missing', 'workflow_dag_missing']) {
    assert.equal(codes.has(code), true, code);
  }
});

test('RS4 never uses a filename as artifact identity or lineage', () => {
  const located = locateResultSource({
    toolJob: sourceJob(),
    projectId: 'p_1',
    artifactId: 'volcano.png',
  });
  assert.equal(located.ok, false);
  assert.equal(located.diagnostics.some((item) => item.code === 'source_artifact_not_found'), true);
  assert.equal(located.diagnostics.some((item) => item.code === 'source_artifact_provenance_missing'), true);

  const noLineageJob = sourceJob();
  noLineageJob.result.executionProvenance.inputs[0].sourceArtifactRef = null;
  const noLineage = plan({
    toolJob: noLineageJob,
    proposedParameterPatch: { palette: 'blue' },
    parameterImpactRules: { palette: 'presentation' },
  });
  assert.equal(noLineage.ok, false);
  assert.equal(noLineage.diagnostics.some((item) => item.code === 'source_lineage_missing'), true);
});

test('RS4 detects ambiguous nodes, missing dependencies, and cycles', () => {
  const ambiguous = computeResultAffectedSubgraph({
    workflowPlan: { steps: [{ id: 'a', toolJobId: 'tj_plot', dependsOn: [] }, { id: 'b', toolJobId: 'tj_plot', dependsOn: [] }] },
    sourceToolJobId: 'tj_plot',
    editClass: 'scientific_recompute',
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.diagnostics[0].code, 'source_workflow_node_ambiguous');

  const missing = computeResultAffectedSubgraph({
    workflowPlan: { steps: [{ id: 'a', toolJobId: 'tj_plot', dependsOn: ['missing'] }] },
    sourceToolJobId: 'tj_plot',
    editClass: 'scientific_recompute',
  });
  assert.equal(missing.diagnostics[0].code, 'workflow_dependency_missing');

  const cyclic = computeResultAffectedSubgraph({
    workflowPlan: { steps: [{ id: 'a', toolJobId: 'tj_plot', dependsOn: ['b'] }, { id: 'b', toolJobId: 'tj_b', dependsOn: ['a'] }] },
    sourceToolJobId: 'tj_plot',
    editClass: 'scientific_recompute',
  });
  assert.equal(cyclic.diagnostics[0].code, 'workflow_cycle_detected');
});

test('RS4 intent contract validates a complete deterministic plan', () => {
  const first = plan({ proposedParameterPatch: { palette: 'magma' }, parameterImpactRules: { palette: 'presentation' } });
  const second = plan({ proposedParameterPatch: { palette: 'magma' }, parameterImpactRules: { palette: 'presentation' } });
  assert.equal(validateResultEditIntent(first.intent).ok, true);
  assert.equal(first.intent.intentId, second.intent.intentId);
});
