import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const selectionDbRoot = mkdtempSync(join(tmpdir(), 'biof3-rs-selection-db-'));
const selectionDbPath = join(selectionDbRoot, 'test.db');
process.env.BIOF3_DB_PATH = selectionDbPath;
const { runMigrations } = require('../src/migration-runner');
await runMigrations(selectionDbPath, join(REPO_ROOT, 'src', 'migrations'));
const {
  tool_result_selection_run,
  tool_result_enrichment_from_revision,
} = require('../core/biof3-server/agent-tools/result-selection-tools');
process.env.BIOF3_DB_PATH = undefined;
rmSync(selectionDbRoot, { recursive: true, force: true });

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fixture(context, selectionOverrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'biof3-rs-p2-selection-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const csv = 'gene,log2FoldChange,padj\nTP53,2,0.01\nEGFR,1.5,0.02\nMYC,-2,0.03\nKRAS,0.2,0.9\n';
  const source = join(root, 'deg.csv');
  writeFileSync(source, csv);
  const revision = {
    revisionId: 'rev_1', projectId: 'project_1', artifactFamilyId: 'family_1', artifactId: 'deg_table',
    outputPath: 'deg.csv', outputHash: sha256(csv), toolJobId: 'job_1',
  };
  const selection = {
    selectionId: 'sel_1', projectId: 'project_1', conversationId: 'conv_1', artifactId: 'deg_table',
    revisionId: 'rev_1', entityType: 'gene', entityIds: ['TP53', 'EGFR', 'MYC'], entityIdCount: 3,
    entityIdsTruncated: false,
    entityIdsHash: sha256(JSON.stringify(['TP53', 'EGFR', 'MYC'].sort())), filterHash: null,
    filterExpression: null, sort: [], displayState: { durable: true }, ...selectionOverrides,
  };
  const repository = {
    getSelection: (id) => id === selection.selectionId ? selection : null,
    getRevision: (id) => id === revision.revisionId ? revision : null,
    getCurrentRevision: () => revision,
    saveWorkflowGraph: (graph) => graph,
  };
  return {
    root,
    dependencies: {
      repository,
      getProject: () => ({ id: 'project_1', workspace_path: root }),
      getToolJob: () => ({
        id: 'job_1', project_id: 'project_1', tool_id: 'deseq2', status: 'completed',
        result: {
          artifactTruth: { status: 'valid', blocking: false },
          artifacts: [{ id: 'deg_table', path: source, name: 'deg.csv', type: 'table', sha256: sha256(csv) }],
        },
      }),
      getPluginManifest: () => ({ resultStudio: {
        actions: ['select_genes', 'derive_enrichment_input'],
        artifacts: [{ id: 'deg_table', filename: 'deg.csv', type: 'table' }],
        interactionMappings: [{ artifactId: 'deg_table', mode: 'table', entityType: 'gene', idField: 'gene' }],
      } }),
      verifyRevisionSourceMaterial: () => ({ reproduction: { inputDrift: [] } }),
      listProjectToolJobsForWorkflow: () => [],
      buildAuthoritativeWorkflowGraph: ({ projectId, sourceToolJobId, requiredToolJobIds }) => ({
        ok: true,
        diagnostics: [],
        graph: {
          graphId: 'wfg_test',
          sourceDigest: 'a'.repeat(64),
          projectId,
          rootToolJobId: sourceToolJobId,
          validationStatus: 'valid',
          nodes: [],
          edges: [],
        },
        workflowPlan: {
          authority: 'sqlite_job_artifact_truth',
          graphId: 'wfg_test',
          sourceDigest: 'a'.repeat(64),
          rootToolJobId: sourceToolJobId,
          steps: requiredToolJobIds.map((toolJobId) => ({ id: `job:${toolJobId}`, toolJobId })),
        },
      }),
    },
  };
}

test('RS-P2 selection action materializes an independent script then uses the formal run_tool chain', async (context) => {
  const fx = fixture(context);
  let call = null;
  fx.dependencies.runTool = async (args, ctx) => {
    call = { args, ctx };
    return { ok: true, toolJobId: 'job_enrichment', artifactTruth: { status: 'valid' } };
  };
  const result = await tool_result_selection_run({
    selectionId: 'sel_1', action: 'go_kegg', species: 'human', geneIdType: 'auto',
  }, { userId: 'user_1', projectId: 'project_1', accessMode: 'full' }, fx.dependencies);
  assert.equal(result.ok, true);
  assert.equal(call.args.op, 'run');
  assert.equal(call.args.toolId, 'go-kegg');
  assert.match(call.args.params.deg_table, /gene-list\.csv$/);
  assert.equal(readFileSync(join(fx.root, result.selectionAction.materialization.output), 'utf8'), 'gene\n"TP53"\n"EGFR"\n"MYC"\n');
  assert.match(readFileSync(join(fx.root, result.selectionAction.materialization.script), 'utf8'), /write\.csv/);
  assert.equal(result.selectionAction.executorTruth, 'run_tool → tool_job → artifact truth');
});

test('RS-P2 selection action blocks stale revisions before creating downstream work', async (context) => {
  const fx = fixture(context);
  fx.dependencies.repository.getCurrentRevision = () => ({ revisionId: 'rev_2' });
  let called = false;
  fx.dependencies.runTool = async () => { called = true; return { ok: true }; };
  const result = await tool_result_selection_run({ selectionId: 'sel_1', action: 'go_kegg' }, {
    userId: 'user_1', projectId: 'project_1', accessMode: 'full',
  }, fx.dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'selection_not_compatible');
  assert.equal(called, false);
});

test('RS-P2 query selection blocks when its authoritative count or hash drifts', async (context) => {
  const fx = fixture(context, {
    entityIds: ['TP53'], entityIdCount: 3, entityIdsTruncated: true,
    entityIdsHash: 'f'.repeat(64), filterHash: 'e'.repeat(64),
    filterExpression: { logic: 'and', clauses: [{ field: 'padj', op: 'lt', value: 0.05 }] },
  });
  const result = await tool_result_selection_run({ selectionId: 'sel_1', action: 'go_kegg' }, {
    userId: 'user_1', projectId: 'project_1', accessMode: 'full',
  }, fx.dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'selection_query_evidence_drift');
});

test('RS-P2 explicit selection blocks when its persisted entity hash drifts', async (context) => {
  const fx = fixture(context, { entityIdsHash: 'f'.repeat(64) });
  let called = false;
  fx.dependencies.runTool = async () => { called = true; return { ok: true }; };
  const result = await tool_result_selection_run({ selectionId: 'sel_1', action: 'go_kegg' }, {
    userId: 'user_1', projectId: 'project_1', accessMode: 'full',
  }, fx.dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'selection_entity_hash_drift');
  assert.equal(called, false);
});

test('P6 selection action binds a separate backing table to its exact Artifact Truth SHA', async (context) => {
  const fx = fixture(context);
  const plot = join(fx.root, 'volcano.svg');
  const plotBytes = '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n';
  writeFileSync(plot, plotBytes);
  const revision = fx.dependencies.repository.getRevision('rev_1');
  const selection = fx.dependencies.repository.getSelection('sel_1');
  Object.assign(revision, {
    artifactId: 'volcano_plot',
    outputPath: 'volcano.svg',
    outputHash: sha256(plotBytes),
  });
  selection.artifactId = 'volcano_plot';
  const trustedTable = readFileSync(join(fx.root, 'deg.csv'));
  fx.dependencies.getToolJob = () => ({
    id: 'job_1', project_id: 'project_1', tool_id: 'deseq2', status: 'completed',
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [
        { id: 'volcano_plot', path: plot, name: 'volcano.svg', type: 'plot', sha256: sha256(plotBytes) },
        { id: 'deg_table', path: join(fx.root, 'deg.csv'), name: 'deg.csv', type: 'table', sha256: sha256(trustedTable) },
      ],
    },
  });
  fx.dependencies.getPluginManifest = () => ({ resultStudio: {
    actions: ['select_genes', 'derive_enrichment_input'],
    artifacts: [
      { id: 'volcano_plot', filename: 'volcano.svg', type: 'plot' },
      { id: 'deg_table', filename: 'deg.csv', type: 'table' },
    ],
    interactionMappings: [{
      artifactId: 'volcano_plot', mode: 'plot', entityType: 'gene', idField: 'gene', dataArtifactId: 'deg_table',
    }],
  } });
  writeFileSync(join(fx.root, 'deg.csv'), `${trustedTable.toString('utf8')}FAKE,9,0.001\n`);

  let called = false;
  fx.dependencies.runTool = async () => { called = true; return { ok: true }; };
  const result = await tool_result_selection_run({ selectionId: 'sel_1', action: 'go_kegg' }, {
    userId: 'user_1', projectId: 'project_1', accessMode: 'full',
  }, fx.dependencies);

  assert.equal(result.ok, false);
  assert.equal(result.error, 'artifact_truth_drift');
  assert.equal(called, false);
});

test('RS-P2 rejects an unsafe persisted selection id before materializing project files', async (context) => {
  const unsafe = 'sel_../../outside';
  const fx = fixture(context, { selectionId: unsafe });
  const result = await tool_result_selection_run({ selectionId: unsafe, action: 'go_kegg' }, {
    userId: 'user_1', projectId: 'project_1', accessMode: 'full',
  }, fx.dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'selection_id_invalid');
});

test('P6 selection materialization refuses directory and target symlinks without touching outside files', async (context) => {
  const outside = mkdtempSync(join(tmpdir(), 'biof3-rs-p6-selection-outside-'));
  context.after(() => rmSync(outside, { recursive: true, force: true }));

  const directoryFx = fixture(context);
  symlinkSync(outside, join(directoryFx.root, 'analysis'));
  let called = false;
  directoryFx.dependencies.runTool = async () => { called = true; return { ok: true }; };
  const directoryResult = await tool_result_selection_run({ selectionId: 'sel_1', action: 'go_kegg' }, {
    userId: 'user_1', projectId: 'project_1', accessMode: 'full',
  }, directoryFx.dependencies);
  assert.equal(directoryResult.ok, false);
  assert.equal(directoryResult.error, 'selection_materialization_path_unsafe');
  assert.equal(called, false);
  assert.equal(existsSync(join(outside, 'selections')), false);

  const targetFx = fixture(context);
  const materializationDir = join(targetFx.root, 'analysis', 'selections', 'sel_1');
  mkdirSync(materializationDir, { recursive: true });
  const outsideSentinel = join(outside, 'sentinel.csv');
  writeFileSync(outsideSentinel, 'OUTSIDE_MUST_NOT_CHANGE\n');
  symlinkSync(outsideSentinel, join(materializationDir, 'gene-list.csv'));
  targetFx.dependencies.runTool = async () => { called = true; return { ok: true }; };
  const targetResult = await tool_result_selection_run({ selectionId: 'sel_1', action: 'go_kegg' }, {
    userId: 'user_1', projectId: 'project_1', accessMode: 'full',
  }, targetFx.dependencies);
  assert.equal(targetResult.ok, false);
  assert.equal(targetResult.error, 'selection_materialization_path_unsafe');
  assert.equal(readFileSync(outsideSentinel, 'utf8'), 'OUTSIDE_MUST_NOT_CHANGE\n');
  assert.equal(called, false);
});

test('P5 derives GO/KEGG from exact current DEG bytes with private artifact lineage', async (context) => {
  const fx = fixture(context);
  let call = null;
  fx.dependencies.runTool = async (args, ctx) => {
    call = { args, ctx };
    return { ok: true, toolJobId: 'job_enrichment', artifactTruth: { status: 'valid' } };
  };
  const result = await tool_result_enrichment_from_revision({
    revisionId: 'rev_1', species: 'human', geneIdType: 'auto', analysisType: 'GO-BP', padjCutoff: 0.01, lfcCutoff: 1.5,
  }, { userId: 'user_1', projectId: 'project_1', accessMode: 'full' }, fx.dependencies);
  assert.equal(result.ok, true);
  assert.equal(call.args.toolId, 'go-kegg');
  assert.match(call.args.params.deg_table, /deg\.csv$/);
  assert.equal(call.args.params.padj_cutoff, 0.01);
  assert.equal(call.ctx.resultStudioInputLineage.deg_table.kind, 'artifact');
  assert.equal(call.ctx.resultStudioInputLineage.deg_table.sourceRevisionId, 'rev_1');
  assert.equal(call.ctx.resultStudioInputLineage.deg_table.materializationHash, fx.dependencies.repository.getRevision('rev_1').outputHash);
  assert.equal(result.enrichmentAction.executorTruth, 'run_tool → tool_job → artifact truth');
});

test('P5 direct enrichment refuses non-current or undeclared DEG source before execution', async (context) => {
  const fx = fixture(context);
  fx.dependencies.repository.getCurrentRevision = () => ({ revisionId: 'rev_later' });
  let called = false;
  fx.dependencies.runTool = async () => { called = true; return { ok: true }; };
  const result = await tool_result_enrichment_from_revision({ revisionId: 'rev_1' }, {
    userId: 'user_1', projectId: 'project_1', accessMode: 'full',
  }, fx.dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'deg_revision_not_current');
  assert.equal(called, false);
});

test('P5 downstream actions refuse immutable source input drift before execution', async (context) => {
  const fx = fixture(context);
  fx.dependencies.verifyRevisionSourceMaterial = () => {
    const error = new Error('One or more reproducibility inputs changed or are unavailable.');
    error.code = 'source_input_drift';
    throw error;
  };
  let called = false;
  fx.dependencies.runTool = async () => { called = true; return { ok: true }; };

  const direct = await tool_result_enrichment_from_revision({ revisionId: 'rev_1' }, {
    userId: 'user_1', projectId: 'project_1', accessMode: 'full',
  }, fx.dependencies);
  assert.equal(direct.ok, false);
  assert.equal(direct.error, 'source_input_drift');

  const selected = await tool_result_selection_run({ selectionId: 'sel_1', action: 'go_kegg' }, {
    userId: 'user_1', projectId: 'project_1', accessMode: 'full',
  }, fx.dependencies);
  assert.equal(selected.ok, false);
  assert.equal(selected.error, 'source_input_drift');
  assert.equal(called, false);
});

test('P5 selection action fails closed after execution when the authoritative DAG cannot be built', async (context) => {
  const fx = fixture(context);
  fx.dependencies.runTool = async () => ({ ok: true, toolJobId: 'job_enrichment' });
  fx.dependencies.buildAuthoritativeWorkflowGraph = () => ({
    ok: false,
    diagnostics: [{ code: 'workflow_required_job_disconnected' }],
  });

  const result = await tool_result_selection_run({ selectionId: 'sel_1', action: 'go_kegg' }, {
    userId: 'user_1', projectId: 'project_1', accessMode: 'full',
  }, fx.dependencies);

  assert.equal(result.ok, false);
  assert.equal(result.error, 'workflow_graph_persistence_failed');
  assert.equal(result.detail.executionCompleted, true);
  assert.equal(result.detail.toolJobId, 'job_enrichment');
  assert.equal(result.detail.diagnostics[0].code, 'workflow_required_job_disconnected');
});

test('P5 direct enrichment fails closed after execution when DAG persistence fails', async (context) => {
  const fx = fixture(context);
  fx.dependencies.runTool = async () => ({ ok: true, toolJobId: 'job_enrichment' });
  fx.dependencies.repository.saveWorkflowGraph = () => {
    const error = new Error('disk full');
    error.code = 'workflow_graph_write_failed';
    throw error;
  };

  const result = await tool_result_enrichment_from_revision({ revisionId: 'rev_1' }, {
    userId: 'user_1', projectId: 'project_1', accessMode: 'full',
  }, fx.dependencies);

  assert.equal(result.ok, false);
  assert.equal(result.error, 'workflow_graph_persistence_failed');
  assert.equal(result.detail.executionCompleted, true);
  assert.equal(result.detail.diagnostics[0].code, 'workflow_graph_write_failed');
});
