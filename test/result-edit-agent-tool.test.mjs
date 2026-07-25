import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createResultEditPlanTool } = require('../core/r-server/agent-tools/result-edit-tools');
const { normalizePluginManifest } = require('../core/r-server/plugin-loader');

function makeJob(projectId = 'p_1') {
  return {
    id: 'tj_plot', project_id: projectId, tool_id: 'volcano-plot', status: 'completed',
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'volcano_plot', name: 'volcano.png' }],
      executionProvenance: {
        toolJobId: 'tj_plot', projectId,
        script: { snapshotPath: '/snapshot/run.R', sha256: 'a'.repeat(64) },
        inputs: [{ relativePath: 'inputs/deg.csv', sha256: 'b'.repeat(64), sourceArtifactRef: 'deg_table' }],
        artifacts: [{ id: 'volcano_plot', filename: 'volcano.png', sha256: 'c'.repeat(64) }],
      },
    },
  };
}

const args = {
  toolJobId: 'tj_plot', artifactId: 'volcano_plot', revisionId: 'rev_1',
  requestedOutcome: 'use a blue palette', proposedParameterPatch: { palette: 'blue' },
  workflowPlan: { steps: [{ id: 'plot', toolJobId: 'tj_plot', dependsOn: [] }] },
};

test('RS4 Agent tool uses trusted plugin impact metadata and remains read-only', async () => {
  let reads = 0;
  const tool = createResultEditPlanTool({
    getToolJob(id) { reads += 1; return id === 'tj_plot' ? makeJob() : null; },
    getPluginManifest() { return { resultStudio: { parameterImpacts: { palette: 'presentation' } } }; },
  });
  const result = await tool(args, { projectId: 'p_1', userId: 'u_1' });
  assert.equal(reads, 1);
  assert.equal(result.ok, true);
  assert.equal(result.intent.editClass, 'presentation_rerender');
  assert.deepEqual(result.execution, { performed: false, toolJobCreated: false, changeSetCreated: false });
});

test('RS4 Agent tool does not let model arguments invent parameter impact metadata', async () => {
  const tool = createResultEditPlanTool({
    getToolJob: () => makeJob(),
    getPluginManifest: () => ({ resultStudio: null }),
  });
  const result = await tool({ ...args, parameterImpactRules: { palette: 'presentation' } }, { projectId: 'p_1' });
  assert.equal(result.intent.editClass, 'scientific_recompute');
  assert.equal(result.intent.requiresScientificConfirmation, true);
});

test('RS4 Agent tool rejects cross-project access before planning', async () => {
  const tool = createResultEditPlanTool({
    getToolJob: () => makeJob('p_other'),
    getPluginManifest: () => { throw new Error('must not load cross-project plugin data'); },
  });
  const result = await tool(args, { projectId: 'p_1' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'source_project_mismatch');
});

test('RS4 Agent tool requires an active project and a real source job', async () => {
  const noProject = createResultEditPlanTool({ getToolJob: () => makeJob() });
  assert.equal((await noProject(args, {})).error, 'project_context_required');
  const noJob = createResultEditPlanTool({ getToolJob: () => null });
  assert.equal((await noJob(args, { projectId: 'p_1' })).error, 'source_job_not_found');
});

test('RS4 plugin normalization preserves an optional trusted Result Studio descriptor', () => {
  const manifest = normalizePluginManifest(
    { id: 'plotter', version: '1.0.0', language: 'r' },
    { id: 'plotter', resultStudio: { parameterImpacts: { palette: 'presentation' } } }
  );
  assert.deepEqual(manifest.resultStudio, { parameterImpacts: { palette: 'presentation' } });
  assert.equal(normalizePluginManifest({ id: 'legacy' }, { id: 'legacy' }).resultStudio, null);
});
