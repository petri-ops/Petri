import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const {
  createResultEditPlanTool,
  createResultChangeSetTools,
  projectDirectEnrichmentSubgraph,
} = require('../core/r-server/agent-tools/result-edit-tools');
const { normalizePluginManifest } = require('../core/r-server/plugin-loader');
const { computeExecutionProvenanceHash } = require('../core/shared-backend/execution-provenance');

function makeJob(projectId = 'p_1') {
  const provenance = {
    executionProvenanceVersion: 1,
    toolJobId: 'tj_plot', projectId,
    script: { snapshotPath: '/snapshot/run.R', sha256: 'a'.repeat(64) },
    inputs: [{ relativePath: 'inputs/deg.csv', sha256: 'b'.repeat(64), sourceArtifactRef: 'deg_table' }],
    artifacts: [{ id: 'volcano_plot', filename: 'volcano.png', sha256: 'c'.repeat(64) }],
  };
  provenance.provenanceHash = computeExecutionProvenanceHash(provenance);
  return {
    id: 'tj_plot', project_id: projectId, tool_id: 'volcano-plot', status: 'completed',
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'volcano_plot', name: 'volcano.png' }],
      executionProvenance: provenance,
    },
  };
}

function makeRootOnlyCorrelationJob(projectId = 'p_1') {
  const provenance = {
    executionProvenanceVersion: 1,
    toolJobId: 'tj_corr', projectId,
    script: { snapshotPath: '/snapshot/gene-correlation.R', sha256: 'a'.repeat(64) },
    // This is a root input, not an upstream Result Studio artifact. It has a
    // durable input hash but intentionally no model-supplied edge.
    inputs: [{ id: 'expr_matrix', relativePath: 'inputs/expression.csv', sha256: 'b'.repeat(64) }],
    artifacts: [{ id: 'corr_matrix', filename: 'corr_matrix.csv', sha256: 'c'.repeat(64) }],
  };
  provenance.provenanceHash = computeExecutionProvenanceHash(provenance);
  return {
    id: 'tj_corr', project_id: projectId, tool_id: 'gene-correlation', status: 'completed',
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'corr_matrix', name: 'corr_matrix.csv' }],
      executionProvenance: provenance,
    },
  };
}

const args = {
  toolJobId: 'tj_plot', artifactId: 'volcano_plot', revisionId: 'rev_1',
  requestedOutcome: 'use a blue palette', proposedParameterPatch: { palette: 'blue' },
};

function trustedWorkflowPlan(rootToolJobId = 'tj_plot') {
  return {
    workflowTruthVersion: 1,
    authority: 'sqlite_job_artifact_truth',
    graphId: 'wfg_test_graph',
    sourceDigest: 'd'.repeat(64),
    rootToolJobId,
    steps: [{ id: `job:${rootToolJobId}`, toolJobId: rootToolJobId, dependsOn: [] }],
  };
}

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

test('P5 Agent plan tool rejects a model-supplied workflow graph', async () => {
  const tool = createResultEditPlanTool({ getToolJob: () => makeJob() });
  const result = await tool({ ...args, workflowPlan: trustedWorkflowPlan() }, { projectId: 'p_1' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'workflow_plan_forbidden');
});

test('P5 scientific plan persists a server-projected root-only graph before it becomes executable', async () => {
  const job = makeRootOnlyCorrelationJob();
  const savedGraphs = [];
  const repository = {
    findWorkflowGraph({ projectId, sourceDigest }) {
      return savedGraphs.find((graph) => graph.projectId === projectId && graph.sourceDigest === sourceDigest) || null;
    },
    saveWorkflowGraph(graph) {
      const saved = { ...graph };
      savedGraphs.push(saved);
      return saved;
    },
  };
  const tool = createResultEditPlanTool({
    getToolJob: () => job,
    getPluginManifest: () => ({ resultStudio: { parameterImpacts: { method: 'scientific_recompute' } } }),
    listProjectToolJobsForWorkflow: () => [job],
    createResultStudioRepository: () => repository,
  });
  const request = {
    toolJobId: job.id,
    artifactId: 'corr_matrix',
    revisionId: 'rev_corr_1',
    requestedOutcome: 'Recompute the correlation matrix with Spearman correlation.',
    proposedParameterPatch: { method: 'spearman' },
  };
  const result = await tool(request, {
    projectId: 'p_1',
    // This private-looking graph is deliberately wrong.  The plan must
    // derive and persist `tj_corr` from the completed Job, not trust ctx.
    resultStudioWorkflowPlan: trustedWorkflowPlan('tj_invented'),
  });
  assert.equal(result.ok, true);
  // `method` is deliberately conservatively classified as a workflow
  // replan.  It still belongs to the scientific/data/workflow gate.
  assert.equal(result.intent.editClass, 'workflow_replan');
  assert.equal(result.intent.affectedScope, 'workflow_subgraph');
  assert.equal(result.intent.workflowGraph?.graphId, savedGraphs[0].graphId);
  assert.deepEqual(savedGraphs[0].nodes.map((node) => node.toolJobId), ['tj_corr']);
  assert.deepEqual(savedGraphs[0].edges, []);

  const repeated = await tool(request, { projectId: 'p_1' });
  assert.equal(repeated.ok, true);
  assert.equal(savedGraphs.length, 1, 'the authoritative source digest is persisted idempotently');
});

test('P5 scientific planning cannot recover authority from a caller-carried workflow graph', async () => {
  const job = makeRootOnlyCorrelationJob();
  const fakePlan = trustedWorkflowPlan(job.id);
  const fakeGraph = {
    graphId: fakePlan.graphId,
    projectId: 'p_1',
    rootToolJobId: job.id,
    sourceDigest: fakePlan.sourceDigest,
    validationStatus: 'valid',
    nodes: [{ id: `job:${job.id}`, toolJobId: job.id }],
    edges: [],
  };
  let saves = 0;
  const tool = createResultEditPlanTool({
    getToolJob: () => job,
    getPluginManifest: () => ({ resultStudio: { parameterImpacts: { method: 'scientific_recompute' } } }),
    // No completed Job appears in SQLite's authoritative workflow query.
    listProjectToolJobsForWorkflow: () => [],
    createResultStudioRepository: () => ({
      findWorkflowGraph: () => fakeGraph,
      saveWorkflowGraph: () => { saves += 1; return fakeGraph; },
    }),
  });
  const result = await tool({
    toolJobId: job.id,
    artifactId: 'corr_matrix',
    revisionId: 'rev_corr_1',
    requestedOutcome: 'Recompute correlation.',
    proposedParameterPatch: { method: 'spearman' },
  }, {
    projectId: 'p_1',
    resultStudioWorkflowPlan: fakePlan,
    resultStudioWorkflowGraph: fakeGraph,
  });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some((entry) => entry.code === 'workflow_source_job_unverified'), true);
  assert.equal(saves, 0);
});

test('P6 projects exact current GO and volcano children and rejects ambiguous direct lineage', () => {
  const projectId = 'p_1';
  const outputHash = '1'.repeat(64);
  const sourceRevision = {
    revisionId: 'rev_deg_current', projectId, artifactId: 'deg_table',
    toolJobId: 'tj_deg', outputHash,
  };
  const jobs = new Map([
    ['tj_go', { id: 'tj_go', project_id: projectId, tool_id: 'go-kegg', status: 'completed' }],
    ['tj_go_duplicate', { id: 'tj_go_duplicate', project_id: projectId, tool_id: 'go-kegg', status: 'completed' }],
    ['tj_volcano', { id: 'tj_volcano', project_id: projectId, tool_id: 'volcano-plot', status: 'completed' }],
    ['tj_unknown', { id: 'tj_unknown', project_id: projectId, tool_id: 'unknown-plot', status: 'completed' }],
  ]);
  const edge = (toNodeId) => ({
    kind: 'artifact', fromNodeId: 'job:tj_deg', toNodeId,
    sourceToolJobId: 'tj_deg', sourceRevisionId: sourceRevision.revisionId,
    sourceArtifactId: 'deg_table', sourceOutputHash: outputHash,
    selectionId: null, selectionHash: null, inputId: 'deg_table',
  });
  const graph = {
    ok: true,
    graph: {
      graphId: 'wfg_p6_multi', projectId, rootToolJobId: 'tj_deg', sourceDigest: '2'.repeat(64),
      nodes: [
        { id: 'job:tj_deg', toolJobId: 'tj_deg', toolId: 'deseq2' },
        { id: 'job:tj_go', toolJobId: 'tj_go', toolId: 'go-kegg' },
        { id: 'job:tj_volcano', toolJobId: 'tj_volcano', toolId: 'volcano-plot' },
      ],
      edges: [edge('job:tj_volcano'), edge('job:tj_go')],
    },
  };
  const intent = {
    workflowGraph: { graphId: graph.graph.graphId, sourceDigest: graph.graph.sourceDigest },
    affectedNodeIds: ['job:tj_volcano', 'job:tj_deg', 'job:tj_go'],
  };
  const currentRevisions = [
    { revisionId: 'rev_volcano_current', projectId, toolJobId: 'tj_volcano', artifactId: 'volcano', isCurrent: true },
    { revisionId: 'rev_go_current', projectId, toolJobId: 'tj_go', artifactId: 'go_bp_results', isCurrent: true },
    { revisionId: 'rev_go_report', projectId, toolJobId: 'tj_go', artifactId: 'report', isCurrent: true },
  ];
  const project = ({ workflow = graph, editIntent = intent, revisions = currentRevisions } = {}) => (
    projectDirectEnrichmentSubgraph({
      graph: workflow,
      intent: editIntent,
      sourceRevision,
      repository: { listCurrentRevisions: () => revisions },
      getToolJob: (toolJobId) => jobs.get(toolJobId) || null,
    })
  );

  const result = project();
  assert.equal(result.ok, true);
  assert.deepEqual(result.subgraph.children.map((child) => ({
    nodeId: child.nodeId,
    toolId: child.toolId,
    childRevisionId: child.childRevisionId,
  })), [
    { nodeId: 'job:tj_go', toolId: 'go-kegg', childRevisionId: 'rev_go_current' },
    { nodeId: 'job:tj_volcano', toolId: 'volcano-plot', childRevisionId: 'rev_volcano_current' },
  ]);

  assert.equal(project({
    editIntent: { ...intent, affectedNodeIds: [...intent.affectedNodeIds, 'job:tj_go'] },
  }).error, 'workflow_affected_nodes_invalid');
  assert.equal(project({
    revisions: currentRevisions.filter((revision) => revision.artifactId !== 'volcano'),
  }).error, 'downstream_revision_missing');
  assert.equal(project({
    revisions: currentRevisions.map((revision) => revision.artifactId === 'volcano'
      ? { ...revision, isCurrent: undefined }
      : revision),
  }).error, 'downstream_revision_missing');

  const duplicateToolGraph = structuredClone(graph);
  duplicateToolGraph.graph.nodes = duplicateToolGraph.graph.nodes
    .filter((node) => node.id !== 'job:tj_volcano');
  duplicateToolGraph.graph.edges = duplicateToolGraph.graph.edges
    .filter((entry) => entry.toNodeId !== 'job:tj_volcano');
  duplicateToolGraph.graph.nodes.push({
    id: 'job:tj_go_duplicate', toolJobId: 'tj_go_duplicate', toolId: 'go-kegg',
  });
  duplicateToolGraph.graph.edges.push(edge('job:tj_go_duplicate'));
  assert.equal(project({
    workflow: duplicateToolGraph,
    editIntent: {
      ...intent,
      affectedNodeIds: ['job:tj_deg', 'job:tj_go', 'job:tj_go_duplicate'],
    },
    revisions: [...currentRevisions, {
      revisionId: 'rev_go_duplicate', projectId, toolJobId: 'tj_go_duplicate',
      artifactId: 'go_bp_results', isCurrent: true,
    }],
  }).error, 'workflow_subgraph_unsupported');

  const unsupportedGraph = structuredClone(graph);
  unsupportedGraph.graph.nodes.push({ id: 'job:tj_unknown', toolJobId: 'tj_unknown', toolId: 'unknown-plot' });
  unsupportedGraph.graph.edges.push(edge('job:tj_unknown'));
  assert.equal(project({
    workflow: unsupportedGraph,
    editIntent: {
      ...intent,
      affectedNodeIds: [...intent.affectedNodeIds, 'job:tj_unknown'],
    },
  }).error, 'workflow_subgraph_unsupported');

  const multiEdgeGraph = structuredClone(graph);
  multiEdgeGraph.graph.edges.push({ ...edge('job:tj_go'), inputId: 'deg_table_duplicate' });
  assert.equal(project({ workflow: multiEdgeGraph }).error, 'workflow_subgraph_unsupported');

  const selectionGraph = structuredClone(graph);
  selectionGraph.graph.edges = selectionGraph.graph.edges.map((entry) => entry.toNodeId === 'job:tj_go'
    ? { ...entry, kind: 'selection', selectionId: 'sel_1', selectionHash: '3'.repeat(64) }
    : entry);
  assert.equal(project({ workflow: selectionGraph }).error, 'workflow_downstream_lineage_drift');
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

test('RS4 plugin normalization rejects incomplete Result Studio metadata', () => {
  const manifest = normalizePluginManifest(
    { id: 'plotter', version: '1.0.0', language: 'r' },
    { id: 'plotter', resultStudio: { parameterImpacts: { palette: 'presentation' } } }
  );
  assert.equal(manifest.resultStudio, null);
  assert.equal(manifest.resultStudioValidation.valid, false);
  assert.equal(normalizePluginManifest({ id: 'legacy' }, { id: 'legacy' }).resultStudio, null);
});

test('RS5 Agent ChangeSet tool scopes the source and emits durable progress', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'biof3-rs5-agent-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const script = join(root, 'results/jobs/tj_plot/run-script.R');
  mkdirSync(join(script, '..'), { recursive: true });
  writeFileSync(script, 'print(1)\n');
  const scriptHash = createHash('sha256').update('print(1)\n').digest('hex');
  const paramsText = '{\n  "palette": "red"\n}\n';
  const paramsHash = createHash('sha256').update(paramsText).digest('hex');
  writeFileSync(script, 'tampered snapshot\n');
  const project = { id: 'p_1', user_id: 'u_1', workspace_path: root };
  const job = makeJob();
  job.result.executionProvenance.script = { snapshotPath: script, sha256: scriptHash };
  const sourceCommit = 'a'.repeat(40);
  const revision = {
    revisionId: 'rev_1', projectId: 'p_1', artifactId: 'volcano_plot', toolJobId: 'tj_plot',
    sourceCommit,
    sourceScriptRef: { relativePath: 'analysis/scripts/plot.R', sha256: scriptHash, artifactId: 'volcano_plot', rendererId: 'volcano-plot:volcano_plot', language: 'r', origin: 'project_materialized' },
    parametersRef: 'analysis/scripts/parameters.json', parametersHash: paramsHash,
    outputHash: 'c'.repeat(64), changeSetId: 'cs_1',
  };
  const repository = {
    saveRepositoryBinding: () => {},
    getRevision: () => revision,
    getChangeSet: () => ({ changeSetId: 'cs_1', projectId: 'p_1', candidateCommit: sourceCommit }),
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
      adapter: {
        gitDir: join(root, '.biof3/git'), workTree: root,
        revParse: (ref) => ref === `${sourceCommit}^{commit}` ? sourceCommit : null,
        showFile: ({ filePath }) => filePath.endsWith('plot.R') ? 'print(1)\n' : paramsText,
      },
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
  assert.equal(received.sourceScriptContent, 'print(1)\n', 'Agent edits must start from the Revision Git source, not a mutable Job snapshot');
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
  const descriptor = { validator: { id: 'volcano-validator' } };
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
    getResultStudioDescriptor: () => descriptor,
    restoreArtifactRevision: (input, dependencies) => {
      assert.equal(dependencies.getResultStudioDescriptor('volcano-plot'), descriptor);
      calls.push(['restore', input]);
      return { revision: { revisionId: 'rev_restored' } };
    },
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
