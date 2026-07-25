import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { createResultEditPlanTool, createResultChangeSetTools } = require('../core/r-server/agent-tools/result-edit-tools');
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

test('RS5 Agent ChangeSet tool scopes the source and emits durable progress', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'biof3-rs5-agent-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const script = join(root, 'results/jobs/tj_plot/run-script.R');
  mkdirSync(join(script, '..'), { recursive: true });
  writeFileSync(script, 'print(1)\n');
  const project = { id: 'p_1', user_id: 'u_1', workspace_path: root };
  const job = makeJob();
  job.result.executionProvenance.script = { snapshotPath: script, sha256: 'a'.repeat(64) };
  const revision = { revisionId: 'rev_1', projectId: 'p_1', artifactId: 'volcano_plot', toolJobId: 'tj_plot' };
  const repository = {
    saveRepositoryBinding: () => {},
    getRevision: () => revision,
    getChangeSet: () => ({ changeSetId: 'cs_1', projectId: 'p_1' }),
    listRevisionsByChangeSet: () => [],
  };
  const emitted = [];
  let received;
  const tools = createResultChangeSetTools({
    db: { db: {}, getProject: () => project, getToolJob: () => job, getUserById: () => ({ role: 'user' }) },
    getPlugin: () => ({ id: 'volcano-plot', language: 'r' }),
    createResultStudioRepository: () => repository,
    bindProjectRepository: () => ({
      status: 'ready', mode: 'managed', workspaceRoot: root, managedPaths: ['analysis/scripts'], reason: null,
      inspection: { runtime: { versionRaw: 'git version test' } },
      adapter: { gitDir: join(root, '.biof3/git'), workTree: root },
    }),
    createResultChangeSet: async (input, dependencies) => {
      received = input;
      dependencies.onProgress({ stage: 'materialize', status: 'completed' });
      return { ok: true, changeSet: { changeSetId: 'cs_1', status: 'preview_ready' } };
    },
  });
  const result = await tools.create({ intent: { artifactRef: { revisionId: 'rev_1' } } }, {
    projectId: 'p_1', userId: 'u_1', conversationId: 'conv_1',
    emitResultEditProgress: (event) => emitted.push(event),
  });
  assert.equal(result.ok, true);
  assert.equal(received.projectId, 'p_1');
  assert.equal(received.sourceRevision, revision);
  assert.equal(received.sourceJob, job);
  assert.equal(received.createdBy, 'agent');
  assert.deepEqual(emitted, [{ stage: 'materialize', status: 'completed' }]);
});

test('RS5 ChangeSet status refuses a cross-project record', async () => {
  const repository = {
    saveRepositoryBinding: () => {},
    getChangeSet: () => ({ changeSetId: 'cs_other', projectId: 'p_other' }),
  };
  const tools = createResultChangeSetTools({
    db: { db: {}, getProject: () => ({ id: 'p_1', user_id: 'u_1', workspace_path: '/tmp/p_1' }) },
    createResultStudioRepository: () => repository,
    bindProjectRepository: () => ({
      status: 'ready', mode: 'managed', workspaceRoot: '/tmp/p_1', managedPaths: [], reason: null,
      inspection: { runtime: {} }, adapter: { gitDir: '/tmp/git', workTree: '/tmp/p_1' },
    }),
  });
  const result = await tools.status({ changeSetId: 'cs_other' }, { projectId: 'p_1', userId: 'u_1' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'change_set_not_found');
});

test('RS6 Agent review tools share project scope and the canonical services', async () => {
  const calls = [];
  const repository = {
    saveRepositoryBinding: () => {},
    getChangeSet: () => ({ changeSetId: 'cs_1', projectId: 'p_1' }),
    listRevisions: () => [{ revisionId: 'rev_1', projectId: 'p_1' }],
    getCurrentRevision: () => ({ revisionId: 'rev_1', projectId: 'p_1' }),
  };
  const tools = createResultChangeSetTools({
    db: {
      db: {},
      getProject: () => ({ id: 'p_1', user_id: 'u_1', workspace_path: '/tmp/p_1' }),
      getToolJob: () => null,
    },
    createResultStudioRepository: () => repository,
    bindProjectRepository: () => ({
      status: 'ready', mode: 'managed', workspaceRoot: '/tmp/p_1', managedPaths: [], reason: null,
      inspection: { runtime: {} }, adapter: { gitDir: '/tmp/git', workTree: '/tmp/p_1' },
    }),
    compareResultChangeSet: (input) => { calls.push(['compare', input]); return { summary: { status: 'preview_ready' } }; },
    adoptResultChangeSet: (input) => { calls.push(['adopt', input]); return { changeSet: { status: 'adopted' } }; },
    revertResultChangeSet: (input) => { calls.push(['revert', input]); return { changeSet: { status: 'reverted' } }; },
    restoreArtifactRevision: (input) => { calls.push(['restore', input]); return { revision: { revisionId: 'rev_restored' } }; },
  });
  const ctx = { projectId: 'p_1', userId: 'u_1', conversationId: 'conv_1' };
  assert.equal((await tools.compare({ changeSetId: 'cs_1' }, ctx)).ok, true);
  assert.equal((await tools.adopt({ changeSetId: 'cs_1' }, ctx)).ok, true);
  assert.equal((await tools.revert({ changeSetId: 'cs_1' }, ctx)).ok, true);
  assert.equal((await tools.listRevisions({ artifactFamilyId: 'family' }, ctx)).revisions.length, 1);
  assert.equal((await tools.restore({ revisionId: 'rev_1' }, ctx)).ok, true);
  assert.deepEqual(calls.map(([name]) => name), ['compare', 'adopt', 'revert', 'restore']);
  assert.equal(calls.every(([, input]) => input.projectId === 'p_1'), true);
});

test('RS6 Agent can read history in a dirty existing repository but cannot write it', async () => {
  const repository = {
    saveRepositoryBinding: () => {},
    getChangeSet: () => ({ changeSetId: 'cs_1', projectId: 'p_1' }),
    listRevisions: () => [{ revisionId: 'rev_1', projectId: 'p_1' }],
    getCurrentRevision: () => ({ revisionId: 'rev_1', projectId: 'p_1' }),
  };
  const tools = createResultChangeSetTools({
    db: {
      db: {},
      getProject: () => ({ id: 'p_1', user_id: 'u_1', workspace_path: '/tmp/p_1' }),
      getToolJob: () => null,
    },
    createResultStudioRepository: () => repository,
    bindProjectRepository: () => ({
      status: 'blocked', mode: 'existing', workspaceRoot: '/tmp/p_1', managedPaths: [],
      reason: 'blocked_dirty_conflict', inspection: { runtime: {}, existing: { workspaceRelativeToRepository: 'project' } },
      adapter: { gitDir: '/tmp/git', workTree: '/tmp/repo' },
    }),
    compareResultChangeSet: () => ({ summary: { status: 'preview_ready' } }),
  });
  const ctx = { projectId: 'p_1', userId: 'u_1' };
  assert.equal((await tools.compare({ changeSetId: 'cs_1' }, ctx)).ok, true);
  assert.equal((await tools.listRevisions({ artifactFamilyId: 'family' }, ctx)).ok, true);
  assert.equal((await tools.adopt({ changeSetId: 'cs_1' }, ctx)).error, 'blocked_dirty_conflict');
});
