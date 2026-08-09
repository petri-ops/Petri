'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dbMod = require('../db');
const pluginLoader = require('../plugin-loader');
const { isPathContained } = require('../../shared-backend/project-run-layout');
const { createResultStudioRepository } = require('../../shared-backend/result-studio-repository');
const { assessSelectionCompatibility } = require('../../shared-backend/result-studio-contracts');
const { queryResultTable } = require('../../shared-backend/result-studio-table-query');
const { buildAuthoritativeWorkflowGraph } = require('../../shared-backend/result-workflow-graph');
const { bindProjectRepository } = require('../../shared-backend/git-repository-binding');
const { verifyRevisionSourceMaterial } = require('../../shared-backend/result-revision-source');

const MAX_DOWNSTREAM_ENTITY_IDS = 20_000;
const SAFE_SELECTION_ID = /^sel_[A-Za-z0-9_-]{1,160}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function materializationPathError(code, message) {
  throw Object.assign(new Error(message), { code });
}

function ensureSelectionMaterializationDirectory(workspaceRoot, selectionId) {
  if (!SAFE_SELECTION_ID.test(selectionId)) {
    materializationPathError('selection_id_invalid', 'SelectionContext id is not path-safe.');
  }
  let anchor;
  try {
    anchor = fs.realpathSync(path.resolve(workspaceRoot));
  } catch {
    materializationPathError('selection_workspace_unavailable', 'Selection workspace is unavailable.');
  }
  if (!fs.statSync(anchor).isDirectory()) {
    materializationPathError('selection_workspace_unavailable', 'Selection workspace is not a directory.');
  }

  let current = anchor;
  for (const component of ['analysis', 'selections', selectionId]) {
    const candidate = path.join(current, component);
    if (!isPathContained(anchor, candidate) || path.dirname(candidate) !== current) {
      materializationPathError('selection_materialization_path_escape', 'Selection materialization escaped its workspace.');
    }
    let stat;
    try {
      stat = fs.lstatSync(candidate);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        materializationPathError('selection_materialization_path_unavailable', 'Selection materialization directory is unavailable.');
      }
      try {
        fs.mkdirSync(candidate, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError?.code !== 'EEXIST') {
          materializationPathError('selection_materialization_path_unavailable', 'Selection materialization directory could not be created.');
        }
      }
      stat = fs.lstatSync(candidate);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      materializationPathError('selection_materialization_path_unsafe', 'Selection materialization directories must be real directories.');
    }
    const canonical = fs.realpathSync(candidate);
    if (!isPathContained(anchor, canonical) || path.dirname(canonical) !== current) {
      materializationPathError('selection_materialization_path_escape', 'Selection materialization directory escaped its workspace.');
    }
    current = canonical;
  }
  const stat = fs.statSync(current);
  return { anchor, directory: current, dev: stat.dev, ino: stat.ino };
}

function atomicWriteSelectionFile(workspaceRoot, selectionId, fileName, content) {
  if (!fileName || path.basename(fileName) !== fileName || fileName.includes('\0')) {
    materializationPathError('selection_materialization_file_invalid', 'Selection materialization filename is invalid.');
  }
  const directory = ensureSelectionMaterializationDirectory(workspaceRoot, selectionId);
  const target = path.join(directory.directory, fileName);
  let existing = null;
  try { existing = fs.lstatSync(target); } catch (error) {
    if (error?.code !== 'ENOENT') {
      materializationPathError('selection_materialization_file_unavailable', 'Selection materialization file is unavailable.');
    }
  }
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
    materializationPathError('selection_materialization_path_unsafe', 'Selection materialization target must be a regular file.');
  }

  const temporary = path.join(
    directory.directory,
    `.selection-write-${process.pid}-${crypto.randomBytes(16).toString('hex')}`,
  );
  const noFollow = Number.isInteger(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0;
  let fd = null;
  let temporaryCreated = false;
  try {
    fd = fs.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
      0o600,
    );
    temporaryCreated = true;
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;

    const current = ensureSelectionMaterializationDirectory(workspaceRoot, selectionId);
    if (current.directory !== directory.directory
        || current.dev !== directory.dev
        || current.ino !== directory.ino) {
      materializationPathError('selection_materialization_path_changed', 'Selection materialization directory changed during the write.');
    }
    let currentTarget = null;
    try { currentTarget = fs.lstatSync(target); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (currentTarget && (currentTarget.isSymbolicLink() || !currentTarget.isFile())) {
      materializationPathError('selection_materialization_path_unsafe', 'Selection materialization target changed to an unsafe entry.');
    }
    fs.renameSync(temporary, target);
    temporaryCreated = false;
    const written = fs.lstatSync(target);
    const canonical = fs.realpathSync(target);
    if (written.isSymbolicLink() || !written.isFile()
        || !isPathContained(directory.directory, canonical)) {
      materializationPathError('selection_materialization_path_unsafe', 'Selection materialization file failed containment verification.');
    }
    return canonical;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    if (temporaryCreated) {
      try { fs.unlinkSync(temporary); } catch {}
    }
  }
}

function fail(error, message, detail = null) {
  return { ok: false, error, message, detail };
}

function parseJobResult(job) {
  if (!job) return {};
  if (job.result && typeof job.result === 'object') return job.result;
  try { return JSON.parse(job.result_json || '{}'); } catch { return {}; }
}

function artifactFileName(artifact) {
  const value = artifact?.filename || artifact?.name || artifact?.path || '';
  return value ? path.basename(String(value)) : '';
}

function resolveBackingArtifactTruth({ sourceJob, descriptor, mapping, backingName, sourcePath }) {
  const result = parseJobResult(sourceJob);
  if (result.artifactTruth?.status !== 'valid' || result.artifactTruth?.blocking === true) {
    return fail('selection_backing_data_untrusted', 'backing data 未进入同一 valid Artifact Truth');
  }
  const declared = Array.isArray(descriptor?.artifacts) ? descriptor.artifacts : [];
  const descriptors = mapping?.dataArtifactId
    ? declared.filter((artifact) => artifact?.id === mapping.dataArtifactId)
    : declared.filter((artifact) => artifactFileName(artifact) === backingName);
  if (descriptors.length !== 1 || !descriptors[0]?.id) {
    return fail('selection_backing_data_untrusted', 'backing data 没有唯一的插件 Artifact 声明');
  }
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  const matches = artifacts.filter((artifact) => artifact?.id === descriptors[0].id);
  if (matches.length !== 1 || artifactFileName(matches[0]) !== backingName) {
    return fail('selection_backing_data_untrusted', 'backing data 没有唯一的 Job Artifact Truth 记录');
  }
  let artifactPath;
  try { artifactPath = fs.realpathSync(matches[0].path); } catch {
    return fail('selection_backing_data_untrusted', 'backing data 的 Artifact Truth 路径不可用');
  }
  const expectedSha256 = String(matches[0].sha256 || '').trim().toLowerCase();
  if (artifactPath !== sourcePath || !SHA256_PATTERN.test(expectedSha256)) {
    return fail('selection_backing_data_untrusted', 'backing data 未精确绑定到 Job Artifact Truth');
  }
  return { ok: true, expectedSha256 };
}

function enumValue(value, allowed, fallback) {
  const candidate = String(value || fallback).trim();
  return allowed.includes(candidate) ? candidate : null;
}

function boundedNumber(value, { fallback, minimum, maximum }) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function persistVerifiedWorkflowGraph({ projectId, sourceToolJobId, repository, executed, dependencies }) {
  const listProjectToolJobsForWorkflow = dependencies.listProjectToolJobsForWorkflow
    || dbMod.listProjectToolJobsForWorkflow;
  if (!executed || !executed.ok || !executed.toolJobId
      || typeof listProjectToolJobsForWorkflow !== 'function') {
    return { ok: false, diagnostics: [{ code: 'workflow_execution_truth_missing' }] };
  }
  const buildWorkflowGraph = dependencies.buildAuthoritativeWorkflowGraph
    || buildAuthoritativeWorkflowGraph;
  const graph = buildWorkflowGraph({
    projectId,
    sourceToolJobId,
    jobs: listProjectToolJobsForWorkflow(projectId),
    repository,
    requiredToolJobIds: [executed.toolJobId],
  });
  if (!graph.ok) return { ok: false, diagnostics: graph.diagnostics || [] };
  if (typeof repository.saveWorkflowGraph !== 'function') {
    return { ok: false, diagnostics: [{ code: 'workflow_graph_repository_unavailable' }] };
  }
  try {
    const saved = repository.saveWorkflowGraph(graph.graph);
    if (!saved || saved.graphId !== graph.graph.graphId || saved.sourceDigest !== graph.graph.sourceDigest
        || saved.validationStatus !== 'valid') {
      return { ok: false, diagnostics: [{ code: 'workflow_graph_persistence_mismatch' }] };
    }
    return { ok: true, graph: saved, diagnostics: [] };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [{
        code: error?.code || 'workflow_graph_persistence_failed',
        message: error?.message || 'Authoritative workflow graph persistence failed.',
      }],
    };
  }
}

function failClosedWorkflowAction(executed, workflowGraph) {
  if (workflowGraph.ok) return null;
  return fail(
    'workflow_graph_persistence_failed',
    '下游 Job 已完成，但权威工作流图无法验证并持久化；本次科学动作不能视为成功。',
    {
      toolJobId: executed?.toolJobId || null,
      executionCompleted: executed?.ok === true,
      diagnostics: workflowGraph.diagnostics || [],
    }
  );
}

function verifyImmutableRevision({ projectId, project, revision, repository, sourceJob, dependencies }) {
  const verifier = dependencies.verifyRevisionSourceMaterial || verifyRevisionSourceMaterial;
  let binding = dependencies.repositoryBinding || null;
  if (!dependencies.adapter && !binding) {
    const bindRepository = dependencies.bindProjectRepository || bindProjectRepository;
    const allowExistingRepository = repository.hasExistingRepositoryConsent?.(projectId) === true;
    binding = bindRepository({
      workspaceRoot: project.workspace_path,
      projectId,
      preferManaged: false,
      allowExistingRepository,
      createManagedIfMissing: false,
    });
  }
  const adapter = dependencies.adapter || binding?.adapter || null;
  if (!adapter && dependencies.verifyRevisionSourceMaterial == null) {
    return fail(
      binding?.reason || 'revision_source_repository_unavailable',
      '正式 Revision 的不可变脚本、参数与输入快照不可用，不能启动下游重跑。'
    );
  }
  try {
    const projection = verifier({ projectId, revision }, {
      repository,
      adapter,
      gitPathPrefix: dependencies.gitPathPrefix != null
        ? dependencies.gitPathPrefix
        : binding?.mode === 'existing'
          ? binding.inspection?.existing?.workspaceRelativeToRepository
          : '',
      workspaceRoot: project.workspace_path,
      getToolJob: dependencies.getToolJob || (() => sourceJob),
    });
    if (projection?.reproduction?.inputDrift?.length > 0) {
      return fail('source_input_drift', '正式 Revision 的一个或多个输入 hash 已变化，不能启动下游重跑。');
    }
    return { ok: true, projection };
  } catch (error) {
    return fail(
      error?.code || 'revision_source_verification_failed',
      error?.message || '正式 Revision 的不可变来源材料验证失败。',
      error?.detail || null
    );
  }
}

/**
 * Continue a current DEG Revision into GO/KEGG using its immutable Artifact
 * bytes.  This intentionally takes a server-resolved revision id: a model
 * never supplies a file path, a tool id, or a lineage object.  Unlike the
 * selection route, this direct edge lets a later DEG-threshold candidate
 * truthfully invalidate and rerun enrichment from the full DEG table.
 */
async function tool_result_enrichment_from_revision(args, ctx, dependencies = {}) {
  const projectId = String(ctx?.projectId || '').trim();
  const revisionId = String(args?.revisionId || '').trim();
  if (!ctx?.userId) return fail('unauthorized', '未授权');
  if (!projectId || !revisionId) return fail('revision_and_project_required', '需要当前项目和一个受信的 DEG Revision');

  const species = enumValue(args?.species, ['human', 'mouse'], 'human');
  const geneIdType = enumValue(args?.geneIdType, ['auto', 'SYMBOL', 'ENSEMBL', 'ENTREZID'], 'auto');
  const analysisType = enumValue(args?.analysisType, ['all', 'GO', 'GO-BP', 'GO-MF', 'GO-CC', 'KEGG'], 'all');
  const padjCutoff = boundedNumber(args?.padjCutoff, { fallback: 0.05, minimum: 0, maximum: 1 });
  const lfcCutoff = boundedNumber(args?.lfcCutoff, { fallback: 1, minimum: 0, maximum: 100 });
  if (!species || !geneIdType || !analysisType || padjCutoff == null || lfcCutoff == null) {
    return fail('enrichment_parameters_invalid', 'GO/KEGG 参数不在插件声明的允许范围内');
  }

  const sqlite = dependencies.sqlite || dbMod.getDatabase();
  const repository = dependencies.repository || createResultStudioRepository(sqlite);
  const revision = repository.getRevision(revisionId);
  if (!revision || revision.projectId !== projectId || revision.artifactId !== 'deg_table') {
    return fail('deg_revision_not_found', '当前项目没有可用于富集的正式 DEG 表版本');
  }
  const currentRevision = repository.getCurrentRevision(revision.artifactFamilyId, projectId);
  if (!currentRevision || currentRevision.revisionId !== revision.revisionId) {
    return fail('deg_revision_not_current', '只允许从当前 DEG Revision 派生新的富集；历史替代方案请先恢复为新 Revision');
  }
  const project = dependencies.getProject ? dependencies.getProject(projectId) : dbMod.getProject(projectId);
  if (!project?.workspace_path) return fail('project_workspace_missing', '项目工作区不可用');
  let workspaceRoot;
  let degPath;
  try {
    workspaceRoot = fs.realpathSync(project.workspace_path);
    degPath = fs.realpathSync(path.join(workspaceRoot, revision.outputPath));
  } catch {
    return fail('deg_artifact_missing', 'DEG Artifact 已缺失，不能继续富集');
  }
  if (!isPathContained(workspaceRoot, degPath) || !fs.statSync(degPath).isFile()) {
    return fail('deg_artifact_outside_project', 'DEG Artifact 不在项目工作区内');
  }
  if (!revision.outputHash || sha256File(degPath) !== revision.outputHash) {
    return fail('deg_artifact_hash_drift', 'DEG Artifact 已偏离其正式 Revision');
  }

  const sourceJob = dependencies.getToolJob ? dependencies.getToolJob(revision.toolJobId) : dbMod.getToolJob(revision.toolJobId);
  const sourceResult = parseJobResult(sourceJob);
  const sourceArtifactMatches = (Array.isArray(sourceResult.artifacts) ? sourceResult.artifacts : [])
    .filter((artifact) => artifact && artifact.id === revision.artifactId);
  if (!sourceJob || sourceJob.status !== 'completed' || String(sourceJob.project_id || sourceJob.projectId || '') !== projectId
      || sourceResult.artifactTruth?.status !== 'valid' || sourceResult.artifactTruth?.blocking === true
      || sourceArtifactMatches.length !== 1) {
    return fail('deg_source_truth_invalid', 'DEG Revision 没有可验证的 Job/Artifact Truth 来源');
  }
  const sourcePlugin = dependencies.getPluginManifest
    ? dependencies.getPluginManifest(sourceJob.tool_id || sourceJob.toolId)
    : pluginLoader.getPluginManifest(sourceJob.tool_id || sourceJob.toolId);
  const descriptor = sourcePlugin?.resultStudio;
  const artifactDescriptor = descriptor?.artifacts?.filter((artifact) => artifact && artifact.id === 'deg_table') || [];
  const mapping = descriptor?.interactionMappings?.filter((item) => item && item.artifactId === 'deg_table') || [];
  if (!descriptor || !Array.isArray(descriptor.actions) || !descriptor.actions.includes('derive_enrichment_input')
      || artifactDescriptor.length !== 1 || mapping.length !== 1 || mapping[0].idField !== 'gene') {
    return fail('deg_enrichment_action_not_declared', '来源插件没有声明稳定 gene_id 的富集派生契约');
  }
  const sourceVerification = verifyImmutableRevision({
    projectId, project, revision, repository, sourceJob, dependencies,
  });
  if (!sourceVerification.ok) return sourceVerification;

  const runTool = dependencies.runTool || require('./learning').tool_run_tool;
  const executed = await runTool({
    op: 'run',
    toolId: 'go-kegg',
    params: {
      deg_table: degPath,
      species,
      gene_id_type: geneIdType,
      analysis_type: analysisType,
      padj_cutoff: padjCutoff,
      lfc_cutoff: lfcCutoff,
    },
  }, {
    ...ctx,
    resultStudioInputLineage: {
      deg_table: {
        lineageVersion: 1,
        kind: 'artifact',
        sourceRevisionId: revision.revisionId,
        sourceToolJobId: revision.toolJobId,
        sourceArtifactId: revision.artifactId,
        sourceOutputHash: revision.outputHash,
        materializationHash: revision.outputHash,
      },
    },
  });
  const workflowGraph = persistVerifiedWorkflowGraph({
    projectId,
    sourceToolJobId: revision.toolJobId,
    repository,
    executed,
    dependencies,
  });
  const workflowFailure = failClosedWorkflowAction(executed, workflowGraph);
  if (workflowFailure) return workflowFailure;
  return {
    ...executed,
    enrichmentAction: {
      sourceRevisionId: revision.revisionId,
      sourceArtifactId: revision.artifactId,
      geneIdField: 'gene',
      parameters: { species, geneIdType, analysisType, padjCutoff, lfcCutoff },
      executorTruth: 'run_tool → tool_job → artifact truth',
      workflowGraph: workflowGraph.ok
        ? { graphId: workflowGraph.graph.graphId, sourceDigest: workflowGraph.graph.sourceDigest, validationStatus: workflowGraph.graph.validationStatus }
        : null,
      workflowDiagnostics: workflowGraph.ok ? [] : workflowGraph.diagnostics,
    },
  };
}

async function tool_result_selection_run(args, ctx, dependencies = {}) {
  const selectionId = String(args?.selectionId || '').trim();
  const action = String(args?.action || 'go_kegg').trim();
  const projectId = String(ctx?.projectId || '').trim();
  if (!ctx?.userId) return fail('unauthorized', '未授权');
  if (!selectionId || !projectId) return fail('selection_and_project_required', '需要 selectionId 和当前 projectId');
  if (!SAFE_SELECTION_ID.test(selectionId)) return fail('selection_id_invalid', 'SelectionContext id 不能用于项目路径');
  if (action !== 'go_kegg') return fail('selection_action_unsupported', '当前只允许已声明的 GO/KEGG 下游动作');

  const sqlite = dependencies.sqlite || dbMod.getDatabase();
  const repository = dependencies.repository || createResultStudioRepository(sqlite);
  const selection = repository.getSelection(selectionId);
  if (!selection) return fail('selection_not_found', '没有找到该 SelectionContext');
  if (selection.projectId !== projectId) return fail('selection_project_mismatch', '选择不属于当前项目');
  if (selection.displayState?.durable === false) return fail('selection_not_durable', '该选择没有稳定实体映射');
  if (selection.entityType !== 'gene') return fail('selection_entity_unsupported', 'GO/KEGG 目前只接受 gene 选择');

  const revision = selection.revisionId ? repository.getRevision(selection.revisionId) : null;
  if (!revision || revision.projectId !== projectId || revision.artifactId !== selection.artifactId) {
    return fail('selection_revision_invalid', '选择无法绑定到同项目的正式 ArtifactRevision');
  }
  const currentRevision = repository.getCurrentRevision(revision.artifactFamilyId);
  const compatibility = assessSelectionCompatibility({
    selection,
    projectId,
    artifactId: revision.artifactId,
    revisionId: currentRevision?.revisionId || null,
    selectionDurable: true,
  });
  if (compatibility.status !== 'compatible') {
    return fail('selection_not_compatible', '选择已过期或不可用于当前结果', compatibility);
  }

  const project = dependencies.getProject ? dependencies.getProject(projectId) : dbMod.getProject(projectId);
  if (!project?.workspace_path) return fail('project_workspace_missing', '项目工作区不可用');
  const workspaceRoot = fs.realpathSync(project.workspace_path);
  const revisionPath = fs.realpathSync(path.join(workspaceRoot, revision.outputPath));
  if (!isPathContained(workspaceRoot, revisionPath) || !fs.statSync(revisionPath).isFile()) {
    return fail('selection_source_outside_project', '选择来源不在项目工作区内');
  }
  if (!revision.outputHash || sha256File(revisionPath) !== revision.outputHash) {
    return fail('selection_source_hash_drift', '选择来源已偏离 Artifact Truth');
  }

  const sourceJob = dependencies.getToolJob ? dependencies.getToolJob(revision.toolJobId) : dbMod.getToolJob(revision.toolJobId);
  const sourcePlugin = dependencies.getPluginManifest
    ? dependencies.getPluginManifest(sourceJob?.tool_id)
    : pluginLoader.getPluginManifest(sourceJob?.tool_id);
  const descriptor = sourcePlugin?.resultStudio;
  const artifactDescriptor = descriptor?.artifacts?.find((item) =>
    item.id === revision.artifactId || item.filename === path.basename(revision.outputPath));
  const mapping = descriptor?.interactionMappings?.find((item) => item.artifactId === artifactDescriptor?.id);
  const idField = mapping?.idField || mapping?.rowIdField;
  if (!idField || !Array.isArray(descriptor?.actions) || !descriptor.actions.includes('derive_enrichment_input')) {
    return fail('selection_action_not_declared', '来源插件没有声明稳定 gene 映射或富集派生动作');
  }
  const sourceVerification = verifyImmutableRevision({
    projectId, project, revision, repository, sourceJob, dependencies,
  });
  if (!sourceVerification.ok) return sourceVerification;
  let backingName = path.basename(revision.outputPath);
  if (mapping.dataFile) backingName = mapping.dataFile;
  else if (mapping.dataArtifactId) {
    backingName = descriptor.artifacts.find((item) => item.id === mapping.dataArtifactId)?.filename || '';
  }
  if (!backingName || path.basename(backingName) !== backingName || backingName.includes('..')) {
    return fail('selection_backing_data_invalid', '插件 backing data 声明无效');
  }
  let sourcePath;
  try { sourcePath = fs.realpathSync(path.join(path.dirname(revisionPath), backingName)); }
  catch { return fail('selection_backing_data_missing', '选择 backing data 不存在'); }
  if (!isPathContained(path.dirname(revisionPath), sourcePath) || !fs.statSync(sourcePath).isFile()) {
    return fail('selection_backing_data_outside_job', '选择 backing data 不在同一 Job 输出中');
  }
  let expectedBackingSha256 = revision.outputHash;
  if (sourcePath !== revisionPath) {
    const backingTruth = resolveBackingArtifactTruth({
      sourceJob,
      descriptor,
      mapping,
      backingName,
      sourcePath,
    });
    if (!backingTruth.ok) return backingTruth;
    expectedBackingSha256 = backingTruth.expectedSha256;
  }

  let resolved;
  try {
    resolved = queryResultTable({
      filePath: sourcePath,
      expectedSha256: expectedBackingSha256,
      idField,
      filterExpression: selection.filterExpression,
      sort: selection.sort,
      limit: 1,
      includeEntityIds: true,
    });
  } catch (error) {
    return fail(error.code || 'selection_resolution_failed', error.message);
  }
  if (sha256File(sourcePath) !== expectedBackingSha256) {
    return fail('selection_backing_data_hash_drift', '选择 backing data 已偏离 Artifact Truth');
  }
  const sourceIds = resolved.resolvedEntityIds || [];
  let selectedIds;
  if (selection.entityIdsTruncated) {
    if (selection.entityIdCount !== resolved.selectionEvidence.entityIdCount
        || selection.entityIdsHash !== resolved.selectionEvidence.entityIdsHash
        || selection.filterHash !== resolved.filterHash) {
      return fail('selection_query_evidence_drift', '筛选结果已变化，不能静默复用旧选择');
    }
    selectedIds = sourceIds;
  } else {
    const explicitHash = crypto.createHash('sha256')
      .update(JSON.stringify([...selection.entityIds].sort()))
      .digest('hex');
    if (selection.entityIdsHash !== explicitHash) {
      return fail('selection_entity_hash_drift', '显式选择的实体摘要已变化，不能继续物化');
    }
    const available = new Set(sourceIds);
    selectedIds = selection.entityIds.filter((id) => available.has(id));
    if (selectedIds.length !== selection.entityIds.length) {
      return fail('selection_entity_missing', '部分选择实体已不在当前 Artifact 中');
    }
  }
  if (selectedIds.length < 3) return fail('selection_too_small', 'GO/KEGG 至少需要 3 个基因');
  if (selectedIds.length > MAX_DOWNSTREAM_ENTITY_IDS) {
    return fail('selection_too_large', `GO/KEGG 派生选择最多允许 ${MAX_DOWNSTREAM_ENTITY_IDS} 个基因`);
  }

  const relativeDir = path.posix.join('analysis', 'selections', selectionId);
  let idsFile;
  let scriptFile;
  let geneFile;
  try {
    idsFile = atomicWriteSelectionFile(
      workspaceRoot,
      selectionId,
      'selection-ids.json',
      `${JSON.stringify({ selectionId, entityType: 'gene', entityIds: selectedIds }, null, 2)}\n`,
    );
    scriptFile = atomicWriteSelectionFile(workspaceRoot, selectionId, 'materialize-selection.R', [
      '#!/usr/bin/env Rscript',
      '# Reproduce the exact SelectionContext-derived GO/KEGG input.',
      'suppressMessages(library(jsonlite))',
      '`%||%` <- function(a, b) if (is.null(a)) b else a',
      'args <- commandArgs(trailingOnly = TRUE)',
      'root <- if (length(args)) args[[1]] else getwd()',
      'payload <- fromJSON(file.path(root, "selection-ids.json"), simplifyVector = TRUE)',
      'write.csv(data.frame(gene = payload$entityIds), file.path(root, "gene-list.csv"), row.names = FALSE)',
      '',
    ].join('\n'));
    geneFile = atomicWriteSelectionFile(
      workspaceRoot,
      selectionId,
      'gene-list.csv',
      `gene\n${selectedIds.map(csvCell).join('\n')}\n`,
    );
  } catch (error) {
    return fail(
      error?.code || 'selection_materialization_failed',
      '选择物化路径不安全，未启动下游分析。',
    );
  }

  const runTool = dependencies.runTool || require('./learning').tool_run_tool;
  const resultStudioInputLineage = {
    deg_table: {
      lineageVersion: 1,
      kind: 'selection',
      sourceRevisionId: revision.revisionId,
      sourceToolJobId: revision.toolJobId,
      sourceArtifactId: revision.artifactId,
      sourceOutputHash: revision.outputHash,
      selectionId: selection.selectionId,
      selectionHash: selection.entityIdsHash,
      materializationHash: sha256File(geneFile),
    },
  };
  const executed = await runTool({
    op: 'run',
    toolId: 'go-kegg',
    params: {
      deg_table: geneFile,
      species: args?.species || 'human',
      gene_id_type: args?.geneIdType || 'auto',
      analysis_type: args?.analysisType || 'all',
    },
  }, { ...ctx, resultStudioInputLineage });

  // Once the real downstream Job is terminal, snapshot the graph projected
  // from its persisted provenance.  A failed/partial run never gains a DAG.
  const workflowGraph = persistVerifiedWorkflowGraph({
    projectId,
    sourceToolJobId: revision.toolJobId,
    repository,
    executed,
    dependencies,
  });
  const workflowFailure = failClosedWorkflowAction(executed, workflowGraph);
  if (workflowFailure) return workflowFailure;
  return {
    ...executed,
    selectionAction: {
      selectionId,
      action,
      entityIdCount: selectedIds.length,
      entityIdsHash: selection.entityIdsHash,
      sourceRevisionId: revision.revisionId,
      materialization: {
        script: path.posix.join(relativeDir, 'materialize-selection.R'),
        parameters: path.posix.join(relativeDir, 'selection-ids.json'),
        output: path.posix.join(relativeDir, 'gene-list.csv'),
      },
      executorTruth: 'run_tool → tool_job → artifact truth',
      workflowGraph: workflowGraph.ok
        ? { graphId: workflowGraph.graph.graphId, sourceDigest: workflowGraph.graph.sourceDigest, validationStatus: workflowGraph.graph.validationStatus }
        : null,
      workflowDiagnostics: workflowGraph.ok ? [] : workflowGraph.diagnostics,
    },
  };
}

module.exports = {
  MAX_DOWNSTREAM_ENTITY_IDS,
  tool_result_selection_run,
  tool_result_enrichment_from_revision,
};
