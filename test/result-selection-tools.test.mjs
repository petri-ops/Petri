import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  tool_result_selection_run,
  tool_result_enrichment_from_revision,
} = require('../core/r-server/agent-tools/result-selection-tools');

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
          artifacts: [{ id: 'deg_table', path: source, name: 'deg.csv', type: 'table' }],
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

test('RS-P2 rejects an unsafe persisted selection id before materializing project files', async (context) => {
  const unsafe = 'sel_../../outside';
  const fx = fixture(context, { selectionId: unsafe });
  const result = await tool_result_selection_run({ selectionId: unsafe, action: 'go_kegg' }, {
    userId: 'user_1', projectId: 'project_1', accessMode: 'full',
  }, fx.dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'selection_id_invalid');
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
