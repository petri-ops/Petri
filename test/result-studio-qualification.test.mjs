import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  REQUIRED_TASKS,
  REQUIRED_ENVIRONMENTS,
  REQUIRED_EVIDENCE,
  evaluateResultStudioQualification,
} = require('../core/shared-backend/result-studio-qualification');
const {
  buildTableInteractionManifest,
  buildQuerySelection,
  describeSelectionForAgent,
} = require('../core/shared-backend/artifact-interaction');
const { planResultEdit } = require('../core/shared-backend/result-edit-intent');

function passingReport() {
  return {
    schemaVersion: 1,
    tasks: REQUIRED_TASKS.map((id) => ({ id, status: 'passed' })),
    environments: REQUIRED_ENVIRONMENTS.map((id) => ({ id, status: 'passed' })),
    evidence: REQUIRED_EVIDENCE.map((id) => ({ id, status: 'passed' })),
    providers: [
      { providerClass: 'deepseek', status: 'passed' },
      { providerClass: 'openai-compatible', status: 'passed' },
    ],
    commands: [{ id: 'product', passed: true }],
    invariants: {
      executionTruth: 'run_tool -> tool_job -> artifact_truth',
      sourceDataPreserved: true,
      artifactHistoryPreserved: true,
      unrelatedGitWipPreserved: true,
      falseSuccessCount: 0,
      partialAdoptCount: 0,
      silentLossCount: 0,
      formalArtifactCount: 12,
      formalArtifactsWithIndependentScripts: 12,
    },
    privacyClean: true,
  };
}

test('RS9 qualification requires the complete task, environment and evidence matrices', () => {
  const valid = evaluateResultStudioQualification(passingReport());
  assert.equal(valid.passed, true, JSON.stringify(valid));

  const incomplete = passingReport();
  incomplete.tasks.pop();
  incomplete.environments.pop();
  incomplete.evidence.pop();
  const verdict = evaluateResultStudioQualification(incomplete);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.missingTasks.length, 1);
  assert.equal(verdict.missingEnvironments.length, 1);
  assert.equal(verdict.missingEvidence.length, 1);
});

test('RS9 qualification refuses one Provider, false success or incomplete independent scripts', () => {
  const report = passingReport();
  report.providers = report.providers.slice(0, 1);
  report.invariants.falseSuccessCount = 1;
  report.invariants.formalArtifactsWithIndependentScripts = 11;
  const verdict = evaluateResultStudioQualification(report);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.checks.twoRealProviders, false);
  assert.equal(verdict.checks.honestRecovery, false);
  assert.equal(verdict.checks.independentScripts, false);
});

test('RS9 carries an exact 27-gene DEG selection into bounded Agent context', () => {
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

test('RS9 scientific threshold edits deterministically include the downstream enrichment subgraph', () => {
  const toolJob = {
    id: 'tj_deg', project_id: 'p_rs9', status: 'completed',
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'deg_table', type: 'table' }],
      executionProvenance: {
        toolJobId: 'tj_deg',
        script: { snapshotPath: 'results/jobs/tj_deg/run.R', sha256: 'a'.repeat(64) },
        inputs: [{ id: 'counts', relativePath: 'inputs/counts.csv', sha256: 'b'.repeat(64), sourceArtifactRef: 'rev_counts' }],
        artifacts: [{ id: 'deg_table', filename: 'deg.csv', sha256: 'c'.repeat(64) }],
      },
    },
  };
  const result = planResultEdit({
    projectId: 'p_rs9', artifactId: 'deg_table', revisionId: 'rev_deg', toolJob,
    requestedOutcome: '将 padj 阈值改为 0.01 并更新下游富集',
    proposedParameterPatch: { padj_cutoff: 0.01 },
    parameterImpactRules: { padj_cutoff: 'scientific_recompute' },
    workflowPlan: { steps: [
      { id: 'deg', toolJobId: 'tj_deg', dependsOn: ['counts'] },
      { id: 'counts', toolJobId: 'tj_counts', dependsOn: [] },
      { id: 'volcano', toolJobId: 'tj_volcano', dependsOn: ['deg'] },
      { id: 'enrichment', toolJobId: 'tj_enrich', dependsOn: ['deg'] },
    ] },
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.status, 'confirmation_required');
  assert.equal(result.intent.editClass, 'scientific_recompute');
  assert.deepEqual(result.intent.affectedNodeIds, ['deg', 'volcano', 'enrichment']);
});
