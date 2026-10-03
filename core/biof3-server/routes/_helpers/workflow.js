'use strict';

/**
 * routes/_helpers/workflow.js — workflow 状态机共享 helper
 *
 * 抽自 `core/biof3-server/routes/result-studio.js` PHASE 2.1a 拆分 commit。
 * 类别：跨 repository / interaction / selection / context / artifact 状态机的胶水函数。
 *   - resolveInteractionBaselineRevision(...)         → interaction baseline 选择
 *   - baselineFailureDiagnostic(error)                 → 失败诊断格式化
 *   - resolveInteractionDescriptor(...)                → plugin → artifact 映射
 *   - backingArtifactName(interaction)                 → interaction → backing file
 *   - bindAuthoritativeQuerySelection(...)             → selection 权威性重算
 *   - resolveArtifactPath(...)                         → artifact 路径解析
 *
 * 循环依赖注意点：workflow.js 依赖 repository / validate / storage；
 * 那些 helper 通过 require() 内部反向引用，不会再回到 workflow.js，避免循环。
 */

const fs = require('fs');
const path = require('path');
const db = require('../../db');
const pluginLoader = require('../../plugin-loader');
const { resolveProjectRunLayout, isPathContained } = require('../../../shared-backend/project-run-layout');
const {
  inspectBaselineArtifactCohort,
  inspectPersistedArtifactCohort,
} = require('../../../shared-backend/result-changeset-service');
const {
  queryResultTable,
} = require('../../../shared-backend/result-studio-table-query');

const repository = require('./repository');
const validate = require('./validate');
require('./storage');

function resolveInteractionBaselineRevision({
  repository: repositoryInstance,
  projectId,
  sourceJob,
  artifactId,
  pluginDescriptor,
} = {}, dependencies = {}) {
  const existing = repositoryInstance.findRevisionByJobArtifact({
    projectId,
    toolJobId: sourceJob.id,
    artifactId,
  });
  if (!pluginDescriptor) {
    return {
      revision: existing,
      requiresEnsure: !existing,
      qualification: null,
    };
  }
  const inspectPersisted = dependencies.inspectPersistedArtifactCohort || inspectPersistedArtifactCohort;
  const persisted = inspectPersisted({
    projectId,
    sourceJob,
    artifactId,
    pluginId: sourceJob.tool_id,
    pluginDescriptor,
  }, { repository: repositoryInstance });
  if (persisted.qualified) {
    return {
      revision: persisted.revision,
      requiresEnsure: false,
      qualification: persisted,
    };
  }
  const inspect = dependencies.inspectBaselineArtifactCohort || inspectBaselineArtifactCohort;
  const qualification = inspect({
    projectId,
    sourceJob,
    artifactId,
    pluginId: sourceJob.tool_id,
    pluginDescriptor,
  }, { repository: repositoryInstance });
  return {
    revision: qualification.qualified ? qualification.revision : null,
    requiresEnsure: !qualification.qualified,
    qualification,
  };
}

function baselineFailureDiagnostic(error) {
  const diagnostic = {
    code: error && error.code || 'baseline_revision_unavailable',
    message: error && error.message || 'Baseline revision could not be registered.',
  };
  if (!String(diagnostic.code).startsWith('git_') || !error?.detail || typeof error.detail !== 'object') {
    return diagnostic;
  }
  const detail = error.detail;
  const technical = {};
  if (/^[a-z][a-z0-9-]*$/.test(String(detail.command || ''))) technical.command = detail.command;
  if (Number.isInteger(detail.status)) technical.status = detail.status;
  if (/^[A-Z][A-Z0-9_]*$/.test(String(detail.systemCode || ''))) technical.systemCode = detail.systemCode;
  if (/^SIG[A-Z0-9]+$/.test(String(detail.signal || ''))) technical.signal = detail.signal;
  if (detail.killed === true) technical.killed = true;
  if (Number.isInteger(detail.attempts) && detail.attempts > 0) technical.attempts = detail.attempts;
  if (Object.keys(technical).length > 0) diagnostic.technical = technical;
  return diagnostic;
}

function resolveInteractionDescriptor(toolId, artifactRecord, artifactName, dependencies = {}) {
  const getPluginManifest = dependencies.getPluginManifest || pluginLoader.getPluginManifest;
  const plugin = getPluginManifest(toolId);
  const descriptor = plugin?.resultStudio || null;
  if (!descriptor) return { descriptor: null, artifactDescriptor: null, mapping: null };
  const artifactDescriptor = descriptor.artifacts.find((artifact) =>
    artifact.id === artifactRecord?.id || artifact.filename === artifactName) || null;
  const mapping = artifactDescriptor
    ? descriptor.interactionMappings.find((item) => item.artifactId === artifactDescriptor.id) || null
    : null;
  return { descriptor, artifactDescriptor, mapping };
}

function backingArtifactName(interaction) {
  const { descriptor, mapping, artifactDescriptor } = interaction;
  if (!mapping) return null;
  if (mapping.dataFile) return mapping.dataFile;
  if (mapping.dataArtifactId) {
    return descriptor?.artifacts.find((artifact) => artifact.id === mapping.dataArtifactId)?.filename || null;
  }
  return artifactDescriptor?.filename || null;
}

/**
 * 把 artifact 名解析为工作区内的真实路径。
 *
 * 只允许 output/ 下的文件名，不接受路径分隔符或 `..`，
 * 再用 layout 派生的绝对路径做包含性复核。
 */
function resolveArtifactPath({ req, job, project, artifactName }, dependencies = {}) {
  if (typeof artifactName !== 'string' || artifactName.trim() === '') {
    return { error: { status: 400, code: 'artifact_required' } };
  }
  const name = artifactName.trim();
  if (name.includes('\0') || name.includes('/') || name.includes('\\') || name.includes('..')) {
    return { error: { status: 400, code: 'artifact_name_invalid' } };
  }
  const unavailable = repository.artifactTruthAvailability(job?.result);
  if (unavailable) return unavailable;
  const resolveLayout = dependencies.resolveProjectRunLayout || resolveProjectRunLayout;
  let layout;
  try {
    layout = resolveLayout({
      projectId: project.id,
      toolJobId: job.id,
      db,
      userId: validate.userId(req),
      skipPermissionCheck: validate.isAdminOrInternal(req),
      ensureDirs: false,
    });
  } catch (error) {
    return { error: { status: 409, code: 'layout_unavailable', message: error && error.message } };
  }
  const outputDir = layout.outputDir || path.join(layout.jobDir, 'output');
  // Some canonical plugins predate the unified output/ layout and persist
  // their declared artifacts directly under the Job directory.  The Job's
  // Artifact Truth already contains the authoritative path; derive from that
  // record first instead of pretending every valid artifact lives in output/.
  // The caller still supplies only an id/name (never a path), and the resolved
  // target must remain inside the canonical Job directory.
  const declared = Array.isArray(job?.result?.artifacts) ? job.result.artifacts : [];
  const declaredMatches = declared.filter((artifact) => artifact && (
    artifact.id === name
    || artifact.name === name
    || artifact.filename === name
    || path.basename(String(artifact.path || '')) === name
  ));
  if (declaredMatches.length === 0) return repository.artifactTruthError(
    'artifact_record_missing',
    'The selected file is not present in Job Artifact Truth.',
  );
  if (declaredMatches.length > 1) return repository.artifactTruthError(
    'artifact_identity_ambiguous',
    'The selected file does not resolve to one unique Artifact Truth record.',
  );
  let absolutePath;
  if (declaredMatches.length === 1 && declaredMatches[0].path) {
    try {
      const jobRoot = fs.realpathSync(layout.jobRoot || layout.jobDir);
      const declaredPath = fs.realpathSync(declaredMatches[0].path);
      if (!isPathContained(jobRoot, declaredPath) || !fs.statSync(declaredPath).isFile()) {
        return { error: { status: 400, code: 'artifact_outside_job' } };
      }
      absolutePath = declaredPath;
    } catch {
      return repository.artifactTruthError(
        'artifact_file_unavailable',
        'The selected Artifact file is unavailable.',
      );
    }
  }
  if (!absolutePath) {
    const absolute = path.resolve(outputDir, name);
    const resolvedOutput = path.resolve(outputDir);
    if (absolute !== resolvedOutput && !absolute.startsWith(resolvedOutput + path.sep)) {
      return { error: { status: 400, code: 'artifact_outside_output' } };
    }
    if (!fs.existsSync(absolute)) return repository.artifactTruthError(
      'artifact_file_unavailable',
      'The selected Artifact file is unavailable.',
    );
    absolutePath = absolute;
  }
  const binding = repository.findArtifactRecord(job.result, absolutePath, name);
  if (binding.error) return binding;
  return {
    absolutePath,
    layout,
    artifactRecord: binding.artifactRecord,
    expectedSha256: binding.expectedSha256,
  };
}

/**
 * Recompute a query-backed Selection from immutable Revision + Job Artifact
 * Truth. Browser-supplied count/hash/sample values are comparison inputs only;
 * none of them can become persisted Agent context without this exact read.
 */
function bindAuthoritativeQuerySelection({ req, project, selection, repository: repositoryInstance }, dependencies = {}) {
  if (!selection?.entityIdsTruncated || !selection.filterExpression) {
    return { selection, authoritative: false };
  }
  const reject = (code, message, status = 409) => ({ error: { status, code, message } });
  if (!selection.revisionId) {
    return reject('selection_revision_required', 'A query-backed selection requires one persisted Revision.');
  }
  const revision = repositoryInstance.getRevision(selection.revisionId);
  if (!revision
      || revision.projectId !== project.id
      || revision.artifactId !== selection.artifactId
      || !revision.toolJobId) {
    return reject('selection_revision_mismatch', 'Selection coordinates do not match persisted Revision truth.');
  }

  const getToolJob = dependencies.getToolJob || db.getToolJob;
  const storedJob = getToolJob(revision.toolJobId);
  if (!storedJob || storedJob.project_id !== project.id || storedJob.id !== revision.toolJobId) {
    return reject('selection_job_mismatch', 'Selection Revision has no matching source Job truth.');
  }
  const job = { ...storedJob, result: repository.parseToolJobResult(storedJob) };
  const resolveArtifact = dependencies.resolveArtifactPath || resolveArtifactPath;
  const selected = resolveArtifact({
    req,
    job,
    project,
    artifactName: revision.artifactId,
  });
  if (selected.error) return selected;
  if (selected.expectedSha256 !== revision.outputHash) {
    return reject('selection_revision_artifact_drift', 'Revision bytes do not match source Job Artifact Truth.');
  }

  const interaction = resolveInteractionDescriptor(
    job.tool_id,
    selected.artifactRecord,
    revision.artifactId,
    { getPluginManifest: dependencies.getPluginManifest },
  );
  const mapping = interaction.mapping;
  const idField = mapping?.idField || mapping?.rowIdField || null;
  if (!idField || !mapping?.entityType) {
    return reject('selection_mapping_unavailable', 'Source plugin has no stable entity mapping for this selection.');
  }
  if (selection.entityType !== mapping.entityType) {
    return reject('selection_entity_type_mismatch', 'Selection entity type does not match source plugin truth.');
  }

  const queryName = backingArtifactName(interaction) || revision.artifactId;
  const backing = queryName === revision.artifactId
    ? selected
    : resolveArtifact({ req, job, project, artifactName: queryName });
  if (backing.error) return backing;

  let query;
  try {
    query = (dependencies.queryResultTable || queryResultTable)({
      filePath: backing.absolutePath,
      expectedSha256: backing.expectedSha256,
      idField,
      filterExpression: selection.filterExpression,
      sort: selection.sort,
      offset: 0,
      limit: 1,
    });
  } catch (error) {
    return reject(error?.code || 'selection_query_recompute_failed', 'Selection query could not be recomputed from Artifact Truth.');
  }
  const afterRead = (dependencies.verifyArtifactRecordBytes || repository.verifyArtifactRecordBytes)(
    backing.artifactRecord,
    backing.absolutePath,
  );
  if (afterRead.error) return afterRead;

  const evidence = query?.selectionEvidence;
  const authoritativeSample = Array.isArray(evidence?.sampleEntityIds)
    ? [...new Set(evidence.sampleEntityIds.map((value) => String(value).trim()).filter(Boolean))]
    : [];
  const suppliedSample = [...new Set((selection.entityIds || []).map((value) => String(value).trim()).filter(Boolean))];
  const sameSample = JSON.stringify([...suppliedSample].sort())
    === JSON.stringify([...authoritativeSample].sort());
  if (!evidence
      || evidence.idField !== idField
      || !Number.isInteger(evidence.entityIdCount)
      || evidence.entityIdCount < 1
      || !/^[a-f0-9]{64}$/.test(String(evidence.entityIdsHash || ''))
      || selection.entityIdCount !== evidence.entityIdCount
      || selection.entityIdsHash !== evidence.entityIdsHash
      || selection.filterHash !== query.filterHash
      || !sameSample) {
    return reject(
      'selection_query_evidence_mismatch',
      'Browser selection evidence does not match the authoritative Artifact query.',
    );
  }

  return {
    authoritative: true,
    selection: {
      ...selection,
      entityIds: authoritativeSample,
      entityIdCount: evidence.entityIdCount,
      entityIdsTruncated: evidence.entityIdCount > authoritativeSample.length,
      entityIdsHash: evidence.entityIdsHash,
      filterHash: query.filterHash,
      filterExpression: query.filterExpression,
      sort: query.sort,
      displayState: {
        ...(selection.displayState || {}),
        evidenceAuthority: 'server_artifact_truth',
      },
    },
  };
}

module.exports = {
  resolveInteractionBaselineRevision,
  baselineFailureDiagnostic,
  resolveInteractionDescriptor,
  backingArtifactName,
  bindAuthoritativeQuerySelection,
  resolveArtifactPath,
};
