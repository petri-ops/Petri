import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { bindProjectRepository } = require('../core/shared-backend/git-repository-binding');
const { ensureResultStudioSchema } = require('../core/shared-backend/result-studio-schema');
const { ensureResultRefTransactionSchema } = require('../core/shared-backend/result-ref-transaction-schema');
const {
  ensureResultWorkflowGraphSchema,
  workflowGraphDigest,
} = require('../core/shared-backend/result-workflow-graph');
const { computeExecutionProvenanceHash } = require('../core/shared-backend/execution-provenance');
const { createResultStudioRepository } = require('../core/shared-backend/result-studio-repository');
const {
  ResultChangeSetError,
  applyExactScriptPatch,
  createResultChangeSet,
  ensureBaselineArtifactCohort,
  ensureBaselineArtifactRevision,
  inspectBaselineArtifactCohort,
  inspectPersistedArtifactCohort,
  inspectResultEditRecovery,
  materializeResultEdit,
  sha256,
  _test: changeSetTest,
} = require('../core/shared-backend/result-changeset-service');
const { projectRevisionSource } = require('../core/shared-backend/result-revision-source');
const { restoreArtifactRevision } = require('../core/shared-backend/result-compare-service');
const { resolveResultStudioScriptOverride } = require('../core/r-server/mcp/registry')._test;

function signedExecutionProvenance(payload) {
  return { ...payload, provenanceHash: computeExecutionProvenanceHash(payload) };
}

// 符号链接在 Windows 非提权环境下默认禁止创建（EPERM），而 CI/macOS 支持。
// 本文件用符号链接验证「脚本不得通过软链逃逸 ChangeSet 根目录」；
// 不支持时跳过该子断言，避免 Windows 本地误报失败（macOS/CI 仍完整覆盖）。
function symlinksSupported() {
  const probe = mkdtempSync(join(tmpdir(), 'biof3-symlink-probe-'));
  try {
    symlinkSync(join(probe, 'target'), join(probe, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    try { rmSync(probe, { recursive: true, force: true }); } catch { /* noop */ }
  }
}
const SYMLINKS_SUPPORTED = symlinksSupported();

function fixture(context, suffix = '') {
  const workspaceRoot = mkdtempSync(join(tmpdir(), `biof3-rs5-${suffix}`));
  const db = new Database(join(workspaceRoot, '.rs5-test.db'));
  // 先关库再删目录：Windows 上打开的 SQLite 文件无法删除（EPERM）。
  context.after(() => {
    try { db.close(); } catch { /* already closed */ }
    rmSync(workspaceRoot, { recursive: true, force: true });
  });
  ensureResultStudioSchema(db);
  ensureResultWorkflowGraphSchema(db);
  ensureResultRefTransactionSchema(db);
  const repository = createResultStudioRepository(db, { ensureSchema: false });
  const binding = bindProjectRepository({ workspaceRoot, projectId: 'p_1' });
  const adapter = binding.adapter;
  const sourceScriptContent = 'palette <- "red"\nprint("render")\n';
  const sourceInput = join(workspaceRoot, 'inputs/deg/deg.csv');
  mkdirSync(join(sourceInput, '..'), { recursive: true });
  writeFileSync(sourceInput, 'gene,log2FoldChange,padj\nTP53,2,0.01\n');
  const sourceInputHash = sha256(readFileSync(sourceInput));
  const sourceParametersContent = `{\n  "deg_table": {\n    "inputRef": "inputs/deg/deg.csv",\n    "sha256": "${sourceInputHash}"\n  },\n  "palette": "red",\n  "point_size": 2\n}\n`;
  const gitPrefix = suffix.startsWith('git-prefix-') ? 'projects/p_1/' : '';
  const base = adapter.commitVirtualFiles({
    ref: 'refs/heads/biof3/main',
    expectedOld: '0'.repeat(40),
    message: 'RS5 source',
    files: [
      { path: `${gitPrefix}analysis/scripts/source/plot.R`, content: sourceScriptContent },
      { path: `${gitPrefix}analysis/scripts/source/parameters.json`, content: sourceParametersContent },
    ],
  });
  const sourceOutput = join(workspaceRoot, 'results/jobs/tj_source/output/volcano.png');
  mkdirSync(join(sourceOutput, '..'), { recursive: true });
  writeFileSync(sourceOutput, 'SOURCE-ARTIFACT');
  const sourceOutputHash = sha256(readFileSync(sourceOutput));
  repository.createChangeSet({
    changeSetId: 'cs_source', projectId: 'p_1', baseCommit: base.commit,
    workingBranchRef: 'refs/heads/biof3/source', createdBy: 'agent',
  });
  repository.transitionChangeSet({ changeSetId: 'cs_source', to: 'running' });
  repository.transitionChangeSet({
    changeSetId: 'cs_source', to: 'preview_ready', candidateCommit: base.commit,
    candidateArtifactRefs: ['rev_source'], jobRefs: ['tj_source'],
  });
  const sourceRevision = repository.appendRevision({
    revisionId: 'rev_source', projectId: 'p_1', artifactFamilyId: 'volcano_family',
    artifactId: 'volcano_plot', sourceCommit: base.commit,
    sourceScriptRef: {
      relativePath: 'analysis/scripts/source/plot.R', sha256: sha256(sourceScriptContent),
      artifactId: 'volcano_plot', rendererId: 'volcano-plot:volcano_plot',
      language: 'r', origin: 'execution_snapshot',
    },
    parametersRef: 'analysis/scripts/source/parameters.json',
    parametersHash: sha256(sourceParametersContent), toolJobId: 'tj_source',
    outputPath: 'results/jobs/tj_source/output/volcano.png', outputHash: sourceOutputHash,
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_source',
  });
  repository.adoptChangeSet({ changeSetId: 'cs_source', candidateCommit: base.commit });
  const sourceJob = {
    id: 'tj_source', project_id: 'p_1', tool_id: 'volcano-plot', status: 'completed',
    params: { deg_table: sourceInput, palette: 'red', point_size: 2 },
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'volcano_plot', type: 'plot', path: sourceOutput }],
      executionProvenance: {
        toolJobId: 'tj_source', projectId: 'p_1',
        params: { normalized: { deg_table: { inputRef: 'inputs/deg/deg.csv', sha256: sourceInputHash }, palette: 'red', point_size: 2 } },
        inputs: [{ id: 'deg_table', role: 'table', relativePath: 'inputs/deg/deg.csv', sha256: sourceInputHash, sourceArtifactRef: 'deg_revision_1' }],
        script: { snapshotPath: '/snapshot/run.R', sha256: sha256(sourceScriptContent) },
        artifacts: [{ id: 'volcano_plot', filename: 'volcano.png', sha256: sourceOutputHash }],
      },
    },
  };
  const intent = {
    contractVersion: '1', intentId: 'rei_rs5',
    artifactRef: { artifactId: 'volcano_plot', revisionId: 'rev_source' },
    requestedOutcome: 'use blue palette', editClass: 'presentation_rerender',
    proposedParameterPatch: { palette: 'blue' }, affectedNodeIds: ['plot'],
    requiresJob: true, requiresScientificConfirmation: false,
    classificationReason: 'palette:presentation_rerender(declared_parameter_impact)',
  };
  return { workspaceRoot, db, repository, adapter, sourceScriptContent, sourceInput, sourceInputHash, sourceOutput, sourceOutputHash, sourceRevision, sourceJob, intent };
}

function successfulExecutor(fx, artifactText = 'CANDIDATE') {
  return async ({ materializedScriptPath, materializedScriptSha256, params }) => {
    assert.equal(existsSync(materializedScriptPath), true);
    assert.equal(sha256(readFileSync(materializedScriptPath)), materializedScriptSha256);
    assert.equal(params.palette, 'blue');
    assert.equal(params.point_size, 2);
    const output = join(fx.workspaceRoot, `results/jobs/tj_candidate_${artifactText}/output/volcano.png`);
    mkdirSync(join(output, '..'), { recursive: true });
    writeFileSync(output, artifactText);
    const outputHash = sha256(readFileSync(output));
    const toolJobId = `tj_candidate_${artifactText}`;
    return {
      job: {
        id: toolJobId, project_id: 'p_1', tool_id: 'volcano-plot', status: 'completed',
        result: {
          artifactTruth: { status: 'valid', blocking: false },
          artifacts: [{ id: 'volcano_plot', type: 'plot', path: output }],
          executionProvenance: signedExecutionProvenance({
            executionProvenanceVersion: 1, toolJobId, projectId: 'p_1',
            script: { sha256: materializedScriptSha256 },
            params: { normalized: { deg_table: { inputRef: 'inputs/deg/deg.csv', sha256: fx.sourceInputHash }, palette: 'blue', point_size: 2 } },
            inputs: [{ id: 'deg_table', role: 'table', relativePath: 'inputs/deg/deg.csv', sha256: fx.sourceInputHash }],
            artifacts: [{ id: 'volcano_plot', filename: 'volcano.png', sha256: outputHash }],
          }),
        },
      },
    };
  };
}

function volcanoDescriptor() {
  return {
    inputBindings: [{ inputId: 'deg_table', required: true }],
    artifacts: [{ id: 'volcano_plot', type: 'plot' }],
    interactionMappings: [],
    validator: {
      id: 'volcano_test_validator',
      checks: ['artifact_truth_valid', 'script_sha256', 'input_sha256', 'output_sha256'],
    },
  };
}

function deseqDescriptor() {
  return {
    parameters: {
      padj_cutoff: { type: 'number', minimum: 0, maximum: 1 },
      lfc_cutoff: { type: 'number', minimum: 0 },
    },
    artifacts: [{ id: 'deg_table', type: 'table' }, { id: 'deg_summary', type: 'table' }],
    interactionMappings: [{ artifactId: 'deg_table', mode: 'table', entityType: 'gene', idField: 'gene' }],
    validator: {
      id: 'deseq_test_validator',
      checks: ['artifact_truth_valid', 'script_sha256', 'output_sha256', 'stable_gene_id'],
    },
  };
}

function goDescriptor() {
  return {
    parameters: {
      padj_cutoff: { type: 'number', minimum: 0, maximum: 1 },
      lfc_cutoff: { type: 'number', minimum: 0 },
    },
    inputBindings: [{ inputId: 'deg_table', required: true }],
    artifacts: [{ id: 'go_bp_results', type: 'table' }],
    interactionMappings: [{ artifactId: 'go_bp_results', mode: 'table', entityType: 'pathway', idField: 'ID' }],
    validator: {
      id: 'go_test_validator',
      checks: ['artifact_truth_valid', 'script_sha256', 'input_sha256', 'output_sha256', 'stable_term_id', 'empty_result_is_valid'],
    },
  };
}

function volcanoChildDescriptor() {
  return {
    parameters: {
      fc_threshold: { type: 'number', minimum: 0 },
      pval_threshold: { type: 'number', minimum: 0 },
    },
    inputBindings: [{ inputId: 'deg_table', required: true }],
    artifacts: [{ id: 'volcano', type: 'plot' }],
    interactionMappings: [{ artifactId: 'volcano', mode: 'scatter', entityType: 'gene', idField: 'gene' }],
    validator: {
      id: 'volcano_child_test_validator',
      checks: ['artifact_truth_valid', 'script_sha256', 'input_sha256', 'output_sha256'],
    },
  };
}

function request(fx, overrides = {}) {
  return {
    projectId: 'p_1', conversationId: 'conv_1', workspaceRoot: fx.workspaceRoot,
    intent: fx.intent, sourceRevision: fx.sourceRevision, sourceJob: fx.sourceJob,
    sourceScriptContent: fx.sourceScriptContent, sourceScriptSha256: sha256(fx.sourceScriptContent),
    pluginId: 'volcano-plot', language: 'r',
    scriptPatch: [{ oldText: 'palette <- "red"', newText: 'palette <- "blue"' }],
    createdBy: 'agent', ...overrides,
  };
}

function serviceDependencies(fx, overrides = {}) {
  const descriptors = {
    'volcano-plot': volcanoDescriptor(),
    deseq2: deseqDescriptor(),
    'go-kegg': goDescriptor(),
  };
  return {
    repository: fx.repository,
    adapter: fx.adapter,
    getToolJob: () => fx.sourceJob,
    getResultStudioDescriptor: (toolId) => descriptors[toolId] || null,
    ...overrides,
  };
}

function attachServerIssuedSourceLineage(fx) {
  const upstreamJob = {
    id: 'tj_upstream_deg', project_id: 'p_1', tool_id: 'deseq2', status: 'completed',
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'deg_table', type: 'table', path: fx.sourceInput }],
      executionProvenance: signedExecutionProvenance({
        executionProvenanceVersion: 1, toolJobId: 'tj_upstream_deg', projectId: 'p_1',
        params: { normalized: {} }, inputs: [],
        script: { sha256: sha256(fx.sourceScriptContent) },
        artifacts: [{ id: 'deg_table', filename: 'deg.csv', sha256: fx.sourceInputHash }],
      }),
    },
  };
  fx.repository.createChangeSet({
    changeSetId: 'cs_upstream_deg', projectId: 'p_1', baseCommit: fx.sourceRevision.sourceCommit,
    workingBranchRef: 'refs/heads/biof3/upstream-deg', createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_upstream_deg', to: 'running' });
  fx.repository.transitionChangeSet({
    changeSetId: 'cs_upstream_deg', to: 'preview_ready', candidateCommit: fx.sourceRevision.sourceCommit,
    candidateArtifactRefs: ['rev_upstream_deg'], jobRefs: [upstreamJob.id],
  });
  const upstreamRevision = fx.repository.appendRevision({
    revisionId: 'rev_upstream_deg', projectId: 'p_1', artifactFamilyId: 'upstream_deg_family',
    artifactId: 'deg_table', sourceCommit: fx.sourceRevision.sourceCommit,
    sourceScriptRef: {
      ...fx.sourceRevision.sourceScriptRef,
      artifactId: 'deg_table', rendererId: 'deseq2:deg_table',
    },
    parametersRef: fx.sourceRevision.parametersRef, parametersHash: fx.sourceRevision.parametersHash,
    toolJobId: upstreamJob.id, outputPath: 'inputs/deg/deg.csv', outputHash: fx.sourceInputHash,
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_upstream_deg',
  });
  fx.repository.adoptChangeSet({ changeSetId: 'cs_upstream_deg', candidateCommit: fx.sourceRevision.sourceCommit });
  const lineage = {
    lineageVersion: 1, kind: 'artifact', sourceRevisionId: upstreamRevision.revisionId,
    sourceToolJobId: upstreamJob.id, sourceArtifactId: upstreamRevision.artifactId,
    sourceOutputHash: fx.sourceInputHash, materializationHash: fx.sourceInputHash,
  };
  const provenance = fx.sourceJob.result.executionProvenance;
  fx.sourceJob.result.executionProvenance = signedExecutionProvenance({
    ...provenance,
    executionProvenanceVersion: 1,
    inputs: provenance.inputs.map((input) => ({ ...input, lineage })),
  });
  return { upstreamJob, upstreamRevision, lineage };
}

function revisionFromSource(fx, changeSetId, overrides = {}) {
  return {
    revisionId: overrides.revisionId || `rev_${Math.random().toString(36).slice(2)}`,
    projectId: 'p_1',
    artifactFamilyId: overrides.artifactFamilyId || fx.sourceRevision.artifactFamilyId,
    artifactId: overrides.artifactId || fx.sourceRevision.artifactId,
    parentRevisionIds: overrides.parentRevisionIds || [fx.sourceRevision.revisionId],
    sourceCommit: overrides.sourceCommit || fx.sourceRevision.sourceCommit,
    sourceScriptRef: overrides.sourceScriptRef || {
      ...fx.sourceRevision.sourceScriptRef,
      artifactId: overrides.artifactId || fx.sourceRevision.artifactId,
      rendererId: overrides.rendererId || fx.sourceRevision.sourceScriptRef.rendererId,
    },
    inputArtifactRefs: overrides.inputArtifactRefs || [],
    parametersRef: overrides.parametersRef || fx.sourceRevision.parametersRef,
    parametersHash: overrides.parametersHash || fx.sourceRevision.parametersHash,
    toolJobId: overrides.toolJobId || `tj_${Math.random().toString(36).slice(2)}`,
    outputPath: overrides.outputPath || fx.sourceRevision.outputPath,
    outputHash: overrides.outputHash || fx.sourceRevision.outputHash,
    validationStatus: overrides.validationStatus || 'valid',
    reproducibilityStatus: overrides.reproducibilityStatus || 'available',
    changeSetId,
  };
}

test('RS5 registers a real Job Artifact as an idempotent current baseline', (context) => {
  const fx = fixture(context, 'baseline');
  const output = join(fx.workspaceRoot, 'results/jobs/tj_baseline/output/baseline.png');
  mkdirSync(join(output, '..'), { recursive: true });
  writeFileSync(output, 'BASELINE');
  const outputHash = sha256(readFileSync(output));
  const sourceJob = {
    id: 'tj_baseline', project_id: 'p_1', tool_id: 'volcano-plot', status: 'completed',
    params: { palette: 'red' },
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      tool: { id: 'volcano-plot', language: 'r' },
      artifacts: [{ id: 'baseline_plot', name: 'baseline.png', path: output }],
      executionProvenance: {
        params: { normalized: { palette: 'red' } },
        inputs: [],
        artifacts: [{ id: 'baseline_plot', sha256: outputHash }],
      },
    },
  };
  const first = ensureBaselineArtifactRevision({
    projectId: 'p_1', workspaceRoot: fx.workspaceRoot, sourceJob,
    artifactId: 'baseline_plot', pluginId: 'volcano-plot', language: 'r',
    sourceScriptContent: fx.sourceScriptContent,
    sourceScriptSha256: sha256(fx.sourceScriptContent),
  }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(first.created, true);
  assert.equal(first.revision.isCurrent, true);
  assert.equal(first.revision.toolJobId, 'tj_baseline');
  assert.equal(first.revision.sourceScriptRef.origin, 'project_materialized');
  assert.equal(fx.repository.getChangeSet(first.revision.changeSetId).status, 'adopted');
  assert.equal(
    fx.adapter.revParse(`refs/heads/biof3/current/${first.revision.artifactFamilyId}`),
    first.revision.sourceCommit,
  );
  const baselineCheckpoint = fx.repository.getLatestCheckpoint({ projectId: 'p_1', conversationId: null });
  assert.equal(baselineCheckpoint.changeSetId, first.revision.changeSetId);
  assert.equal(baselineCheckpoint.changeSetStatus, 'adopted');
  assert.equal(baselineCheckpoint.pendingPreview.stage, 'adopted');
  assert.equal(existsSync(join(fx.workspaceRoot, first.revision.sourceScriptRef.relativePath)), false,
    'virtual baseline commit must not write the project work tree');
  const committedScript = fx.adapter.showFile({
    ref: first.revision.sourceCommit,
    filePath: first.revision.sourceScriptRef.relativePath,
  });
  assert.equal(committedScript, fx.sourceScriptContent);

  const second = ensureBaselineArtifactRevision({
    projectId: 'p_1', workspaceRoot: fx.workspaceRoot, sourceJob,
    artifactId: 'baseline_plot', pluginId: 'volcano-plot', language: 'r',
    sourceScriptContent: fx.sourceScriptContent,
    sourceScriptSha256: sha256(fx.sourceScriptContent),
  }, { repository: fx.repository, adapter: fx.adapter });
  assert.equal(second.created, false);
  assert.equal(second.revision.revisionId, first.revision.revisionId);
});

test('P5 baseline registration records every formal output from one Job as one cohort', (context) => {
  const fx = fixture(context, 'baseline-cohort');
  const outputA = join(fx.workspaceRoot, 'results/jobs/tj_cohort/output/plot.png');
  const outputB = join(fx.workspaceRoot, 'results/jobs/tj_cohort/output/classified.csv');
  mkdirSync(join(outputA, '..'), { recursive: true });
  writeFileSync(outputA, 'PLOT');
  writeFileSync(outputB, 'gene,sig\nTP53,Up\n');
  const hashA = sha256(readFileSync(outputA));
  const hashB = sha256(readFileSync(outputB));
  const script = 'print("cohort")\n';
  const scriptHash = sha256(script);
  const sourceJob = {
    id: 'tj_cohort', project_id: 'p_1', tool_id: 'volcano-plot', status: 'completed',
    params: { deg_table: fx.sourceInput },
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [
        { id: 'plot', type: 'plot', path: outputA },
        { id: 'classified', type: 'table', path: outputB },
      ],
      executionProvenance: signedExecutionProvenance({
        executionProvenanceVersion: 1,
        toolJobId: 'tj_cohort', projectId: 'p_1',
        params: { normalized: { deg_table: { inputRef: 'inputs/deg/deg.csv', sha256: fx.sourceInputHash } } },
        inputs: [{ id: 'deg_table', relativePath: 'inputs/deg/deg.csv', sha256: fx.sourceInputHash }],
        script: { sha256: scriptHash },
        artifacts: [{ id: 'plot', sha256: hashA }, { id: 'classified', sha256: hashB }],
      }),
    },
  };
  const descriptor = {
    artifacts: [{ id: 'plot', type: 'plot' }, { id: 'classified', type: 'table' }],
    validator: { id: 'cohort-validator', checks: ['artifact_truth_valid', 'script_sha256', 'input_sha256', 'output_sha256'] },
  };
  const first = ensureBaselineArtifactCohort({
    projectId: 'p_1', workspaceRoot: fx.workspaceRoot, sourceJob, artifactId: 'plot',
    pluginId: 'volcano-plot', language: 'r',
    sourceScriptContent: script, sourceScriptSha256: scriptHash,
  }, {
    repository: fx.repository,
    adapter: fx.adapter,
    gitPathPrefix: '',
    getResultStudioDescriptor: () => descriptor,
  });
  assert.equal(first.created, true);
  assert.equal(first.cohortRevisions.length, 2);
  assert.deepEqual(first.cohortRevisions.map((revision) => revision.artifactId), ['plot', 'classified']);
  assert.equal(new Set(first.cohortRevisions.map((revision) => revision.changeSetId)).size, 1);
  assert.equal(first.cohortRevisions.every((revision) => revision.isCurrent === true), true);
  for (const revision of first.cohortRevisions) {
    assert.equal(
      fx.adapter.revParse(`refs/heads/biof3/current/${revision.artifactFamilyId}`),
      revision.sourceCommit,
    );
  }
  assert.equal(fx.repository.listRevisionsByChangeSet(first.cohortRevisions[0].changeSetId).length, 2);
  const baselineChangeSet = fx.repository.getChangeSet(first.cohortRevisions[0].changeSetId);
  const baselineCheckpoint = fx.repository.getLatestCheckpoint({ projectId: 'p_1', conversationId: null });
  assert.equal(baselineCheckpoint.changeSetId, baselineChangeSet.changeSetId);
  assert.equal(baselineCheckpoint.changeSetStatus, 'adopted');
  assert.equal(baselineCheckpoint.pendingPreview.stage, 'adopted');
  assert.equal(baselineChangeSet.validationSummary.formalArtifactCount, 2);
  assert.deepEqual(baselineChangeSet.validationSummary.validatorIds, ['cohort-validator']);
  const baselineGraph = fx.repository.getWorkflowGraph(baselineChangeSet.validationSummary.workflowGraph.graphId);
  assert.equal(baselineGraph.rootToolJobId, sourceJob.id);
  assert.deepEqual(baselineGraph.nodes.map((node) => node.toolJobId), [sourceJob.id]);
  assert.deepEqual(baselineGraph.edges, []);

  const second = ensureBaselineArtifactCohort({
    projectId: 'p_1', workspaceRoot: fx.workspaceRoot, sourceJob, artifactId: 'classified',
    pluginId: 'volcano-plot', language: 'r',
    sourceScriptContent: script, sourceScriptSha256: scriptHash,
  }, {
    repository: fx.repository,
    adapter: fx.adapter,
    gitPathPrefix: '',
    getResultStudioDescriptor: () => descriptor,
  });
  assert.equal(second.created, false);
  assert.equal(second.cohortRevisions.length, 2);
  assert.equal(fx.repository.listRevisionsByChangeSet(first.cohortRevisions[0].changeSetId).length, 2);
  const qualified = inspectBaselineArtifactCohort({
    projectId: 'p_1', sourceJob, artifactId: 'plot', pluginDescriptor: descriptor,
  }, { repository: fx.repository });
  assert.equal(qualified.qualified, true);
  assert.equal(qualified.revision.revisionId, first.revision.revisionId);
});

test('P6 qualifies a complete persisted candidate Job cohort without relabeling it as a baseline', () => {
  const hashes = { plot: 'a'.repeat(64), table: 'b'.repeat(64) };
  const commit = 'c'.repeat(40);
  const sourceJob = {
    id: 'tj_candidate', project_id: 'p_1', tool_id: 'volcano-plot', status: 'completed',
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'plot' }, { id: 'classified' }],
      executionProvenance: { artifacts: [
        { id: 'plot', sha256: hashes.plot },
        { id: 'classified', sha256: hashes.table },
      ] },
    },
  };
  const revisions = [
    {
      revisionId: 'rev_plot', projectId: 'p_1', artifactFamilyId: 'family_plot', artifactId: 'plot',
      toolJobId: sourceJob.id, outputHash: hashes.plot, validationStatus: 'valid',
      sourceCommit: commit, changeSetId: 'cs_candidate', isCurrent: true,
    },
    {
      revisionId: 'rev_table', projectId: 'p_1', artifactFamilyId: 'family_table', artifactId: 'classified',
      toolJobId: sourceJob.id, outputHash: hashes.table, validationStatus: 'valid',
      sourceCommit: commit, changeSetId: 'cs_candidate', isCurrent: true,
    },
  ];
  const graph = {
    graphId: 'wfg_candidate', projectId: 'p_1', sourceDigest: 'd'.repeat(64), validationStatus: 'valid',
    nodes: [{ toolJobId: sourceJob.id, artifactIds: ['plot', 'classified'] }], edges: [],
  };
  const changeSet = {
    changeSetId: 'cs_candidate', projectId: 'p_1', intentRef: 'intent_candidate', status: 'adopted',
    adoptedAt: '2026-07-30T00:00:00.000Z', candidateCommit: commit,
    candidateArtifactRefs: revisions.map((revision) => revision.revisionId), jobRefs: [sourceJob.id],
    validationSummary: {
      artifactTruthStatus: 'valid', formalArtifactCount: 2, validatorIds: ['candidate-validator'],
      workflowGraph: { graphId: graph.graphId, sourceDigest: graph.sourceDigest },
    },
  };
  const repository = {
    findRevisionByJobArtifact: ({ artifactId }) => revisions.find((revision) => revision.artifactId === artifactId) || null,
    getChangeSet: () => changeSet,
    listRevisionsByChangeSet: () => revisions,
    getWorkflowGraph: () => graph,
  };
  const input = {
    projectId: 'p_1', sourceJob, artifactId: 'plot',
    pluginDescriptor: {
      artifacts: [{ id: 'plot' }, { id: 'classified' }], validator: { id: 'candidate-validator' },
    },
  };
  const qualified = inspectPersistedArtifactCohort(input, {
    repository,
    verifyWorkflowGraphIntegrity: () => ({ ok: true }),
  });
  assert.equal(qualified.qualified, true);
  assert.equal(qualified.revision.revisionId, 'rev_plot');
  assert.equal(qualified.cohortRevisions.length, 2);

  changeSet.candidateArtifactRefs = ['rev_plot'];
  assert.equal(inspectPersistedArtifactCohort(input, {
    repository,
    verifyWorkflowGraphIntegrity: () => ({ ok: true }),
  }).reason, 'persisted_cohort_incomplete');
});

test('P6 baseline registration repairs an adopted legacy cohort without restorable validator proof', (context) => {
  const fx = fixture(context, 'baseline-proof-repair');
  const output = join(fx.workspaceRoot, 'results/jobs/tj_proof_repair/output/plot.png');
  mkdirSync(join(output, '..'), { recursive: true });
  writeFileSync(output, 'PLOT');
  const outputHash = sha256(readFileSync(output));
  const script = 'print("proof repair")\n';
  const scriptHash = sha256(script);
  const sourceJob = {
    id: 'tj_proof_repair', project_id: 'p_1', tool_id: 'volcano-plot', status: 'completed', params: {},
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'plot', type: 'plot', path: output }],
      executionProvenance: signedExecutionProvenance({
        executionProvenanceVersion: 1, toolJobId: 'tj_proof_repair', projectId: 'p_1',
        params: { normalized: {} }, inputs: [], script: { sha256: scriptHash },
        artifacts: [{ id: 'plot', sha256: outputHash }],
      }),
    },
  };
  const descriptor = {
    artifacts: [{ id: 'plot', type: 'plot' }],
    validator: { id: 'proof-validator', checks: ['artifact_truth_valid', 'script_sha256', 'output_sha256'] },
  };
  const input = {
    projectId: 'p_1', workspaceRoot: fx.workspaceRoot, sourceJob, artifactId: 'plot',
    pluginId: 'volcano-plot', language: 'r', sourceScriptContent: script, sourceScriptSha256: scriptHash,
  };
  const dependencies = {
    repository: fx.repository,
    adapter: fx.adapter,
    getResultStudioDescriptor: () => descriptor,
  };
  const original = ensureBaselineArtifactCohort(input, dependencies);
  const originalChangeSet = fx.repository.getChangeSet(original.revision.changeSetId);
  fx.db.prepare('UPDATE scientific_change_sets SET validation_summary_json = ? WHERE change_set_id = ?')
    .run(JSON.stringify({
      ...originalChangeSet.validationSummary,
      formalArtifactCount: undefined,
      validatorIds: undefined,
    }), originalChangeSet.changeSetId);

  const unqualified = inspectBaselineArtifactCohort({
    projectId: 'p_1', sourceJob, artifactId: 'plot', pluginDescriptor: descriptor,
  }, { repository: fx.repository });
  assert.equal(unqualified.qualified, false);
  assert.equal(unqualified.reason, 'baseline_cohort_unqualified');

  const repaired = ensureBaselineArtifactCohort(input, dependencies);
  const repairedChangeSet = fx.repository.getChangeSet(repaired.revision.changeSetId);
  assert.equal(repaired.created, true);
  assert.notEqual(repaired.revision.changeSetId, original.revision.changeSetId);
  assert.deepEqual(repaired.revision.parentRevisionIds, [original.revision.revisionId]);
  assert.equal(repairedChangeSet.validationSummary.formalArtifactCount, 1);
  assert.deepEqual(repairedChangeSet.validationSummary.validatorIds, ['proof-validator']);
  assert.equal(repairedChangeSet.status, 'adopted');
  const changedValidator = inspectBaselineArtifactCohort({
    projectId: 'p_1', sourceJob, artifactId: 'plot',
    pluginDescriptor: { ...descriptor, validator: { ...descriptor.validator, id: 'proof-validator-v2' } },
  }, { repository: fx.repository });
  assert.equal(changedValidator.qualified, false);
  assert.equal(changedValidator.reason, 'baseline_cohort_unqualified');
});

test('P6 baseline cohort remains source-addressable for a project nested in an existing repository', (context) => {
  const fx = fixture(context, 'git-prefix-baseline-');
  const output = join(fx.workspaceRoot, 'results/jobs/tj_nested_baseline/output/plot.png');
  mkdirSync(join(output, '..'), { recursive: true });
  writeFileSync(output, 'NESTED-PLOT');
  const outputHash = sha256(readFileSync(output));
  const script = 'print("nested baseline")\n';
  const scriptHash = sha256(script);
  const sourceJob = {
    id: 'tj_nested_baseline', project_id: 'p_1', tool_id: 'volcano-plot', status: 'completed', params: {},
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'plot', type: 'plot', path: output }],
      executionProvenance: signedExecutionProvenance({
        executionProvenanceVersion: 1, toolJobId: 'tj_nested_baseline', projectId: 'p_1',
        params: { normalized: {} }, inputs: [], script: { sha256: scriptHash },
        artifacts: [{ id: 'plot', sha256: outputHash }],
      }),
    },
  };
  const descriptor = {
    artifacts: [{ id: 'plot', type: 'plot' }],
    validator: { id: 'nested-validator', checks: ['artifact_truth_valid', 'script_sha256', 'output_sha256'] },
  };
  const prefix = 'projects/p_1';
  const baseline = ensureBaselineArtifactCohort({
    projectId: 'p_1', workspaceRoot: fx.workspaceRoot, sourceJob, artifactId: 'plot',
    pluginId: 'volcano-plot', language: 'r', sourceScriptContent: script, sourceScriptSha256: scriptHash,
  }, {
    repository: fx.repository,
    adapter: fx.adapter,
    gitPathPrefix: prefix,
    getResultStudioDescriptor: () => descriptor,
  });
  const revision = baseline.revision;
  const changeSet = fx.repository.getChangeSet(revision.changeSetId);
  assert.equal(revision.sourceScriptRef.relativePath.startsWith(`${prefix}/`), false,
    'durable source refs remain project-relative; Git readers add the repository prefix once');
  assert.equal(revision.parametersRef.startsWith(`${prefix}/`), false);
  assert.equal(changeSet.changedPaths.every((entry) => !entry.relativePath.startsWith(`${prefix}/`)), true);
  assert.equal(fx.adapter.showFile({
    ref: revision.sourceCommit,
    filePath: `${prefix}/${revision.sourceScriptRef.relativePath}`,
  }), script);
  const manifestPath = changeSet.changedPaths.find((entry) => /materialization\.json$/.test(entry.relativePath)).relativePath;
  const manifest = JSON.parse(fx.adapter.showFile({
    ref: revision.sourceCommit,
    filePath: `${prefix}/${manifestPath}`,
  }));
  assert.equal(manifest.scriptRelativePath, revision.sourceScriptRef.relativePath);
  assert.equal(manifest.parametersRelativePath, revision.parametersRef);
  const projected = projectRevisionSource({ projectId: 'p_1', revision }, {
    repository: fx.repository,
    adapter: fx.adapter,
    gitPathPrefix: prefix,
    workspaceRoot: fx.workspaceRoot,
    getToolJob: () => sourceJob,
  });
  assert.equal(projected.content, script);
  assert.deepEqual(projected.parameters.values, {});

  const repaired = ensureBaselineArtifactCohort({
    projectId: 'p_1', workspaceRoot: fx.workspaceRoot, sourceJob, artifactId: 'plot',
    pluginId: 'volcano-plot', language: 'r', sourceScriptContent: script, sourceScriptSha256: scriptHash,
  }, {
    repository: fx.repository,
    adapter: fx.adapter,
    gitPathPrefix: prefix,
    getResultStudioDescriptor: () => ({
      ...descriptor,
      validator: { ...descriptor.validator, id: 'nested-validator-v2' },
    }),
  });
  assert.deepEqual(repaired.revision.parentRevisionIds, [revision.revisionId]);
  const restored = restoreArtifactRevision({
    projectId: 'p_1', workspaceRoot: fx.workspaceRoot, revisionId: revision.revisionId, createdBy: 'user',
  }, {
    repository: fx.repository,
    adapter: fx.adapter,
    gitPathPrefix: prefix,
    getToolJob: () => sourceJob,
  });
  assert.equal(restored.restored, true);
  assert.deepEqual(restored.revision.parentRevisionIds, [repaired.revision.revisionId]);
  assert.equal(projectRevisionSource({ projectId: 'p_1', revision: restored.revision }, {
    repository: fx.repository,
    adapter: fx.adapter,
    gitPathPrefix: prefix,
    workspaceRoot: fx.workspaceRoot,
    getToolJob: () => sourceJob,
  }).content, script);
});

test('P5 baseline registration projects a downstream Job with its authoritative ancestor lineage', (context) => {
  const fx = fixture(context, 'baseline-lineage');
  const parentOutput = join(fx.workspaceRoot, 'results/jobs/tj_parent/output/deg.csv');
  const childOutput = join(fx.workspaceRoot, 'results/jobs/tj_child/output/go.csv');
  mkdirSync(join(parentOutput, '..'), { recursive: true });
  mkdirSync(join(childOutput, '..'), { recursive: true });
  writeFileSync(parentOutput, 'gene,log2FoldChange,padj\nTP53,2,0.01\n');
  writeFileSync(childOutput, 'ID,Description,p.adjust\nGO:1,response,0.01\n');
  const parentHash = sha256(readFileSync(parentOutput));
  const childHash = sha256(readFileSync(childOutput));
  const parentScript = 'print("parent")\n';
  const childScript = 'print("child")\n';
  const parentJob = {
    id: 'tj_parent', project_id: 'p_1', tool_id: 'deseq2', status: 'completed', params: {},
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'deg_table', type: 'table', path: parentOutput }],
      executionProvenance: signedExecutionProvenance({
        executionProvenanceVersion: 1, toolJobId: 'tj_parent', projectId: 'p_1',
        params: { normalized: {} }, inputs: [], script: { sha256: sha256(parentScript) },
        artifacts: [{ id: 'deg_table', filename: 'deg.csv', sha256: parentHash }],
      }),
    },
  };
  const parent = ensureBaselineArtifactCohort({
    projectId: 'p_1', workspaceRoot: fx.workspaceRoot, sourceJob: parentJob,
    artifactId: 'deg_table', pluginId: 'deseq2', language: 'r',
    sourceScriptContent: parentScript, sourceScriptSha256: sha256(parentScript),
  }, {
    repository: fx.repository,
    adapter: fx.adapter,
    getResultStudioDescriptor: () => ({
      artifacts: [{ id: 'deg_table', type: 'table' }],
      validator: { id: 'parent-validator', checks: ['artifact_truth_valid', 'script_sha256', 'output_sha256'] },
    }),
  });
  const parentRevision = parent.revision;
  const childJob = {
    id: 'tj_child', project_id: 'p_1', tool_id: 'go-kegg', status: 'completed',
    params: { deg_table: parentOutput },
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'go_bp_results', type: 'table', path: childOutput }],
      executionProvenance: signedExecutionProvenance({
        executionProvenanceVersion: 1, toolJobId: 'tj_child', projectId: 'p_1',
        params: { normalized: { deg_table: { inputRef: 'inputs/deg_table/deg.csv', sha256: parentHash } } },
        inputs: [{
          id: 'deg_table', role: 'deg_table', relativePath: 'inputs/deg_table/deg.csv',
          sha256: parentHash, sourceArtifactRef: null,
          lineage: {
            lineageVersion: 1, kind: 'artifact', sourceRevisionId: parentRevision.revisionId,
            sourceToolJobId: parentJob.id, sourceArtifactId: parentRevision.artifactId,
            sourceOutputHash: parentHash, materializationHash: parentHash,
          },
        }],
        script: { sha256: sha256(childScript) },
        artifacts: [{ id: 'go_bp_results', filename: 'go.csv', sha256: childHash }],
      }),
    },
  };
  const child = ensureBaselineArtifactCohort({
    projectId: 'p_1', workspaceRoot: fx.workspaceRoot, sourceJob: childJob,
    artifactId: 'go_bp_results', pluginId: 'go-kegg', language: 'r',
    sourceScriptContent: childScript, sourceScriptSha256: sha256(childScript),
  }, {
    repository: fx.repository,
    adapter: fx.adapter,
    getResultStudioDescriptor: () => ({
      artifacts: [{ id: 'go_bp_results', type: 'table' }],
      validator: { id: 'child-validator', checks: ['artifact_truth_valid', 'script_sha256', 'input_sha256', 'output_sha256'] },
    }),
    resolveWorkflowJobs: () => [childJob, parentJob],
  });
  const childChangeSet = fx.repository.getChangeSet(child.revision.changeSetId);
  const graph = fx.repository.getWorkflowGraph(childChangeSet.validationSummary.workflowGraph.graphId);
  assert.equal(graph.rootToolJobId, parentJob.id);
  assert.deepEqual(graph.nodes.map((node) => node.toolJobId), [parentJob.id, childJob.id]);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].sourceRevisionId, parentRevision.revisionId);

  const reused = ensureBaselineArtifactCohort({
    projectId: 'p_1', workspaceRoot: fx.workspaceRoot, sourceJob: childJob,
    artifactId: 'go_bp_results', pluginId: 'go-kegg', language: 'r',
    sourceScriptContent: childScript, sourceScriptSha256: sha256(childScript),
  }, {
    repository: fx.repository,
    adapter: fx.adapter,
    getResultStudioDescriptor: () => ({
      artifacts: [{ id: 'go_bp_results', type: 'table' }],
      validator: { id: 'child-validator', checks: ['artifact_truth_valid', 'script_sha256', 'input_sha256', 'output_sha256'] },
    }),
    resolveWorkflowJobs: () => [childJob, parentJob],
  });
  assert.equal(reused.created, false);
  assert.equal(reused.revision.revisionId, child.revision.revisionId);
});

test('P5 baseline registration never stitches formal outputs from split legacy ChangeSets', (context) => {
  const fx = fixture(context, 'baseline-split-cohort');
  const outputA = join(fx.workspaceRoot, 'results/jobs/tj_split/output/plot.png');
  const outputB = join(fx.workspaceRoot, 'results/jobs/tj_split/output/classified.csv');
  mkdirSync(join(outputA, '..'), { recursive: true });
  writeFileSync(outputA, 'PLOT');
  writeFileSync(outputB, 'gene,sig\nTP53,Up\n');
  const hashA = sha256(readFileSync(outputA));
  const hashB = sha256(readFileSync(outputB));
  const script = 'print("split cohort")\n';
  const scriptHash = sha256(script);
  const sourceJob = {
    id: 'tj_split', project_id: 'p_1', tool_id: 'volcano-plot', status: 'completed',
    params: { deg_table: fx.sourceInput },
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [
        { id: 'plot', type: 'plot', path: outputA },
        { id: 'classified', type: 'table', path: outputB },
      ],
      executionProvenance: signedExecutionProvenance({
        executionProvenanceVersion: 1,
        toolJobId: 'tj_split', projectId: 'p_1',
        params: { normalized: { deg_table: { inputRef: 'inputs/deg/deg.csv', sha256: fx.sourceInputHash } } },
        inputs: [{ id: 'deg_table', relativePath: 'inputs/deg/deg.csv', sha256: fx.sourceInputHash }],
        script: { sha256: scriptHash },
        artifacts: [{ id: 'plot', sha256: hashA }, { id: 'classified', sha256: hashB }],
      }),
    },
  };
  const baselineInput = {
    projectId: 'p_1', workspaceRoot: fx.workspaceRoot, sourceJob,
    pluginId: 'volcano-plot', language: 'r', sourceScriptContent: script,
    sourceScriptSha256: scriptHash,
  };
  const legacyPlot = ensureBaselineArtifactRevision(
    { ...baselineInput, artifactId: 'plot' },
    { repository: fx.repository, adapter: fx.adapter }
  ).revision;
  const legacyTable = ensureBaselineArtifactRevision(
    { ...baselineInput, artifactId: 'classified' },
    { repository: fx.repository, adapter: fx.adapter }
  ).revision;
  assert.notEqual(legacyPlot.changeSetId, legacyTable.changeSetId);

  const descriptor = {
    artifacts: [{ id: 'plot', type: 'plot' }, { id: 'classified', type: 'table' }],
    validator: { id: 'cohort-validator', checks: ['artifact_truth_valid', 'script_sha256', 'input_sha256', 'output_sha256'] },
  };
  const splitQualification = inspectBaselineArtifactCohort({
    projectId: 'p_1', sourceJob, artifactId: 'plot', pluginDescriptor: descriptor,
  }, { repository: fx.repository });
  assert.equal(splitQualification.qualified, false);
  assert.equal(splitQualification.reason, 'baseline_cohort_split');
  const rebuilt = ensureBaselineArtifactCohort(
    { ...baselineInput, artifactId: 'plot' },
    {
      repository: fx.repository,
      adapter: fx.adapter,
      getResultStudioDescriptor: () => descriptor,
    }
  );
  assert.equal(rebuilt.created, true);
  assert.equal(rebuilt.cohortRevisions.length, 2);
  assert.equal(new Set(rebuilt.cohortRevisions.map((revision) => revision.changeSetId)).size, 1);
  assert.notEqual(rebuilt.revision.changeSetId, legacyPlot.changeSetId);
  assert.notEqual(rebuilt.revision.changeSetId, legacyTable.changeSetId);
  assert.deepEqual(
    rebuilt.cohortRevisions.map((revision) => revision.parentRevisionIds[0]).sort(),
    [legacyPlot.revisionId, legacyTable.revisionId].sort()
  );
  const rebuiltChangeSet = fx.repository.getChangeSet(rebuilt.revision.changeSetId);
  assert.equal(rebuiltChangeSet.status, 'adopted');
  assert.match(rebuiltChangeSet.intentRef, /^baseline:/);
  assert.deepEqual(
    rebuiltChangeSet.candidateArtifactRefs.slice().sort(),
    rebuilt.cohortRevisions.map((revision) => revision.revisionId).sort()
  );

  const reused = ensureBaselineArtifactCohort(
    { ...baselineInput, artifactId: 'classified' },
    {
      repository: fx.repository,
      adapter: fx.adapter,
      getResultStudioDescriptor: () => descriptor,
    }
  );
  assert.equal(reused.created, false);
  assert.deepEqual(
    reused.cohortRevisions.map((revision) => revision.revisionId),
    rebuilt.cohortRevisions.map((revision) => revision.revisionId)
  );
});

test('P5 historical branch resolves every formal parent from the selected ChangeSet cohort', (context) => {
  const fx = fixture(context, 'historical-formal-cohort-');
  const createCohort = ({ changeSetId, plotRevisionId, tableRevisionId, parents = {} }) => {
    fx.repository.createChangeSet({
      changeSetId, projectId: 'p_1', baseCommit: fx.sourceRevision.sourceCommit,
      workingBranchRef: `refs/heads/biof3/changeset/${changeSetId}`, createdBy: 'agent',
    });
    fx.repository.transitionChangeSet({ changeSetId, to: 'running' });
    const plot = revisionFromSource(fx, changeSetId, {
      revisionId: plotRevisionId,
      artifactFamilyId: 'historical_plot_family', artifactId: 'plot',
      rendererId: 'volcano-plot:plot', toolJobId: 'tj_historical_shared',
      outputPath: 'results/jobs/tj_historical_shared/plot.png', outputHash: 'a'.repeat(64),
      parentRevisionIds: parents.plot ? [parents.plot] : [],
    });
    const table = revisionFromSource(fx, changeSetId, {
      revisionId: tableRevisionId,
      artifactFamilyId: 'historical_table_family', artifactId: 'table',
      rendererId: 'volcano-plot:table', toolJobId: 'tj_historical_shared',
      outputPath: 'results/jobs/tj_historical_shared/table.csv', outputHash: 'b'.repeat(64),
      parentRevisionIds: parents.table ? [parents.table] : [],
    });
    fx.repository.appendRevisionBatch({
      revisions: [plot, table],
      transition: {
        changeSetId, to: 'preview_ready', candidateCommit: fx.sourceRevision.sourceCommit,
        candidateArtifactRefs: [plot.revisionId, table.revisionId], jobRefs: ['tj_historical_shared'],
      },
    });
    fx.repository.adoptChangeSet({ changeSetId, candidateCommit: fx.sourceRevision.sourceCommit });
    return { plot: fx.repository.getRevision(plot.revisionId), table: fx.repository.getRevision(table.revisionId) };
  };

  const historical = createCohort({
    changeSetId: 'cs_historical_original',
    plotRevisionId: 'rev_historical_plot',
    tableRevisionId: 'rev_historical_table',
  });
  const restored = createCohort({
    changeSetId: 'cs_historical_restore',
    plotRevisionId: 'rev_restored_plot',
    tableRevisionId: 'rev_restored_table',
    parents: { plot: historical.plot.revisionId, table: historical.table.revisionId },
  });

  const resolvedSibling = changeSetTest.resolveExactFormalSourceRevision({
    repository: fx.repository,
    projectId: 'p_1',
    selectedRevision: historical.plot,
    sourceToolJobId: 'tj_historical_shared',
    artifactId: 'table',
  });
  assert.equal(resolvedSibling.revisionId, historical.table.revisionId);
  assert.notEqual(resolvedSibling.revisionId, restored.table.revisionId);
});

test('RS5 exact script patches reject missing and ambiguous matches', () => {
  assert.equal(applyExactScriptPatch('x=1\n', [{ oldText: 'x=1', newText: 'x=2' }]), 'x=2\n');
  assert.throws(() => applyExactScriptPatch('x=1\nx=1\n', [{ oldText: 'x=1', newText: 'x=2' }]),
    (error) => error instanceof ResultChangeSetError && error.code === 'script_patch_ambiguous');
  assert.throws(() => applyExactScriptPatch('x=1\n', [{ oldText: 'y=1', newText: 'y=2' }]),
    (error) => error.code === 'script_patch_not_found');
});

test('RS5 materialization is private, immutable, and refuses input rebinding', (context) => {
  const fx = fixture(context, 'materialize-');
  const materialized = materializeResultEdit({
    workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_mat', revisionId: 'rev_mat',
    artifactFamilyId: 'volcano_family', artifactId: 'volcano_plot', pluginId: 'volcano-plot',
    language: 'r', sourceScriptContent: fx.sourceScriptContent,
    expectedSourceScriptSha256: sha256(fx.sourceScriptContent),
    normalizedSourceParams: fx.sourceJob.result.executionProvenance.params.normalized,
    proposedParameterPatch: { palette: 'blue' }, scriptPatch: [], intentId: 'rei_mat',
  });
  assert.equal(existsSync(materialized.executableScriptPath), true);
  assert.equal(existsSync(join(fx.workspaceRoot, materialized.scriptRelativePath)), false);
  assert.equal(readFileSync(fx.sourceOutput, 'utf8'), 'SOURCE-ARTIFACT');
  assert.throws(() => materializeResultEdit({
    workspaceRoot: fx.workspaceRoot, changeSetId: 'cs_bad_input', revisionId: 'rev_bad_input',
    artifactFamilyId: 'volcano_family', artifactId: 'volcano_plot', pluginId: 'volcano-plot',
    sourceScriptContent: fx.sourceScriptContent,
    normalizedSourceParams: fx.sourceJob.result.executionProvenance.params.normalized,
    proposedParameterPatch: { deg_table: 'other.csv' },
  }), (error) => error.code === 'artifact_input_read_only');
});

test('P6 private materialization anchors a symlinked workspace but rejects private directory links and files', (context) => {
  const container = mkdtempSync(join(tmpdir(), 'biof3-private-materialize-'));
  context.after(() => rmSync(container, { recursive: true, force: true }));
  const realWorkspace = join(container, 'workspace-real');
  const workspaceLink = join(container, 'workspace-link');
  mkdirSync(realWorkspace);
  symlinkSync(realWorkspace, workspaceLink, 'dir');
  const safe = materializeResultEdit({
    workspaceRoot: workspaceLink,
    changeSetId: 'cs_symlinked_workspace',
    revisionId: 'rev_symlinked_workspace',
    artifactFamilyId: 'family',
    artifactId: 'table',
    pluginId: 'fixture',
    sourceScriptContent: 'print(1)\n',
    normalizedSourceParams: {},
  });
  assert.equal(
    realpathSync(safe.privateRoot),
    join(realpathSync(realWorkspace), '.biof3', 'revision', 'cs_symlinked_workspace'),
  );

  const attackedWorkspace = join(container, 'workspace-attacked');
  const outside = join(container, 'outside');
  mkdirSync(attackedWorkspace);
  mkdirSync(outside);
  symlinkSync(outside, join(attackedWorkspace, '.biof3'), 'dir');
  assert.throws(
    () => materializeResultEdit({
      workspaceRoot: attackedWorkspace,
      changeSetId: 'cs_escape',
      revisionId: 'rev_escape',
      artifactFamilyId: 'family',
      artifactId: 'table',
      pluginId: 'fixture',
      sourceScriptContent: 'print(2)\n',
      normalizedSourceParams: {},
    }),
    (error) => error instanceof ResultChangeSetError && error.code === 'private_path_symlink',
  );
  assert.equal(existsSync(join(outside, 'revision')), false);

  unlinkSync(join(attackedWorkspace, '.biof3'));
  writeFileSync(join(attackedWorkspace, '.biof3'), 'not a directory');
  assert.throws(
    () => materializeResultEdit({
      workspaceRoot: attackedWorkspace,
      changeSetId: 'cs_file',
      revisionId: 'rev_file',
      artifactFamilyId: 'family',
      artifactId: 'table',
      pluginId: 'fixture',
      sourceScriptContent: 'print(3)\n',
      normalizedSourceParams: {},
    }),
    (error) => error instanceof ResultChangeSetError && error.code === 'private_path_not_directory',
  );
});

test('RS5 success creates commit, Job-backed Revision and preview without adopting it', async (context) => {
  const fx = fixture(context, 'success-');
  const events = [];
  const result = await createResultChangeSet(request(fx), serviceDependencies(fx, {
    executeJob: successfulExecutor(fx),
    onProgress: (event) => events.push(event),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.changeSet.status, 'preview_ready');
  assert.equal(result.changeSet.validationSummary.intentSummary, 'use blue palette');
  assert.equal(result.changeSet.validationSummary.impactLevel, 'presentation_rerender');
  assert.equal(result.changeSet.validationSummary.requiresJob, true);
  assert.equal(result.changeSet.validationSummary.affectedNodeCount, 1);
  const reopenedProjection = createResultStudioRepository(fx.db, { ensureSchema: false })
    .getChangeSet(result.changeSet.changeSetId);
  assert.deepEqual(reopenedProjection.validationSummary, result.changeSet.validationSummary);
  assert.equal(result.adopted, false);
  assert.equal(result.revision.parentRevisionIds[0], 'rev_source');
  assert.equal(result.revision.toolJobId, 'tj_candidate_CANDIDATE');
  assert.equal(result.revision.sourceScriptRef.artifactId, 'volcano_plot');
  assert.equal(result.revision.sourceScriptRef.origin, 'project_materialized');
  assert.equal(result.revision.reproducibilityStatus, 'available');
  const candidateGraphRef = result.changeSet.validationSummary.workflowGraph;
  const candidateGraph = fx.repository.getWorkflowGraph(candidateGraphRef.graphId);
  assert.equal(candidateGraph.sourceDigest, candidateGraphRef.sourceDigest);
  assert.deepEqual(candidateGraph.nodes.map((node) => node.toolJobId), [result.revision.toolJobId]);
  assert.deepEqual(candidateGraph.edges, []);
  assert.equal(fx.adapter.showFile({ ref: result.candidateCommit, filePath: result.materialization.scriptRelativePath }).includes('blue'), true);
  assert.equal(existsSync(join(fx.workspaceRoot, result.materialization.scriptRelativePath)), false);
  assert.equal(readFileSync(fx.sourceOutput, 'utf8'), 'SOURCE-ARTIFACT');
  assert.equal(sha256(readFileSync(fx.sourceOutput)), fx.sourceOutputHash);
  assert.equal(fx.repository.getCurrentRevision('volcano_family').revisionId, 'rev_source');
  assert.deepEqual(events.map((event) => event.sequence), events.map((_, index) => index + 1));
  assert.equal(events.at(-1).stage, 'preview');
  const checkpoint = fx.repository.getLatestCheckpoint({ projectId: 'p_1', conversationId: 'conv_1' });
  assert.equal(checkpoint.changeSetId, result.changeSet.changeSetId);
  assert.equal(checkpoint.changeSetStatus, 'preview_ready');
  assert.equal(checkpoint.pendingPreview.stage, 'preview_ready');
  assert.deepEqual(checkpoint.pendingPreview.revisionIds, [result.revision.revisionId]);
});

test('P6 caller-supplied resource estimates cannot influence the trusted preview guard', async (context) => {
  const fx = fixture(context, 'resource-estimate-forgery-');
  const result = await createResultChangeSet(request(fx, {
    previewResourceEstimate: { memoryBytes: 2 ** 50, diskBytes: 2 ** 50 },
  }), serviceDependencies(fx, {
    executeJob: successfulExecutor(fx, 'CALLER_ESTIMATE_IGNORED'),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.previewBudget.resourceEstimate.source, 'server_job_descriptor_input_truth');
  assert.ok(result.previewBudget.estimatedMemoryBytes < 2 ** 50);
  assert.ok(result.previewBudget.estimatedDiskBytes < 2 ** 50);
});

test('P6 unknown critical resource facts fail closed before any ChangeSet or Job write', async (context) => {
  const fx = fixture(context, 'resource-facts-unknown-');
  const before = fx.repository.listChangeSets({ projectId: 'p_1', limit: 500 }).map((entry) => entry.changeSetId);
  let executed = false;
  await assert.rejects(() => createResultChangeSet(request(fx), serviceDependencies(fx, {
    createRuntimeResourceSnapshot: () => ({
      state: 'unavailable',
      memory: { availableBytes: null },
      disk: { availableBytes: null },
    }),
    executeJob: async () => { executed = true; return null; },
  })), (error) => error.code === 'preview_resource_budget_blocked'
    && error.detail?.reasons?.includes('memory_measurement_unavailable')
    && error.detail?.reasons?.includes('disk_measurement_unavailable'));
  assert.equal(executed, false);
  assert.deepEqual(
    fx.repository.listChangeSets({ projectId: 'p_1', limit: 500 }).map((entry) => entry.changeSetId),
    before,
  );
});

test('P6 saturated atomic preview slots reject without a partial ChangeSet or checkpoint', async (context) => {
  const fx = fixture(context, 'resource-slot-saturated-');
  for (const changeSetId of ['cs_holder_one', 'cs_holder_two']) {
    fx.repository.createChangeSet({
      changeSetId,
      projectId: 'p_1',
      baseCommit: fx.sourceRevision.sourceCommit,
      workingBranchRef: `refs/heads/biof3/changeset/${changeSetId}`,
      createdBy: 'agent',
    });
    fx.repository.transitionChangeSet({ changeSetId, to: 'running' });
  }
  const changeSetCount = fx.repository.listChangeSets({ projectId: 'p_1', limit: 500 }).length;
  const checkpointCount = fx.db.prepare('SELECT COUNT(*) AS count FROM workspace_revision_checkpoints').get().count;
  let executed = false;
  await assert.rejects(() => createResultChangeSet(request(fx, {
    changeSetId: 'cs_atomic_slot_rejected',
  }), serviceDependencies(fx, {
    executeJob: async () => { executed = true; return null; },
  })), (error) => error.code === 'preview_resource_queued'
    && error.detail?.reasons?.includes('preview_concurrency_saturated')
    && error.detail?.activePreviewJobs === 2);
  assert.equal(executed, false);
  assert.equal(fx.repository.getChangeSet('cs_atomic_slot_rejected'), null);
  assert.equal(fx.repository.listChangeSets({ projectId: 'p_1', limit: 500 }).length, changeSetCount);
  assert.equal(fx.db.prepare('SELECT COUNT(*) AS count FROM workspace_revision_checkpoints').get().count, checkpointCount);
});

test('P6 preview checkpoint failure rolls back the complete candidate cohort and preview transition', async (context) => {
  const fx = fixture(context, 'preview-checkpoint-rollback-');
  const revisionCountBefore = fx.repository.listProjectRevisions('p_1').length;
  const repository = {
    ...fx.repository,
    saveCheckpoint(input) {
      if (input?.pendingPreview?.stage === 'preview_ready') {
        throw new Error('injected_preview_checkpoint_failure');
      }
      return fx.repository.saveCheckpoint(input);
    },
  };

  await assert.rejects(
    createResultChangeSet(request(fx), serviceDependencies(fx, {
      repository,
      executeJob: successfulExecutor(fx),
    })),
    /injected_preview_checkpoint_failure/,
  );

  const attempted = fx.repository.listChangeSets({ projectId: 'p_1', status: 'validation_failed', limit: 10 })
    .find((changeSet) => changeSet.intentRef === fx.intent.intentId);
  assert.ok(attempted, 'checkpoint failure closes the attempt without exposing a partial preview');
  assert.equal(fx.repository.listRevisionsByChangeSet(attempted.changeSetId).length, 0);
  assert.equal(fx.repository.listProjectRevisions('p_1').length, revisionCountBefore);
  assert.equal(fx.db.prepare('SELECT COUNT(*) AS count FROM result_workflow_graphs WHERE project_id=?')
    .get('p_1').count, 0);
  const checkpoint = fx.repository.getLatestCheckpoint({ projectId: 'p_1', conversationId: 'conv_1' });
  assert.equal(checkpoint.changeSetId, attempted.changeSetId);
  assert.equal(checkpoint.changeSetStatus, 'validation_failed');
  assert.equal(checkpoint.pendingPreview.stage, 'failed');
  assert.equal(checkpoint.pendingPreview.recovery, 'result_edit_failed');
});

test('P6 primary candidate does not infer input lineage from hashes or sourceArtifactRef', async (context) => {
  const fx = fixture(context, 'primary-no-lineage-inference-');
  const baseExecutor = successfulExecutor(fx, 'NO_INFERRED_LINEAGE');
  const result = await createResultChangeSet(request(fx), serviceDependencies(fx, {
    executeJob: async (execution) => {
      assert.equal(execution.resultStudioInputLineage, null);
      return baseExecutor(execution);
    },
  }));
  assert.equal(result.changeSet.status, 'preview_ready');
});

test('P6 primary candidate inherits exact server-issued input lineage and preserves its DAG parent', async (context) => {
  const fx = fixture(context, 'primary-inherited-lineage-');
  const { upstreamJob, lineage } = attachServerIssuedSourceLineage(fx);
  const baseExecutor = successfulExecutor(fx, 'INHERITED_LINEAGE');
  const result = await createResultChangeSet(request(fx), serviceDependencies(fx, {
    getToolJob: (toolJobId) => toolJobId === upstreamJob.id ? upstreamJob : fx.sourceJob,
    executeJob: async (execution) => {
      assert.deepEqual(execution.resultStudioInputLineage, { deg_table: lineage });
      const candidate = await baseExecutor(execution);
      const provenance = candidate.job.result.executionProvenance;
      candidate.job.result.executionProvenance = signedExecutionProvenance({
        ...provenance,
        inputs: provenance.inputs.map((input) => ({
          ...input,
          lineage: execution.resultStudioInputLineage[input.id],
        })),
      });
      return candidate;
    },
  }));
  const graph = fx.repository.getWorkflowGraph(result.changeSet.validationSummary.workflowGraph.graphId);
  assert.deepEqual(graph.nodes.map((node) => node.toolJobId), [upstreamJob.id, result.toolJobId]);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].sourceToolJobId, upstreamJob.id);
  assert.equal(graph.edges[0].toNodeId, `job:${result.toolJobId}`);
});

test('P6 primary candidate rejects input lineage drift after execution', async (context) => {
  const fx = fixture(context, 'primary-lineage-drift-');
  const { upstreamJob } = attachServerIssuedSourceLineage(fx);
  const baseExecutor = successfulExecutor(fx, 'DRIFTED_LINEAGE');
  await assert.rejects(() => createResultChangeSet(request(fx), serviceDependencies(fx, {
    getToolJob: (toolJobId) => toolJobId === upstreamJob.id ? upstreamJob : fx.sourceJob,
    executeJob: async (execution) => {
      const candidate = await baseExecutor(execution);
      const provenance = candidate.job.result.executionProvenance;
      candidate.job.result.executionProvenance = signedExecutionProvenance({
        ...provenance,
        inputs: provenance.inputs.map((input) => ({
          ...input,
          lineage: { ...execution.resultStudioInputLineage[input.id], materializationHash: 'f'.repeat(64) },
        })),
      });
      return candidate;
    },
  })), (error) => error.code === 'candidate_input_lineage_drift');
});

test('P6 primary candidate rejects lineage from tampered source execution provenance', async (context) => {
  const fx = fixture(context, 'primary-untrusted-lineage-');
  attachServerIssuedSourceLineage(fx);
  fx.sourceJob.result.executionProvenance.inputs[0].lineage.sourceRevisionId = 'rev_tampered';
  let executed = false;
  await assert.rejects(() => createResultChangeSet(request(fx), serviceDependencies(fx, {
    executeJob: async () => { executed = true; return null; },
  })), (error) => error.code === 'source_input_lineage_untrusted');
  assert.equal(executed, false);
});

test('P5 executes immutable Revision scalars instead of mutable source Job drift', async (context) => {
  const fx = fixture(context, 'mutable-job-scalar-drift-');
  fx.sourceJob.params.point_size = 999;
  fx.sourceJob.params.palette = 'attacker-controlled';

  const result = await createResultChangeSet(request(fx), serviceDependencies(fx, {
    executeJob: successfulExecutor(fx),
  }));

  assert.equal(result.ok, true);
  assert.equal(result.changeSet.status, 'preview_ready');
});

test('P5 rejects source input hash drift before creating a ChangeSet', async (context) => {
  const fx = fixture(context, 'source-input-drift-');
  writeFileSync(fx.sourceInput, 'gene,log2FoldChange,padj\nTP53,999,0.9\n');
  await assert.rejects(() => createResultChangeSet(request(fx), serviceDependencies(fx, {
    executeJob: successfulExecutor(fx),
  })), (error) => error.code === 'source_input_drift');
  assert.deepEqual(fx.repository.listChangeSets({ projectId: 'p_1' }).map((changeSet) => changeSet.changeSetId), ['cs_source']);
});

test('P5 request-body descriptors cannot enable candidate validation', async (context) => {
  const fx = fixture(context, 'validator-dispatch-');
  await assert.rejects(() => createResultChangeSet(request(fx, {
    pluginDescriptor: volcanoDescriptor(),
    downstreamPluginDescriptors: { 'volcano-plot': volcanoDescriptor() },
  }), {
    repository: fx.repository, adapter: fx.adapter, getToolJob: () => fx.sourceJob,
    executeJob: successfulExecutor(fx),
  }), (error) => error.code === 'candidate_plugin_validation_failed');
  const failed = fx.repository.listChangeSets({ projectId: 'p_1', status: 'validation_failed' });
  assert.equal(failed.length, 1);
  assert.deepEqual(fx.repository.listRevisionsByChangeSet(failed[0].changeSetId), []);
});

test('P5/P6 reruns verified direct DEG → GO-BP and volcano subgraphs with candidate-only lineage', async (context) => {
  const fx = fixture(context, 'p5-subgraph-');
  const sourceScript = 'print("deseq")\n';
  const sourceScriptHash = sha256(sourceScript);
  const degOutput = join(fx.workspaceRoot, 'results/jobs/tj_deg_source/output/deg.csv');
  const degSummaryOutput = join(fx.workspaceRoot, 'results/jobs/tj_deg_source/output/deg_summary.csv');
  mkdirSync(join(degOutput, '..'), { recursive: true });
  writeFileSync(degOutput, 'gene,log2FoldChange,padj\nA,2,0.01\n');
  writeFileSync(degSummaryOutput, 'metric,value\nsignificant,1\n');
  const degOutputHash = sha256(readFileSync(degOutput));
  const degSummaryOutputHash = sha256(readFileSync(degSummaryOutput));
  const degParamsText = '{\n  "padj_cutoff": 0.05,\n  "lfc_cutoff": 1\n}\n';
  const degBase = fx.adapter.commitVirtualFiles({
    parentCommit: fx.sourceRevision.sourceCommit,
    ref: 'refs/heads/biof3/p5/deg-source', expectedOld: '0'.repeat(40), message: 'P5 DEG source',
    files: [
      { path: 'analysis/scripts/deg-source/deg.R', content: sourceScript },
      { path: 'analysis/scripts/deg-source/parameters.json', content: degParamsText },
    ],
  }).commit;
  fx.repository.createChangeSet({
    changeSetId: 'cs_deg_source', projectId: 'p_1', baseCommit: fx.sourceRevision.sourceCommit,
    workingBranchRef: 'refs/heads/biof3/p5/deg-source', createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_deg_source', to: 'running' });
  fx.repository.transitionChangeSet({
    changeSetId: 'cs_deg_source', to: 'preview_ready', candidateCommit: degBase,
    candidateArtifactRefs: ['rev_deg_source', 'rev_deg_summary_source'], jobRefs: ['tj_deg_source'],
  });
  const degRevision = fx.repository.appendRevision({
    revisionId: 'rev_deg_source', projectId: 'p_1', artifactFamilyId: 'deg_family', artifactId: 'deg_table',
    sourceCommit: degBase,
    sourceScriptRef: {
      relativePath: 'analysis/scripts/deg-source/deg.R', sha256: sourceScriptHash,
      artifactId: 'deg_table', rendererId: 'deseq2:deg_table', language: 'r', origin: 'project_materialized',
    },
    parametersRef: 'analysis/scripts/deg-source/parameters.json', parametersHash: sha256(degParamsText),
    toolJobId: 'tj_deg_source', outputPath: 'results/jobs/tj_deg_source/output/deg.csv', outputHash: degOutputHash,
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_deg_source',
  });
  fx.repository.appendRevision({
    revisionId: 'rev_deg_summary_source', projectId: 'p_1', artifactFamilyId: 'deg_summary_family', artifactId: 'deg_summary',
    sourceCommit: degBase,
    sourceScriptRef: {
      relativePath: 'analysis/scripts/deg-source/deg.R', sha256: sourceScriptHash,
      artifactId: 'deg_summary', rendererId: 'deseq2:deg_summary', language: 'r', origin: 'project_materialized',
    },
    parametersRef: 'analysis/scripts/deg-source/parameters.json', parametersHash: sha256(degParamsText),
    toolJobId: 'tj_deg_source', outputPath: 'results/jobs/tj_deg_source/output/deg_summary.csv', outputHash: degSummaryOutputHash,
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_deg_source',
  });
  fx.repository.adoptChangeSet({ changeSetId: 'cs_deg_source', candidateCommit: degBase });

  const goScript = 'print("go")\n';
  const goScriptHash = sha256(goScript);
  const goParams = {
    deg_table: { inputRef: 'inputs/deg_table/deg.csv', sha256: degOutputHash },
    species: 'human', analysis_type: 'GO-BP', gene_id_type: 'SYMBOL', enrich_pvalue: 0.05,
    enrich_qvalue: 0.2, top_n: 20, padj_cutoff: 0.05, lfc_cutoff: 1,
  };
  const goParamsText = `${JSON.stringify(goParams, null, 2)}\n`;
  const goOutput = join(fx.workspaceRoot, 'results/jobs/tj_go_source/output/go_bp_results.csv');
  mkdirSync(join(goOutput, '..'), { recursive: true });
  writeFileSync(goOutput, 'ID,Description,p.adjust\nGO:1,cell cycle,0.01\n');
  const goOutputHash = sha256(readFileSync(goOutput));
  const goBase = fx.adapter.commitVirtualFiles({
    parentCommit: degBase,
    ref: 'refs/heads/biof3/p5/go-source', expectedOld: '0'.repeat(40), message: 'P5 GO source',
    files: [
      { path: 'analysis/scripts/go-source/go.R', content: goScript },
      { path: 'analysis/scripts/go-source/parameters.json', content: goParamsText },
    ],
  }).commit;
  fx.repository.createChangeSet({
    changeSetId: 'cs_go_source', projectId: 'p_1', baseCommit: degBase,
    workingBranchRef: 'refs/heads/biof3/p5/go-source', createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_go_source', to: 'running' });
  fx.repository.transitionChangeSet({
    changeSetId: 'cs_go_source', to: 'preview_ready', candidateCommit: goBase,
    candidateArtifactRefs: ['rev_go_source'], jobRefs: ['tj_go_source'],
  });
  const goRevision = fx.repository.appendRevision({
    revisionId: 'rev_go_source', projectId: 'p_1', artifactFamilyId: 'go_family', artifactId: 'go_bp_results',
    sourceCommit: goBase,
    sourceScriptRef: {
      relativePath: 'analysis/scripts/go-source/go.R', sha256: goScriptHash,
      artifactId: 'go_bp_results', rendererId: 'go-kegg:go_bp_results', language: 'r', origin: 'project_materialized',
    },
    parametersRef: 'analysis/scripts/go-source/parameters.json', parametersHash: sha256(goParamsText),
    toolJobId: 'tj_go_source', outputPath: 'results/jobs/tj_go_source/output/go_bp_results.csv', outputHash: goOutputHash,
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_go_source',
  });
  fx.repository.adoptChangeSet({ changeSetId: 'cs_go_source', candidateCommit: goBase });

  const volcanoScript = 'print("volcano")\n';
  const volcanoScriptHash = sha256(volcanoScript);
  const volcanoParams = {
    deg_table: { inputRef: 'inputs/deg_table/deg.csv', sha256: degOutputHash },
    fc_threshold: 1,
    pval_threshold: 1.301,
  };
  const volcanoParamsText = `${JSON.stringify(volcanoParams, null, 2)}\n`;
  const volcanoOutput = join(fx.workspaceRoot, 'results/jobs/tj_volcano_source/output/volcano.svg');
  mkdirSync(join(volcanoOutput, '..'), { recursive: true });
  writeFileSync(volcanoOutput, '<svg><title>source volcano</title></svg>\n');
  const volcanoOutputHash = sha256(readFileSync(volcanoOutput));
  const volcanoBase = fx.adapter.commitVirtualFiles({
    parentCommit: goBase,
    ref: 'refs/heads/biof3/p6/volcano-source', expectedOld: '0'.repeat(40), message: 'P6 volcano source',
    files: [
      { path: 'analysis/scripts/volcano-source/volcano.R', content: volcanoScript },
      { path: 'analysis/scripts/volcano-source/parameters.json', content: volcanoParamsText },
    ],
  }).commit;
  fx.repository.createChangeSet({
    changeSetId: 'cs_volcano_source', projectId: 'p_1', baseCommit: goBase,
    workingBranchRef: 'refs/heads/biof3/p6/volcano-source', createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_volcano_source', to: 'running' });
  fx.repository.transitionChangeSet({
    changeSetId: 'cs_volcano_source', to: 'preview_ready', candidateCommit: volcanoBase,
    candidateArtifactRefs: ['rev_volcano_source'], jobRefs: ['tj_volcano_source'],
  });
  const volcanoRevision = fx.repository.appendRevision({
    revisionId: 'rev_volcano_source', projectId: 'p_1', artifactFamilyId: 'volcano_child_family', artifactId: 'volcano',
    sourceCommit: volcanoBase,
    sourceScriptRef: {
      relativePath: 'analysis/scripts/volcano-source/volcano.R', sha256: volcanoScriptHash,
      artifactId: 'volcano', rendererId: 'volcano-plot:volcano', language: 'r', origin: 'project_materialized',
    },
    parametersRef: 'analysis/scripts/volcano-source/parameters.json', parametersHash: sha256(volcanoParamsText),
    toolJobId: 'tj_volcano_source', outputPath: 'results/jobs/tj_volcano_source/output/volcano.svg', outputHash: volcanoOutputHash,
    validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_volcano_source',
  });
  fx.repository.adoptChangeSet({ changeSetId: 'cs_volcano_source', candidateCommit: volcanoBase });

  const degJob = {
    id: 'tj_deg_source', project_id: 'p_1', tool_id: 'deseq2', status: 'completed', params: { padj_cutoff: 0.05, lfc_cutoff: 1 },
    result: {
      artifactTruth: { status: 'valid', blocking: false }, artifacts: [
        { id: 'deg_table', path: degOutput }, { id: 'deg_summary', path: degSummaryOutput },
      ],
      executionProvenance: signedExecutionProvenance({
        executionProvenanceVersion: 1,
        toolJobId: 'tj_deg_source', projectId: 'p_1', params: { normalized: { padj_cutoff: 0.05, lfc_cutoff: 1 } }, inputs: [],
        script: { snapshotPath: '/snapshot/deg.R', sha256: sourceScriptHash },
        artifacts: [{ id: 'deg_table', sha256: degOutputHash }, { id: 'deg_summary', sha256: degSummaryOutputHash }],
      }),
    },
  };
  const goJob = {
    id: 'tj_go_source', project_id: 'p_1', tool_id: 'go-kegg', status: 'completed',
    params: { deg_table: degOutput, species: 'human', analysis_type: 'GO-BP', gene_id_type: 'SYMBOL', enrich_pvalue: 0.05, enrich_qvalue: 0.2, top_n: 20, padj_cutoff: 0.05, lfc_cutoff: 1 },
    result: {
      artifactTruth: { status: 'valid', blocking: false }, artifacts: [{ id: 'go_bp_results', path: goOutput }],
      executionProvenance: signedExecutionProvenance({
        executionProvenanceVersion: 1,
        toolJobId: 'tj_go_source', projectId: 'p_1', params: { normalized: goParams },
        inputs: [{ id: 'deg_table', relativePath: 'inputs/deg_table/deg.csv', sha256: degOutputHash }],
        script: { snapshotPath: '/snapshot/go.R', sha256: goScriptHash },
        artifacts: [{ id: 'go_bp_results', sha256: goOutputHash }],
      }),
    },
  };
  const volcanoJob = {
    id: 'tj_volcano_source', project_id: 'p_1', tool_id: 'volcano-plot', status: 'completed',
    params: { deg_table: degOutput, fc_threshold: 1, pval_threshold: 1.301 },
    result: {
      artifactTruth: { status: 'valid', blocking: false }, artifacts: [{ id: 'volcano', path: volcanoOutput }],
      executionProvenance: signedExecutionProvenance({
        executionProvenanceVersion: 1,
        toolJobId: 'tj_volcano_source', projectId: 'p_1', params: { normalized: volcanoParams },
        inputs: [{ id: 'deg_table', relativePath: 'inputs/deg_table/deg.csv', sha256: degOutputHash }],
        script: { snapshotPath: '/snapshot/volcano.R', sha256: volcanoScriptHash },
        artifacts: [{ id: 'volcano', sha256: volcanoOutputHash }],
      }),
    },
  };
  const jobs = new Map([[degJob.id, degJob], [goJob.id, goJob], [volcanoJob.id, volcanoJob]]);
  const scientificIntent = {
    contractVersion: '1', intentId: 'rei_p5_direct', artifactRef: { artifactId: 'deg_table', revisionId: degRevision.revisionId },
    requestedOutcome: 'use a stricter adjusted p-value cutoff', editClass: 'scientific_recompute',
    proposedParameterPatch: { padj_cutoff: 0.01 }, affectedNodeIds: ['job:tj_deg_source', 'job:tj_go_source'],
    affectedScope: 'workflow_subgraph', requiresJob: true, requiresScientificConfirmation: true,
    classificationReason: 'padj_cutoff:scientific_recompute', workflowGraph: { graphId: 'wfg_p5_direct', sourceDigest: 'd'.repeat(64) },
  };
  const candidateDeg = join(fx.workspaceRoot, 'results/jobs/tj_deg_candidate/output/deg_candidate.csv');
  const candidateDegSummary = join(fx.workspaceRoot, 'results/jobs/tj_deg_candidate/output/deg_summary.csv');
  const candidateGo = join(fx.workspaceRoot, 'results/jobs/tj_go_candidate/output/go_bp_results.csv');
  const result = await createResultChangeSet({
    projectId: 'p_1', conversationId: 'conv_p5', workspaceRoot: fx.workspaceRoot, intent: scientificIntent,
    sourceRevision: degRevision, sourceJob: degJob, sourceScriptContent: sourceScript, sourceScriptSha256: sourceScriptHash,
    normalizedSourceParams: { padj_cutoff: 0.05, lfc_cutoff: 1 }, pluginId: 'deseq2', language: 'r', scriptPatch: [],
    scientificConfirmed: true, createdBy: 'agent',
    authoritativeSubgraph: {
      authority: 'sqlite_job_artifact_truth', graphId: 'wfg_p5_direct', sourceDigest: 'd'.repeat(64),
      rootNodeId: 'job:tj_deg_source', rootToolJobId: 'tj_deg_source', rootRevisionId: degRevision.revisionId,
      children: [{
        nodeId: 'job:tj_go_source', toolId: 'go-kegg', inputId: 'deg_table', edgeKind: 'artifact',
        sourceToolJobId: 'tj_deg_source', sourceRevisionId: degRevision.revisionId, sourceArtifactId: 'deg_table', sourceOutputHash: degOutputHash,
        childToolJobId: 'tj_go_source', childRevisionId: goRevision.revisionId,
      }],
    },
  }, {
    repository: fx.repository, adapter: fx.adapter, authoritativeSubgraphTrusted: true, getToolJob: (id) => jobs.get(id) || null,
    getResultStudioDescriptor: (toolId) => toolId === 'deseq2'
      ? deseqDescriptor()
      : toolId === 'go-kegg' ? goDescriptor() : null,
    executeJob: async ({ toolId, params, resultStudioInputLineage, materializedScriptSha256 }) => {
      if (toolId === 'deseq2') {
        assert.equal(params.padj_cutoff, 0.01);
        mkdirSync(join(candidateDeg, '..'), { recursive: true });
        writeFileSync(candidateDeg, 'gene,log2FoldChange,padj\nA,2,0.001\n');
        writeFileSync(candidateDegSummary, 'metric,value\nsignificant,1\n');
        const hash = sha256(readFileSync(candidateDeg));
        const summaryHash = sha256(readFileSync(candidateDegSummary));
        return { job: {
          id: 'tj_deg_candidate', project_id: 'p_1', tool_id: 'deseq2', status: 'completed', result: {
            artifactTruth: { status: 'valid', blocking: false }, artifacts: [
              { id: 'deg_table', path: candidateDeg }, { id: 'deg_summary', path: candidateDegSummary },
            ],
            executionProvenance: signedExecutionProvenance({
              executionProvenanceVersion: 1, toolJobId: 'tj_deg_candidate', projectId: 'p_1',
              script: { sha256: materializedScriptSha256 },
              params: { normalized: { padj_cutoff: 0.01, lfc_cutoff: 1 } },
              inputs: [], artifacts: [{ id: 'deg_table', sha256: hash }, { id: 'deg_summary', sha256: summaryHash }],
            }),
          },
        } };
      }
      assert.equal(toolId, 'go-kegg');
      assert.equal(params.deg_table, candidateDeg, 'only the exact candidate DEG path is rebound');
      assert.equal(params.padj_cutoff, 0.01, 'the edited DEG threshold propagates to enrichment');
      assert.equal(params.enrich_qvalue, 0.2, 'the original child scientific parameters are preserved');
      assert.equal(resultStudioInputLineage.deg_table.sourceArtifactId, 'deg_table');
      mkdirSync(join(candidateGo, '..'), { recursive: true });
      writeFileSync(candidateGo, 'ID,Description,p.adjust\nGO:1,cell cycle,0.001\n');
      const hash = sha256(readFileSync(candidateGo));
      const candidateDegHash = sha256(readFileSync(candidateDeg));
      return { job: {
        id: 'tj_go_candidate', project_id: 'p_1', tool_id: 'go-kegg', status: 'completed', result: {
          artifactTruth: { status: 'valid', blocking: false }, artifacts: [{ id: 'go_bp_results', path: candidateGo }],
          executionProvenance: signedExecutionProvenance({
            executionProvenanceVersion: 1, toolJobId: 'tj_go_candidate', projectId: 'p_1',
            script: { sha256: materializedScriptSha256 },
            params: { normalized: { ...goParams, padj_cutoff: 0.01, deg_table: { inputRef: 'inputs/deg_table/deg_candidate.csv', sha256: candidateDegHash } } },
            inputs: [{ id: 'deg_table', sha256: candidateDegHash, lineage: resultStudioInputLineage.deg_table }],
            artifacts: [{ id: 'go_bp_results', sha256: hash }],
          }),
        },
      } };
    },
  });
  assert.equal(result.changeSet.status, 'preview_ready');
  assert.deepEqual(result.changeSet.jobRefs, ['tj_deg_candidate', 'tj_go_candidate']);
  assert.equal(result.downstreamRevisions.length, 1);
  assert.equal(result.cohortRevisions.length, 3, 'every formal output from both Jobs is registered atomically');
  assert.equal(result.cohortRevisions.some((revision) => revision.artifactId === 'deg_summary'
    && revision.toolJobId === 'tj_deg_candidate'), true);
  const candidateGraph = fx.db.prepare('SELECT * FROM result_workflow_graphs WHERE root_tool_job_id = ?')
    .get('tj_deg_candidate');
  assert.ok(candidateGraph, 'successful scientific rerun persists its candidate DAG in the same transaction');
  assert.equal(result.revision.sourceCommit, result.downstreamRevisions[0].sourceCommit);
  assert.deepEqual(result.downstreamRevisions[0].parentRevisionIds, [goRevision.revisionId, result.revision.revisionId]);
  assert.equal(fx.repository.getCurrentRevision('deg_family').revisionId, degRevision.revisionId);
  assert.equal(fx.repository.getCurrentRevision('go_family').revisionId, goRevision.revisionId);
  assert.equal(fx.adapter.showFile({ ref: result.candidateCommit, filePath: result.downstreamRevisions[0].sourceScriptRef.relativePath }), goScript);

  const multiIntent = {
    ...scientificIntent,
    intentId: 'rei_p6_direct_multi',
    requestedOutcome: 'use a stricter absolute log2 fold-change cutoff everywhere downstream',
    proposedParameterPatch: { lfc_cutoff: 1.5 },
    affectedNodeIds: ['job:tj_deg_source', 'job:tj_go_source', 'job:tj_volcano_source'],
    classificationReason: 'lfc_cutoff:scientific_recompute',
    workflowGraph: { graphId: 'wfg_p6_direct_multi', sourceDigest: 'e'.repeat(64) },
  };
  const candidateDegMulti = join(fx.workspaceRoot, 'results/jobs/tj_deg_candidate_multi/output/deg_candidate.csv');
  const candidateDegSummaryMulti = join(fx.workspaceRoot, 'results/jobs/tj_deg_candidate_multi/output/deg_summary.csv');
  const candidateGoMulti = join(fx.workspaceRoot, 'results/jobs/tj_go_candidate_multi/output/go_bp_results.csv');
  const candidateVolcanoMulti = join(fx.workspaceRoot, 'results/jobs/tj_volcano_candidate_multi/output/volcano.svg');
  const multiResult = await createResultChangeSet({
    projectId: 'p_1', conversationId: 'conv_p6', workspaceRoot: fx.workspaceRoot, intent: multiIntent,
    sourceRevision: degRevision, sourceJob: degJob, sourceScriptContent: sourceScript, sourceScriptSha256: sourceScriptHash,
    normalizedSourceParams: { padj_cutoff: 0.05, lfc_cutoff: 1 }, pluginId: 'deseq2', language: 'r', scriptPatch: [],
    scientificConfirmed: true, createdBy: 'agent',
    authoritativeSubgraph: {
      authority: 'sqlite_job_artifact_truth', graphId: 'wfg_p6_direct_multi', sourceDigest: 'e'.repeat(64),
      rootNodeId: 'job:tj_deg_source', rootToolJobId: 'tj_deg_source', rootRevisionId: degRevision.revisionId,
      children: [{
        nodeId: 'job:tj_volcano_source', toolId: 'volcano-plot', inputId: 'deg_table', edgeKind: 'artifact',
        sourceToolJobId: 'tj_deg_source', sourceRevisionId: degRevision.revisionId, sourceArtifactId: 'deg_table', sourceOutputHash: degOutputHash,
        childToolJobId: 'tj_volcano_source', childRevisionId: volcanoRevision.revisionId,
      }, {
        nodeId: 'job:tj_go_source', toolId: 'go-kegg', inputId: 'deg_table', edgeKind: 'artifact',
        sourceToolJobId: 'tj_deg_source', sourceRevisionId: degRevision.revisionId, sourceArtifactId: 'deg_table', sourceOutputHash: degOutputHash,
        childToolJobId: 'tj_go_source', childRevisionId: goRevision.revisionId,
      }],
    },
  }, {
    repository: fx.repository, adapter: fx.adapter, authoritativeSubgraphTrusted: true, getToolJob: (id) => jobs.get(id) || null,
    getResultStudioDescriptor: (toolId) => toolId === 'deseq2'
      ? deseqDescriptor()
      : toolId === 'go-kegg' ? goDescriptor()
        : toolId === 'volcano-plot' ? volcanoChildDescriptor() : null,
    executeJob: async ({ toolId, params, resultStudioInputLineage, materializedScriptSha256 }) => {
      if (toolId === 'deseq2') {
        assert.deepEqual(params, { padj_cutoff: 0.05, lfc_cutoff: 1.5 });
        mkdirSync(join(candidateDegMulti, '..'), { recursive: true });
        writeFileSync(candidateDegMulti, 'gene,log2FoldChange,padj\nA,2,0.01\n');
        writeFileSync(candidateDegSummaryMulti, 'metric,value\nsignificant,1\n');
        const hash = sha256(readFileSync(candidateDegMulti));
        const summaryHash = sha256(readFileSync(candidateDegSummaryMulti));
        return { job: {
          id: 'tj_deg_candidate_multi', project_id: 'p_1', tool_id: 'deseq2', status: 'completed', result: {
            artifactTruth: { status: 'valid', blocking: false }, artifacts: [
              { id: 'deg_table', path: candidateDegMulti }, { id: 'deg_summary', path: candidateDegSummaryMulti },
            ],
            executionProvenance: signedExecutionProvenance({
              executionProvenanceVersion: 1, toolJobId: 'tj_deg_candidate_multi', projectId: 'p_1',
              script: { sha256: materializedScriptSha256 },
              params: { normalized: { padj_cutoff: 0.05, lfc_cutoff: 1.5 } },
              inputs: [], artifacts: [{ id: 'deg_table', sha256: hash }, { id: 'deg_summary', sha256: summaryHash }],
            }),
          },
        } };
      }
      const candidateDegHash = sha256(readFileSync(candidateDegMulti));
      assert.equal(params.deg_table, candidateDegMulti, 'each child receives only the exact candidate DEG path');
      assert.equal(resultStudioInputLineage.deg_table.sourceOutputHash, candidateDegHash);
      if (toolId === 'go-kegg') {
        assert.equal(params.lfc_cutoff, 1.5);
        assert.equal(params.padj_cutoff, 0.05);
        mkdirSync(join(candidateGoMulti, '..'), { recursive: true });
        writeFileSync(candidateGoMulti, 'ID,Description,p.adjust\nGO:1,cell cycle,0.01\n');
        const hash = sha256(readFileSync(candidateGoMulti));
        return { job: {
          id: 'tj_go_candidate_multi', project_id: 'p_1', tool_id: 'go-kegg', status: 'completed', result: {
            artifactTruth: { status: 'valid', blocking: false }, artifacts: [{ id: 'go_bp_results', path: candidateGoMulti }],
            executionProvenance: signedExecutionProvenance({
              executionProvenanceVersion: 1, toolJobId: 'tj_go_candidate_multi', projectId: 'p_1',
              script: { sha256: materializedScriptSha256 },
              params: { normalized: { ...goParams, lfc_cutoff: 1.5, deg_table: { inputRef: 'inputs/deg_table/deg_candidate.csv', sha256: candidateDegHash } } },
              inputs: [{ id: 'deg_table', sha256: candidateDegHash, lineage: resultStudioInputLineage.deg_table }],
              artifacts: [{ id: 'go_bp_results', sha256: hash }],
            }),
          },
        } };
      }
      assert.equal(toolId, 'volcano-plot');
      assert.equal(params.fc_threshold, 1.5, 'the DEG LFC cutoff maps to volcano fc_threshold');
      assert.equal(params.pval_threshold, 1.301, 'volcano significance scale remains unchanged');
      mkdirSync(join(candidateVolcanoMulti, '..'), { recursive: true });
      writeFileSync(candidateVolcanoMulti, '<svg><title>candidate volcano</title></svg>\n');
      const hash = sha256(readFileSync(candidateVolcanoMulti));
      return { job: {
        id: 'tj_volcano_candidate_multi', project_id: 'p_1', tool_id: 'volcano-plot', status: 'completed', result: {
          artifactTruth: { status: 'valid', blocking: false }, artifacts: [{ id: 'volcano', path: candidateVolcanoMulti }],
          executionProvenance: signedExecutionProvenance({
            executionProvenanceVersion: 1, toolJobId: 'tj_volcano_candidate_multi', projectId: 'p_1',
            script: { sha256: materializedScriptSha256 },
            params: { normalized: { ...volcanoParams, fc_threshold: 1.5, deg_table: { inputRef: 'inputs/deg_table/deg_candidate.csv', sha256: candidateDegHash } } },
            inputs: [{ id: 'deg_table', sha256: candidateDegHash, lineage: resultStudioInputLineage.deg_table }],
            artifacts: [{ id: 'volcano', sha256: hash }],
          }),
        },
      } };
    },
  });
  assert.equal(multiResult.changeSet.status, 'preview_ready');
  assert.deepEqual(multiResult.changeSet.jobRefs, [
    'tj_deg_candidate_multi', 'tj_go_candidate_multi', 'tj_volcano_candidate_multi',
  ]);
  assert.equal(multiResult.downstreamRevisions.length, 2);
  assert.equal(multiResult.cohortRevisions.length, 4, 'root and both direct child formal outputs are one atomic cohort');
  const downstreamByArtifact = new Map(multiResult.downstreamRevisions.map((revision) => [revision.artifactId, revision]));
  assert.deepEqual(downstreamByArtifact.get('go_bp_results').parentRevisionIds, [goRevision.revisionId, multiResult.revision.revisionId]);
  assert.deepEqual(downstreamByArtifact.get('volcano').parentRevisionIds, [volcanoRevision.revisionId, multiResult.revision.revisionId]);
  assert.equal(multiResult.cohortRevisions.every((revision) => revision.sourceCommit === multiResult.candidateCommit), true);
  const multiGraphRow = fx.db.prepare('SELECT * FROM result_workflow_graphs WHERE root_tool_job_id = ?')
    .get('tj_deg_candidate_multi');
  const multiGraphNodes = JSON.parse(multiGraphRow.nodes_json);
  const multiGraphEdges = JSON.parse(multiGraphRow.edges_json);
  assert.deepEqual(multiGraphNodes.map((node) => node.toolJobId).sort(), [
    'tj_deg_candidate_multi', 'tj_go_candidate_multi', 'tj_volcano_candidate_multi',
  ]);
  assert.deepEqual(multiGraphEdges.map((edge) => edge.toNodeId).sort(), [
    'job:tj_go_candidate_multi', 'job:tj_volcano_candidate_multi',
  ]);
  assert.equal(fx.repository.getCurrentRevision('deg_family').revisionId, degRevision.revisionId);
  assert.equal(fx.repository.getCurrentRevision('go_family').revisionId, goRevision.revisionId);
  assert.equal(fx.repository.getCurrentRevision('volcano_child_family').revisionId, volcanoRevision.revisionId);
  for (const revision of multiResult.downstreamRevisions) {
    const expectedScript = revision.artifactId === 'volcano' ? volcanoScript : goScript;
    assert.equal(fx.adapter.showFile({ ref: multiResult.candidateCommit, filePath: revision.sourceScriptRef.relativePath }), expectedScript);
  }
});

test('P5 atomically registers the complete Revision cohort, graph and preview projection', (context) => {
  const fx = fixture(context, 'p5-atomic-batch-');
  ensureResultWorkflowGraphSchema(fx.db);
  fx.repository.createChangeSet({
    changeSetId: 'cs_atomic', projectId: 'p_1', baseCommit: fx.sourceRevision.sourceCommit,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_atomic', createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_atomic', to: 'running' });
  const root = revisionFromSource(fx, 'cs_atomic', {
    revisionId: 'rev_atomic_root', toolJobId: 'tj_atomic_root',
  });
  const child = revisionFromSource(fx, 'cs_atomic', {
    revisionId: 'rev_atomic_child', artifactFamilyId: 'go_family_atomic', artifactId: 'go_bp_results',
    rendererId: 'go-kegg:go_bp_results', parentRevisionIds: [], toolJobId: 'tj_atomic_child',
    outputPath: 'results/jobs/tj_atomic_child/output/go.csv', outputHash: 'b'.repeat(64),
  });
  const nodes = [
    {
      id: 'job:tj_atomic_root', toolJobId: root.toolJobId, toolId: 'volcano-plot',
      artifactIds: [root.artifactId], provenanceHash: 'c'.repeat(64), dependsOn: [],
    },
    {
      id: 'job:tj_atomic_child', toolJobId: child.toolJobId, toolId: 'go-kegg',
      artifactIds: [child.artifactId], provenanceHash: 'd'.repeat(64), dependsOn: ['job:tj_atomic_root'],
    },
  ];
  const edges = [{
    kind: 'artifact', fromNodeId: 'job:tj_atomic_root', toNodeId: 'job:tj_atomic_child',
    sourceToolJobId: root.toolJobId, sourceRevisionId: root.revisionId,
    sourceArtifactId: root.artifactId, sourceOutputHash: root.outputHash,
    selectionId: null, selectionHash: null, inputId: root.artifactId,
  }];
  const sourceDigest = workflowGraphDigest({
    projectId: 'p_1', rootToolJobId: root.toolJobId, nodes, edges,
  });
  const graphFor = ({
    graphNodes = nodes,
    graphEdges = edges,
    rootToolJobId = root.toolJobId,
  } = {}) => {
    const digest = workflowGraphDigest({
      projectId: 'p_1', rootToolJobId, nodes: graphNodes, edges: graphEdges,
    });
    return {
      graphId: `wfg_${digest.slice(0, 24)}`,
      contractVersion: 1,
      projectId: 'p_1',
      rootToolJobId,
      sourceDigest: digest,
      validationStatus: 'valid',
      nodes: graphNodes,
      edges: graphEdges,
    };
  };
  const graph = graphFor();
  assert.equal(graph.sourceDigest, sourceDigest);
  assert.throws(() => fx.repository.appendRevisionBatch({
    revisions: [root, { ...child, outputPath: '/absolute/path.csv' }],
  }), (error) => error.code === 'revision_invalid');
  assert.equal(fx.repository.getRevision(root.revisionId), null, 'invalid second Revision rolls back the first insert');

  const transition = {
    changeSetId: 'cs_atomic', to: 'preview_ready', candidateCommit: fx.sourceRevision.sourceCommit,
    candidateArtifactRefs: [root.revisionId, child.revisionId], jobRefs: [root.toolJobId, child.toolJobId],
    validationSummary: {
      workflowGraph: { graphId: graph.graphId, sourceDigest: graph.sourceDigest },
    },
  };
  assert.throws(() => fx.repository.appendRevisionBatch({
    revisions: [root, child], workflowGraph: graph,
    transition: { ...transition, candidateArtifactRefs: [root.revisionId] },
  }), (error) => error.code === 'revision_batch_transition_cohort_mismatch');
  assert.throws(() => fx.repository.appendRevisionBatch({
    revisions: [root, child], workflowGraph: graph,
    transition: { ...transition, jobRefs: [root.toolJobId, root.toolJobId] },
  }), (error) => error.code === 'revision_batch_transition_scope_invalid');
  assert.throws(() => fx.repository.appendRevisionBatch({
    revisions: [root, {
      ...child,
      revisionId: 'rev_atomic_duplicate_family',
      artifactFamilyId: root.artifactFamilyId,
      artifactId: root.artifactId,
      sourceScriptRef: root.sourceScriptRef,
    }],
    transition: {
      ...transition,
      candidateArtifactRefs: [root.revisionId, 'rev_atomic_duplicate_family'],
    },
  }), (error) => error.code === 'revision_batch_duplicate_family');

  const unrelatedNodes = [{
    id: 'job:tj_unrelated', toolJobId: 'tj_unrelated', toolId: 'volcano-plot',
    artifactIds: ['unrelated_artifact'], provenanceHash: 'e'.repeat(64), dependsOn: [],
  }];
  const unrelatedGraph = graphFor({ graphNodes: unrelatedNodes, graphEdges: [], rootToolJobId: 'tj_unrelated' });
  assert.throws(() => fx.repository.appendRevisionBatch({
    revisions: [root, child], workflowGraph: unrelatedGraph,
    transition: {
      ...transition,
      validationSummary: {
        workflowGraph: { graphId: unrelatedGraph.graphId, sourceDigest: unrelatedGraph.sourceDigest },
      },
    },
  }), (error) => error.code === 'revision_batch_graph_cohort_mismatch');

  const missingArtifactGraph = graphFor({
    graphNodes: nodes.map((node) => node.toolJobId === child.toolJobId
      ? { ...node, artifactIds: ['unrelated_child_artifact'] }
      : node),
  });
  assert.throws(() => fx.repository.appendRevisionBatch({
    revisions: [root, child], workflowGraph: missingArtifactGraph,
    transition: {
      ...transition,
      validationSummary: {
        workflowGraph: { graphId: missingArtifactGraph.graphId, sourceDigest: missingArtifactGraph.sourceDigest },
      },
    },
  }), (error) => error.code === 'revision_batch_graph_cohort_mismatch');

  const wrongEdgeGraph = graphFor({
    graphEdges: edges.map((edge) => ({ ...edge, sourceOutputHash: 'f'.repeat(64) })),
  });
  assert.throws(() => fx.repository.appendRevisionBatch({
    revisions: [root, child], workflowGraph: wrongEdgeGraph,
    transition: {
      ...transition,
      validationSummary: {
        workflowGraph: { graphId: wrongEdgeGraph.graphId, sourceDigest: wrongEdgeGraph.sourceDigest },
      },
    },
  }), (error) => error.code === 'revision_batch_graph_edge_mismatch');

  const missingSourceGraph = graphFor({
    graphEdges: edges.map((edge) => ({ ...edge, sourceRevisionId: 'rev_atomic_missing_source' })),
  });
  assert.throws(() => fx.repository.appendRevisionBatch({
    revisions: [root, child], workflowGraph: missingSourceGraph,
    transition: {
      ...transition,
      validationSummary: {
        workflowGraph: { graphId: missingSourceGraph.graphId, sourceDigest: missingSourceGraph.sourceDigest },
      },
    },
  }), (error) => error.code === 'revision_batch_graph_source_revision_missing');

  assert.throws(() => fx.repository.appendRevisionBatch({
    revisions: [root, child], workflowGraph: graph,
    transition: {
      ...transition,
      validationSummary: {
        workflowGraph: { graphId: graph.graphId, sourceDigest: '0'.repeat(64) },
      },
    },
  }), (error) => error.code === 'revision_batch_graph_transition_mismatch');
  assert.equal(fx.repository.getRevision(root.revisionId), null, 'incomplete or malformed cohort declarations insert nothing');
  assert.equal(fx.repository.findWorkflowGraph({ projectId: 'p_1', sourceDigest: graph.sourceDigest }), null);
  assert.equal(fx.repository.findWorkflowGraph({ projectId: 'p_1', sourceDigest: unrelatedGraph.sourceDigest }), null);
  assert.equal(fx.repository.findWorkflowGraph({ projectId: 'p_1', sourceDigest: missingArtifactGraph.sourceDigest }), null);
  assert.equal(fx.repository.findWorkflowGraph({ projectId: 'p_1', sourceDigest: wrongEdgeGraph.sourceDigest }), null);
  assert.equal(fx.repository.findWorkflowGraph({ projectId: 'p_1', sourceDigest: missingSourceGraph.sourceDigest }), null);
  assert.equal(fx.repository.getChangeSet('cs_atomic').status, 'running');
  assert.throws(() => fx.repository.appendRevisionBatch({
    revisions: [root, child], workflowGraph: graph, transition,
    beforeCommit: () => { throw new Error('injected_batch_failure'); },
  }), /injected_batch_failure/);
  assert.equal(fx.repository.getRevision(root.revisionId), null);
  assert.equal(fx.repository.getRevision(child.revisionId), null);
  assert.equal(fx.repository.findWorkflowGraph({ projectId: 'p_1', sourceDigest: graph.sourceDigest }), null);
  assert.equal(fx.repository.getChangeSet('cs_atomic').status, 'running');

  const registered = fx.repository.appendRevisionBatch({ revisions: [root, child], workflowGraph: graph, transition });
  assert.deepEqual(registered.revisions.map((revision) => revision.revisionId), [root.revisionId, child.revisionId]);
  assert.equal(registered.workflowGraph.graphId, graph.graphId);
  assert.equal(registered.changeSet.status, 'preview_ready');
  assert.deepEqual(registered.changeSet.candidateArtifactRefs, [root.revisionId, child.revisionId]);

  fx.repository.createChangeSet({
    changeSetId: 'cs_atomic_ancestor', projectId: 'p_1', baseCommit: fx.sourceRevision.sourceCommit,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_atomic_ancestor', createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_atomic_ancestor', to: 'running' });
  const ancestorChild = revisionFromSource(fx, 'cs_atomic_ancestor', {
    revisionId: 'rev_atomic_ancestor_child', artifactFamilyId: 'go_family_ancestor',
    artifactId: 'go_bp_results', rendererId: 'go-kegg:go_bp_results',
    parentRevisionIds: [fx.sourceRevision.revisionId], toolJobId: 'tj_atomic_ancestor_child',
    outputPath: 'results/jobs/tj_atomic_ancestor_child/output/go.csv', outputHash: '9'.repeat(64),
  });
  const ancestorNodes = [
    {
      id: `job:${fx.sourceRevision.toolJobId}`, toolJobId: fx.sourceRevision.toolJobId,
      toolId: 'volcano-plot', artifactIds: [fx.sourceRevision.artifactId],
      provenanceHash: '7'.repeat(64), dependsOn: [],
    },
    {
      id: `job:${ancestorChild.toolJobId}`, toolJobId: ancestorChild.toolJobId,
      toolId: 'go-kegg', artifactIds: [ancestorChild.artifactId],
      provenanceHash: '8'.repeat(64), dependsOn: [`job:${fx.sourceRevision.toolJobId}`],
    },
  ];
  const ancestorEdges = [{
    kind: 'artifact', fromNodeId: `job:${fx.sourceRevision.toolJobId}`,
    toNodeId: `job:${ancestorChild.toolJobId}`,
    sourceToolJobId: fx.sourceRevision.toolJobId,
    sourceRevisionId: fx.sourceRevision.revisionId,
    sourceArtifactId: fx.sourceRevision.artifactId,
    sourceOutputHash: fx.sourceRevision.outputHash,
    selectionId: null, selectionHash: null, inputId: fx.sourceRevision.artifactId,
  }];
  const ancestorGraph = graphFor({
    graphNodes: ancestorNodes,
    graphEdges: ancestorEdges,
    rootToolJobId: fx.sourceRevision.toolJobId,
  });
  const ancestorRegistered = fx.repository.appendRevisionBatch({
    revisions: [ancestorChild],
    workflowGraph: ancestorGraph,
    transition: {
      changeSetId: 'cs_atomic_ancestor', to: 'preview_ready',
      candidateCommit: fx.sourceRevision.sourceCommit,
      candidateArtifactRefs: [ancestorChild.revisionId],
      jobRefs: [ancestorChild.toolJobId],
      validationSummary: {
        workflowGraph: { graphId: ancestorGraph.graphId, sourceDigest: ancestorGraph.sourceDigest },
      },
    },
  });
  assert.equal(ancestorRegistered.changeSet.status, 'preview_ready');
  assert.deepEqual(ancestorRegistered.changeSet.jobRefs, [ancestorChild.toolJobId]);
  assert.deepEqual(ancestorRegistered.workflowGraph.nodes.map((node) => node.toolJobId),
    [fx.sourceRevision.toolJobId, ancestorChild.toolJobId]);
});

test('P5 revert restores the exact same-family parent instead of a higher unrelated ordinal', (context) => {
  const fx = fixture(context, 'p5-revert-parent-');
  fx.repository.createChangeSet({
    changeSetId: 'cs_decoy', projectId: 'p_1', baseCommit: fx.sourceRevision.sourceCommit,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_decoy', createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_decoy', to: 'running' });
  const decoy = fx.repository.appendRevision(revisionFromSource(fx, 'cs_decoy', {
    revisionId: 'rev_decoy', parentRevisionIds: [fx.sourceRevision.revisionId], toolJobId: 'tj_decoy',
  }));

  fx.repository.createChangeSet({
    changeSetId: 'cs_exact_parent', projectId: 'p_1', baseCommit: fx.sourceRevision.sourceCommit,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_exact_parent', createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId: 'cs_exact_parent', to: 'running' });
  const candidateInput = revisionFromSource(fx, 'cs_exact_parent', {
    revisionId: 'rev_exact_parent_candidate', parentRevisionIds: [fx.sourceRevision.revisionId], toolJobId: 'tj_exact_parent',
  });
  fx.repository.appendRevisionBatch({
    revisions: [candidateInput],
    transition: {
      changeSetId: 'cs_exact_parent', to: 'preview_ready', candidateCommit: fx.sourceRevision.sourceCommit,
      candidateArtifactRefs: [candidateInput.revisionId], jobRefs: [candidateInput.toolJobId],
    },
  });
  fx.repository.adoptChangeSet({ changeSetId: 'cs_exact_parent' });
  assert.equal(fx.repository.getCurrentRevision(fx.sourceRevision.artifactFamilyId).revisionId, candidateInput.revisionId);

  const reverted = fx.repository.revertChangeSet({ changeSetId: 'cs_exact_parent' });
  assert.deepEqual(reverted.restoredRevisionIds, [fx.sourceRevision.revisionId]);
  assert.equal(fx.repository.getCurrentRevision(fx.sourceRevision.artifactFamilyId).revisionId, fx.sourceRevision.revisionId);
  assert.equal(decoy.revisionOrdinal > fx.sourceRevision.revisionOrdinal, true, 'decoy demonstrates why ordinal fallback is wrong');
});

test('P5 restore eligibility excludes interrupted, preview, failed, discarded and partial ChangeSets', (context) => {
  const fx = fixture(context, 'p5-restore-status-');
  const createRunning = (changeSetId) => {
    fx.repository.createChangeSet({
      changeSetId, projectId: 'p_1', baseCommit: fx.sourceRevision.sourceCommit,
      workingBranchRef: `refs/heads/biof3/changeset/${changeSetId}`, createdBy: 'agent',
    });
    fx.repository.transitionChangeSet({ changeSetId, to: 'running' });
  };
  createRunning('cs_restore_legacy_partial');
  const legacyPartial = fx.repository.appendRevision(revisionFromSource(fx, 'cs_restore_legacy_partial', {
    revisionId: 'rev_restore_legacy_partial', artifactFamilyId: 'family_restore_legacy_partial',
    toolJobId: 'tj_restore_legacy_partial',
  }));
  fx.repository.transitionChangeSet({
    changeSetId: 'cs_restore_legacy_partial', to: 'preview_ready',
    candidateCommit: fx.sourceRevision.sourceCommit,
  });
  fx.repository.adoptChangeSet({ changeSetId: 'cs_restore_legacy_partial' });
  assert.throws(
    () => fx.repository.resolveRestorableRevision({ revisionId: legacyPartial.revisionId, projectId: 'p_1' }),
    (error) => error.code === 'revision_restore_change_set_partial',
    'legacy adopted row without a complete candidate cohort is fail-closed'
  );

  createRunning('cs_restore_running');
  const running = fx.repository.appendRevision(revisionFromSource(fx, 'cs_restore_running', {
    revisionId: 'rev_restore_running', artifactFamilyId: 'family_restore_running', toolJobId: 'tj_restore_running',
  }));
  assert.throws(() => fx.repository.resolveRestorableRevision({ revisionId: running.revisionId, projectId: 'p_1' }),
    (error) => error.code === 'revision_restore_status_forbidden');

  createRunning('cs_restore_preview');
  const previewInput = revisionFromSource(fx, 'cs_restore_preview', {
    revisionId: 'rev_restore_preview', artifactFamilyId: 'family_restore_preview', toolJobId: 'tj_restore_preview',
  });
  fx.repository.appendRevisionBatch({
    revisions: [previewInput],
    transition: {
      changeSetId: 'cs_restore_preview', to: 'preview_ready', candidateCommit: fx.sourceRevision.sourceCommit,
      candidateArtifactRefs: [previewInput.revisionId], jobRefs: [previewInput.toolJobId],
    },
  });
  assert.throws(() => fx.repository.resolveRestorableRevision({ revisionId: previewInput.revisionId, projectId: 'p_1' }),
    (error) => error.code === 'revision_restore_status_forbidden');
  fx.repository.revertChangeSet({ changeSetId: 'cs_restore_preview' });
  assert.throws(() => fx.repository.resolveRestorableRevision({ revisionId: previewInput.revisionId, projectId: 'p_1' }),
    (error) => error.code === 'revision_restore_never_adopted');

  createRunning('cs_restore_failed');
  const failed = fx.repository.appendRevision(revisionFromSource(fx, 'cs_restore_failed', {
    revisionId: 'rev_restore_failed', artifactFamilyId: 'family_restore_failed', toolJobId: 'tj_restore_failed',
  }));
  fx.repository.transitionChangeSet({ changeSetId: 'cs_restore_failed', to: 'validation_failed', reason: 'injected' });
  assert.throws(() => fx.repository.resolveRestorableRevision({ revisionId: failed.revisionId, projectId: 'p_1' }),
    (error) => error.code === 'revision_restore_status_forbidden');

  createRunning('cs_restore_formal');
  const formalInput = revisionFromSource(fx, 'cs_restore_formal', {
    revisionId: 'rev_restore_formal', parentRevisionIds: [fx.sourceRevision.revisionId], toolJobId: 'tj_restore_formal',
  });
  fx.repository.appendRevisionBatch({
    revisions: [formalInput],
    transition: {
      changeSetId: 'cs_restore_formal', to: 'preview_ready', candidateCommit: fx.sourceRevision.sourceCommit,
      candidateArtifactRefs: [formalInput.revisionId], jobRefs: [formalInput.toolJobId],
    },
  });
  fx.repository.adoptChangeSet({ changeSetId: 'cs_restore_formal' });
  assert.equal(fx.repository.resolveRestorableRevision({ revisionId: formalInput.revisionId, projectId: 'p_1' }).revision.revisionId, formalInput.revisionId);
  fx.repository.revertChangeSet({ changeSetId: 'cs_restore_formal' });
  assert.equal(fx.repository.resolveRestorableRevision({ revisionId: formalInput.revisionId, projectId: 'p_1' }).changeSet.status, 'reverted');
});

test('P5 records an exact ReplayPackage proof before atomically upgrading the adopted cohort', (context) => {
  const fx = fixture(context, 'p5-replay-proof-');
  const createRunning = (changeSetId) => {
    fx.repository.createChangeSet({
      changeSetId, projectId: 'p_1', baseCommit: fx.sourceRevision.sourceCommit,
      workingBranchRef: `refs/heads/biof3/changeset/${changeSetId}`, createdBy: 'agent',
    });
    fx.repository.transitionChangeSet({ changeSetId, to: 'running' });
  };
  createRunning('cs_proof_source');
  const sourceInput = revisionFromSource(fx, 'cs_proof_source', {
    revisionId: 'rev_proof_source', parentRevisionIds: [fx.sourceRevision.revisionId], toolJobId: 'tj_proof_source',
    outputPath: 'results/jobs/tj_proof_source/output/volcano.png',
  });
  fx.repository.appendRevisionBatch({
    revisions: [sourceInput],
    transition: {
      changeSetId: 'cs_proof_source', to: 'preview_ready', candidateCommit: fx.sourceRevision.sourceCommit,
      candidateArtifactRefs: [sourceInput.revisionId], jobRefs: [sourceInput.toolJobId],
      validationSummary: { artifactTruthStatus: 'valid' },
    },
  });
  fx.repository.adoptChangeSet({ changeSetId: 'cs_proof_source' });

  createRunning('cs_proof_replay');
  const replayInput = revisionFromSource(fx, 'cs_proof_replay', {
    revisionId: 'rev_proof_replay', parentRevisionIds: [sourceInput.revisionId], toolJobId: 'tj_proof_replay',
    outputPath: 'results/jobs/tj_proof_replay/output/volcano.png', outputHash: sourceInput.outputHash,
  });
  fx.repository.appendRevisionBatch({
    revisions: [replayInput],
    transition: {
      changeSetId: 'cs_proof_replay', to: 'preview_ready', candidateCommit: fx.sourceRevision.sourceCommit,
      candidateArtifactRefs: [replayInput.revisionId], jobRefs: [replayInput.toolJobId],
    },
  });
  const proof = {
    sourceRevisionId: sourceInput.revisionId,
    replayRevisionId: replayInput.revisionId,
    replayToolJobId: replayInput.toolJobId,
    sourceOutputHash: sourceInput.outputHash,
    replayOutputHash: replayInput.outputHash,
  };
  assert.throws(() => fx.repository.recordReplayProofAndVerifyCohort({
    projectId: 'p_1', changeSetId: 'cs_proof_source', replayPackageDigest: '9'.repeat(64),
    proofs: [{ ...proof, replayOutputHash: '8'.repeat(64) }],
  }), (error) => error.code === 'replay_proof_output_mismatch');
  assert.equal(fx.repository.getRevision(sourceInput.revisionId).reproducibilityStatus, 'available');

  assert.throws(() => fx.repository.recordReplayProofAndVerifyCohort({
    projectId: 'p_1', changeSetId: 'cs_proof_source', replayPackageDigest: '9'.repeat(64), proofs: [proof],
    beforeCommit: () => { throw new Error('injected_replay_proof_failure'); },
  }), /injected_replay_proof_failure/);
  assert.equal(fx.repository.getRevision(sourceInput.revisionId).reproducibilityStatus, 'available');
  assert.equal(fx.repository.getChangeSet('cs_proof_source').validationSummary.replayProof, undefined);

  const verified = fx.repository.recordReplayProofAndVerifyCohort({
    projectId: 'p_1', changeSetId: 'cs_proof_source', replayPackageDigest: '9'.repeat(64), proofs: [proof],
  });
  assert.equal(verified.revisions[0].reproducibilityStatus, 'verified');
  assert.equal(verified.replayProof.exactMatch, true);
  assert.equal(verified.changeSet.validationSummary.replayProof.outputs[0].replayToolJobId, replayInput.toolJobId);
  assert.equal(fx.repository.getRevision(replayInput.revisionId).reproducibilityStatus, 'available');
  assert.equal(fx.repository.recordReplayProofAndVerifyCohort({
    projectId: 'p_1', changeSetId: 'cs_proof_source', replayPackageDigest: '9'.repeat(64), proofs: [proof],
  }).idempotent, true);
});

test('RS5 AI and manual edits use the same ChangeSet and Revision contracts', async (context) => {
  const agentFx = fixture(context, 'origin-agent-');
  const agent = await createResultChangeSet(request(agentFx, { createdBy: 'agent' }), serviceDependencies(agentFx, {
    executeJob: successfulExecutor(agentFx, 'AGENT'),
  }));
  const userFx = fixture(context, 'origin-user-');
  const user = await createResultChangeSet(request(userFx, { createdBy: 'user' }), serviceDependencies(userFx, {
    executeJob: successfulExecutor(userFx, 'USER'),
  }));
  assert.equal(agent.changeSet.contractVersion, user.changeSet.contractVersion);
  assert.equal(agent.revision.contractVersion, user.revision.contractVersion);
  assert.equal(agent.changeSet.createdBy, 'agent');
  assert.equal(user.changeSet.createdBy, 'user');
  assert.equal(agent.changeSet.status, user.changeSet.status);
});

test('RS5 prefixes Git paths for a project nested in an existing repository', async (context) => {
  const fx = fixture(context, 'git-prefix-');
  const result = await createResultChangeSet(request(fx), serviceDependencies(fx, {
    executeJob: successfulExecutor(fx, 'PREFIX'),
    gitPathPrefix: 'projects/p_1',
  }));
  assert.equal(
    fx.adapter.showFile({
      ref: result.candidateCommit,
      filePath: `projects/p_1/${result.materialization.scriptRelativePath}`,
    }).includes('blue'),
    true
  );
  assert.equal(result.revision.sourceScriptRef.relativePath, result.materialization.scriptRelativePath);
});

test('RS5 failed and cancelled execution never changes the current Revision', async (context) => {
  const failedFx = fixture(context, 'failed-');
  await assert.rejects(() => createResultChangeSet(request(failedFx), serviceDependencies(failedFx, {
    executeJob: async () => ({ job: { id: 'tj_failed', project_id: 'p_1', status: 'failed' } }),
  })), (error) => error.code === 'candidate_job_failed');
  const failed = failedFx.repository.listChangeSets({ projectId: 'p_1' }).find((cs) => cs.changeSetId !== 'cs_source');
  assert.equal(failed.status, 'validation_failed');
  assert.equal(failedFx.repository.getCurrentRevision('volcano_family').revisionId, 'rev_source');
  assert.equal(failedFx.repository.listRevisionsByChangeSet(failed.changeSetId).length, 0);

  const cancelledFx = fixture(context, 'cancelled-');
  let checks = 0;
  await assert.rejects(() => createResultChangeSet(request(cancelledFx), serviceDependencies(cancelledFx, {
    executeJob: successfulExecutor(cancelledFx), shouldCancel: () => ++checks >= 2,
  })), (error) => error.code === 'edit_cancelled');
  const cancelled = cancelledFx.repository.listChangeSets({ projectId: 'p_1' }).find((cs) => cs.changeSetId !== 'cs_source');
  assert.equal(cancelled.status, 'abandoned');
  assert.equal(cancelledFx.repository.getCurrentRevision('volcano_family').revisionId, 'rev_source');
});

test('P5 preserves redacted Git invocation diagnostics when candidate materialization fails', async (context) => {
  const fx = fixture(context, 'git-failure-diagnostic-');
  const gitFailure = new Error('Cannot write isolated Git blob.');
  gitFailure.name = 'GitAdapterError';
  gitFailure.code = 'git_hash_object_failed';
  gitFailure.detail = {
    command: 'hash-object',
    status: null,
    systemCode: 'ETIMEDOUT',
    signal: 'SIGTERM',
    killed: true,
    attempts: 2,
    stderr: 'spawnSync git ETIMEDOUT',
  };
  const failingAdapter = {
    ...fx.adapter,
    commitVirtualFiles() { throw gitFailure; },
  };
  let rejected = null;
  await assert.rejects(() => createResultChangeSet(request(fx), serviceDependencies(fx, {
    adapter: failingAdapter,
    executeJob: successfulExecutor(fx),
  })), (error) => {
    rejected = error;
    return error.code === 'result_edit_failed';
  });
  assert.equal(rejected.detail.causeCode, 'git_hash_object_failed');
  assert.deepEqual(rejected.detail.gitFailure, {
    operation: 'git_hash_object_failed',
    command: 'hash-object',
    status: null,
    systemCode: 'ETIMEDOUT',
    signal: 'SIGTERM',
    killed: true,
    attempts: 2,
    stderr: 'spawnSync git ETIMEDOUT',
  });
  const failed = fx.repository.listChangeSets({ projectId: 'p_1', status: 'validation_failed' })[0];
  assert.equal(failed.validationSummary.error, 'git_hash_object_failed');
  assert.deepEqual(failed.validationSummary.gitFailure, rejected.detail.gitFailure);
});

test('RS5 blocks cross-project sources before creating a ChangeSet', async (context) => {
  const fx = fixture(context, 'scope-');
  await assert.rejects(() => createResultChangeSet(request(fx, {
    sourceRevision: { ...fx.sourceRevision, projectId: 'p_other' },
  }), serviceDependencies(fx, { executeJob: successfulExecutor(fx) })),
  (error) => error.code === 'source_revision_mismatch');
  assert.equal(fx.repository.listChangeSets({ projectId: 'p_1' }).length, 1);
});

test('RS5 scientific edits require confirmation before any ChangeSet write', async (context) => {
  const fx = fixture(context, 'confirm-');
  const scientificIntent = {
    ...fx.intent,
    editClass: 'scientific_recompute',
    requiresScientificConfirmation: true,
    proposedParameterPatch: { padj_cutoff: 0.01 },
    workflowGraph: { graphId: 'wfg_test_scientific', sourceDigest: 'a'.repeat(64) },
  };
  await assert.rejects(() => createResultChangeSet(request(fx, { intent: scientificIntent }), serviceDependencies(fx, {
    executeJob: successfulExecutor(fx),
  })), (error) => error.code === 'scientific_confirmation_required');
  assert.equal(fx.repository.listChangeSets({ projectId: 'p_1' }).length, 1);
});

test('RS5 recovery reports durable materialization and never marks interrupted work adoptable', (context) => {
  const fx = fixture(context, 'recovery-');
  const changeSetId = 'cs_interrupted';
  fx.repository.createChangeSet({
    changeSetId, projectId: 'p_1', baseCommit: fx.sourceRevision.sourceCommit,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_interrupted', createdBy: 'agent',
  });
  fx.repository.transitionChangeSet({ changeSetId, to: 'running' });
  const materialized = materializeResultEdit({
    workspaceRoot: fx.workspaceRoot, changeSetId, revisionId: 'rev_interrupted',
    artifactFamilyId: 'volcano_family', artifactId: 'volcano_plot', pluginId: 'volcano-plot',
    sourceScriptContent: fx.sourceScriptContent, normalizedSourceParams: {}, proposedParameterPatch: {},
  });
  fx.adapter.commitVirtualFiles({
    parentCommit: fx.sourceRevision.sourceCommit,
    ref: 'refs/heads/biof3/changeset/cs_interrupted', expectedOld: '0'.repeat(40),
    message: 'interrupted', files: materialized.gitFiles,
  });
  const recovery = inspectResultEditRecovery({
    repository: fx.repository, adapter: fx.adapter, workspaceRoot: fx.workspaceRoot, projectId: 'p_1',
  });
  const interrupted = recovery.find((entry) => entry.changeSet.changeSetId === changeSetId);
  assert.equal(interrupted.recovery, 'resume_from_materialized_candidate');
  assert.equal(interrupted.materializationPresent, true);
  assert.match(interrupted.candidateCommit, /^[a-f0-9]{40}$/);
  assert.equal(interrupted.safeToAdopt, false);
});

test('RS5 execution bridge accepts only a hashed script inside the ChangeSet root', (context) => {
  const fx = fixture(context, 'bridge-');
  const root = join(fx.workspaceRoot, '.biof3/revision/cs_bridge');
  mkdirSync(root, { recursive: true });
  const script = join(root, 'run-script.R');
  writeFileSync(script, 'print(1)\n');
  const dbModule = { getProject: () => ({ workspace_path: fx.workspaceRoot }) };
  assert.equal(resolveResultStudioScriptOverride({
    override: { changeSetId: 'cs_bridge', path: script, sha256: sha256(readFileSync(script)) },
    plugin: { language: 'r' }, projectId: 'p_1', dbModule,
  }), realpathSync(script));
  assert.throws(() => resolveResultStudioScriptOverride({
    override: { changeSetId: 'cs_bridge', path: script, sha256: '0'.repeat(64) },
    plugin: { language: 'r' }, projectId: 'p_1', dbModule,
  }), /materialized_script_hash_mismatch/);
  const outside = join(fx.workspaceRoot, 'outside.R');
  writeFileSync(outside, 'print(2)\n');
  if (SYMLINKS_SUPPORTED) {
    const link = join(root, 'escape.R');
    symlinkSync(outside, link);
    // SEC-001: Symlinks are rejected before path traversal check
    assert.throws(() => resolveResultStudioScriptOverride({
      override: { changeSetId: 'cs_bridge', path: link, sha256: sha256(readFileSync(outside)) },
      plugin: { language: 'r' }, projectId: 'p_1', dbModule,
    }), /materialized_script_symlink_rejected/);
  }
});
