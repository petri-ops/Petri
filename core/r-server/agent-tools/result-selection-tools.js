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

const MAX_DOWNSTREAM_ENTITY_IDS = 20_000;
const SAFE_SELECTION_ID = /^sel_[A-Za-z0-9_-]{1,160}$/;

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, filePath);
}

function fail(error, message, detail = null) {
  return { ok: false, error, message, detail };
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
  if (!idField || !descriptor.actions.includes('derive_enrichment_input')) {
    return fail('selection_action_not_declared', '来源插件没有声明稳定 gene 映射或富集派生动作');
  }
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
  if (sourcePath !== revisionPath) {
    const artifacts = sourceJob?.result?.artifacts || sourceJob?.result?.files || [];
    const declaredBacking = artifacts.some((artifact) =>
      artifact?.name === backingName || artifact?.filename === backingName || path.basename(artifact?.path || '') === backingName);
    if (!declaredBacking || sourceJob?.result?.artifactTruth?.status !== 'valid') {
      return fail('selection_backing_data_untrusted', 'backing data 未进入同一 valid Artifact Truth');
    }
  }

  let resolved;
  try {
    resolved = queryResultTable({
      filePath: sourcePath,
      idField,
      filterExpression: selection.filterExpression,
      sort: selection.sort,
      limit: 1,
      includeEntityIds: true,
    });
  } catch (error) {
    return fail(error.code || 'selection_resolution_failed', error.message);
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
  const absoluteDir = path.join(workspaceRoot, ...relativeDir.split('/'));
  const idsFile = path.join(absoluteDir, 'selection-ids.json');
  const scriptFile = path.join(absoluteDir, 'materialize-selection.R');
  const geneFile = path.join(absoluteDir, 'gene-list.csv');
  atomicWrite(idsFile, `${JSON.stringify({ selectionId, entityType: 'gene', entityIds: selectedIds }, null, 2)}\n`);
  atomicWrite(scriptFile, [
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
  atomicWrite(geneFile, `gene\n${selectedIds.map(csvCell).join('\n')}\n`);

  const runTool = dependencies.runTool || require('./learning').tool_run_tool;
  const executed = await runTool({
    op: 'run',
    toolId: 'go-kegg',
    params: {
      deg_table: geneFile,
      species: args?.species || 'human',
      gene_id_type: args?.geneIdType || 'auto',
      analysis_type: args?.analysisType || 'all',
    },
  }, ctx);
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
    },
  };
}

module.exports = { MAX_DOWNSTREAM_ENTITY_IDS, tool_result_selection_run };
