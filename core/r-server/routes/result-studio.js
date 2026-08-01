'use strict';

/**
 * routes/result-studio.js
 *
 * G0-RS3 — Artifact Interaction 与 Selection Context 的 HTTP 边界。
 *
 * 为什么交互清单必须由后端产出：
 * 浏览器侧只解析了 artifact 的前 40 行预览（project-workspace.tsx 的
 * `buildPreviewTable`），那个样本没有资格判定"哪一列是稳定实体 ID"。
 * 10 万行表格的 ID 唯一性只能在完整文件上验证，所以清单在这里构建，
 * 前端只消费，不自建第二套判定。
 *
 * 安全边界（与桌面版实际模型一致，不虚构鉴权层）：
 * - BioF3 Desktop 是 loopback-only 单本地管理员，`core/r-server/auth.js` 明确
 *   声明不存在登录边界；`localIdentityMiddleware` 在 bootstrap 里全局注入
 *   `req.user`。因此这里**没有** `requireAuth` 中间件——仓库里也不存在这个东西。
 * - 每个端点仍逐项做 `canAccessProject` 归属校验，与 routes/harness.js 同一模式；
 *   admin 与内部调用走 `isAdminOrInternal`。
 * - artifact 路径一律经 `resolveProjectRunLayout` + 包含性检查派生，
 *   不接受调用方传入的任意路径。
 * - 读取体积设上限，避免一次请求把整个大文件读进内存。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const pluginLoader = require('../plugin-loader');
const mcpRegistry = require('../mcp/registry');
const { artifactContentTypeHint } = require('../helpers/artifact-truth');
const {
  createVerifiedFileSnapshot,
  createVerifiedSnapshotReadStream,
  pipeVerifiedSnapshotToResponse,
} = require('../helpers/verified-file-snapshot');

// core/r-server/db.js 导出的是模块对象；真实 better-sqlite3 句柄在 `.db` 上。
// 直接对模块对象调用 prepare() 会在运行时抛错。
const sqlite = db.db;
const { resolveProjectRunLayout, isPathContained } = require('../../shared-backend/project-run-layout');
const { bindProjectRepository } = require('../../shared-backend/git-repository-binding');
const {
  createDeduplicatedBackgroundRunner,
  runResultStudioBackground,
} = require('../../shared-backend/result-studio-background');
const {
  inspectBaselineArtifactCohort,
  inspectPersistedArtifactCohort,
} = require('../../shared-backend/result-changeset-service');
const {
  compareResultChangeSet,
  adoptResultChangeSet,
  revertResultChangeSet,
  restoreArtifactRevision,
} = require('../../shared-backend/result-compare-service');
const {
  buildTableInteractionManifest,
  buildPlotInteractionManifest,
  buildQuerySelection,
  describeSelectionForAgent,
  resolveSelectedEntityIds,
} = require('../../shared-backend/artifact-interaction');
const {
  createResultStudioRepository,
} = require('../../shared-backend/result-studio-repository');
const {
  ResultRevisionSourceError,
  projectRevisionSource,
} = require('../../shared-backend/result-revision-source');
const {
  ResultReplayError,
  createControlledReplayService,
} = require('../../shared-backend/result-replay-service');
const {
  assessSelectionCompatibility,
  validateSelectionContext,
  summarizeSelection,
} = require('../../shared-backend/result-studio-contracts');
const {
  queryResultTable,
  ResultStudioTableQueryError,
} = require('../../shared-backend/result-studio-table-query');
const { createRuntimeResourceSnapshot } = require('../../shared-backend/runtime-resource-snapshot');
const { getResultStudioRuntimeLease } = require('../../shared-backend/result-studio-runtime-lease');
const {
  summarizeContextForAgent,
  PUBLIC_EDIT_PHASES,
} = require('../../shared-backend/result-studio-context');
const {
  guardContextOperation,
  resolveResultStudioContext,
} = require('../agent-tools/result-context-tools');
const { buildEditControlSchema } = require('../../shared-backend/result-edit-controls');
const {
  planArtifactDeduplication,
  executeArtifactDeduplication,
  planResultStudioGc,
  executeResultStudioGc,
  evaluatePreviewResourceBudget,
  readTablePage,
} = require('../../shared-backend/result-studio-lifecycle');

/** 用于 ID 推断的抽样上限。够判定唯一性，又不至于把大文件全读进内存。 */
const ID_INFERENCE_SAMPLE_ROWS = 500;

/** 单个 artifact 的读取上限（字节）。超过则只读前缀做抽样。 */
const MAX_READ_BYTES = 8 * 1024 * 1024;

const TABLE_EXTENSIONS = /\.(csv|tsv)$/i;
const PLOT_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp)$/i;
const PRIVATE_ERROR_COORDINATE = /(?:file:\/\/|[a-z]:[\\/]|\\\\|(?:^|[\s"'(:=])\/(?!api\/)[^\s"'<>]+)/i;

function publicResultStudioErrorMessage(error, fallback) {
  const message = String(error?.message || '').trim();
  if (!message || PRIVATE_ERROR_COORDINATE.test(message) || /[\r\n\0]/.test(message)) return fallback;
  return message.slice(0, 500);
}

function buildContextBoundPreviewBudget({ disk = null, activePreviewJobs = 0 } = {}, dependencies = {}) {
  const snapshotFactory = dependencies.createRuntimeResourceSnapshot || createRuntimeResourceSnapshot;
  const budgetEvaluator = dependencies.evaluatePreviewResourceBudget || evaluatePreviewResourceBudget;
  const active = Math.max(0, Math.floor(Number(activePreviewJobs) || 0));
  const snapshot = snapshotFactory({
    disk,
    activeJobs: active,
    estimatedMemoryBytes: null,
  });
  return {
    snapshot,
    budget: {
      ...budgetEvaluator({
        resourceSnapshot: snapshot,
        estimatedMemoryBytes: null,
        estimatedDiskBytes: null,
        activePreviewJobs: active,
      }),
      resourceEstimate: {
        estimateVersion: 1,
        available: false,
        source: 'context_bound_edit_required',
        reason: 'trusted_edit_context_unavailable',
      },
    },
  };
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let bytesRead;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function resolveInteractionBaselineRevision({
  repository,
  projectId,
  sourceJob,
  artifactId,
  pluginDescriptor,
} = {}, dependencies = {}) {
  const existing = repository.findRevisionByJobArtifact({
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
  }, { repository });
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
  }, { repository });
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

function resolveWorkspaceFileForRevision(workspaceRoot, revision) {
  const workspace = fs.realpathSync(workspaceRoot);
  const target = fs.realpathSync(path.join(workspace, revision.outputPath));
  if (!isPathContained(workspace, target)) throw Object.assign(new Error('Revision output escaped the project.'), { code: 'revision_output_escape' });
  return target;
}

async function openVerifiedRevisionArtifact(workspaceRoot, revision) {
  let fd = null;
  try {
    const workspace = fs.realpathSync(workspaceRoot);
    const artifactPath = fs.realpathSync(path.join(workspace, revision.outputPath));
    if (!isPathContained(workspace, artifactPath)) throw new Error('artifact_path_escape');
    const noFollow = Number.isInteger(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0;
    fd = fs.openSync(artifactPath, fs.constants.O_RDONLY | noFollow);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('artifact_not_file');
    if (!revision.outputHash) throw new Error('artifact_hash_mismatch');
    const sourceFd = fd;
    fd = null;
    const snapshot = await createVerifiedFileSnapshot(sourceFd, {
      expectedIdentity: {
        dev: stat.dev,
        ino: stat.ino,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
      },
      expectedSha256: revision.outputHash,
    });
    return {
      fd: snapshot.fd,
      stat: snapshot.stat,
      verification: snapshot.verification,
      artifactPath,
    };
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    if (error?.code === 'verified_snapshot_hash_mismatch') throw new Error('artifact_hash_mismatch');
    throw error;
  }
}

function userId(req) {
  return (req.user && (req.user.id || req.user.userId)) || null;
}

function isAdminOrInternal(req) {
  return req.isInternal || (req.user && req.user.role === 'admin');
}

function canAccessProject(req, project) {
  if (!project) return false;
  if (isAdminOrInternal(req)) return true;
  const uid = userId(req);
  return !!(project.is_public || !project.user_id || project.user_id === uid);
}

function detectDelimiter(headerLine, fileName) {
  if (/\.tsv$/i.test(fileName)) return '\t';
  const tabs = (headerLine.match(/\t/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return tabs > commas ? '\t' : ',';
}

function splitCsvLine(line, delimiter) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      // 连续两个引号是转义的字面引号
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; continue; }
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) { cells.push(current.trim()); current = ''; continue; }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

/**
 * 读取表格 artifact 并抽样。
 *
 * 返回真实总行数（在读全的前提下）与抽样行对象；文件被截断时明确标记，
 * 避免把"前缀里唯一"当成"整表唯一"。
 */
function readTableSample(absolutePath, fileName) {
  const stat = fs.statSync(absolutePath);
  const truncated = stat.size > MAX_READ_BYTES;
  let raw;
  if (truncated) {
    const handle = fs.openSync(absolutePath, 'r');
    try {
      const buffer = Buffer.alloc(MAX_READ_BYTES);
      const read = fs.readSync(handle, buffer, 0, MAX_READ_BYTES, 0);
      raw = buffer.slice(0, read).toString('utf8');
    } finally {
      fs.closeSync(handle);
    }
    // 丢弃末尾可能被截断的半行
    const lastBreak = raw.lastIndexOf('\n');
    if (lastBreak > 0) raw = raw.slice(0, lastBreak);
  } else {
    raw = fs.readFileSync(absolutePath, 'utf8');
  }

  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return { columns: [], rows: [], rowCount: 0, truncated };

  const delimiter = detectDelimiter(lines[0], fileName);
  const columns = splitCsvLine(lines[0], delimiter);
  const dataLines = lines.slice(1);
  const rows = dataLines.slice(0, ID_INFERENCE_SAMPLE_ROWS).map((line) => {
    const cells = splitCsvLine(line, delimiter);
    const row = {};
    columns.forEach((column, index) => { row[column] = cells[index]; });
    return row;
  });

  return {
    columns,
    rows,
    // 文件被截断时行数只是下界，不能当权威总数。
    rowCount: truncated ? null : dataLines.length,
    truncated,
  };
}

function loadJobAndProject(req, jobId) {
  const job = db.getToolJob(jobId);
  if (!job) return { error: { status: 404, code: 'job_not_found' } };
  const project = job.project_id
    ? sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(job.project_id)
    : null;
  if (!project) return { error: { status: 404, code: 'project_not_found' } };
  if (!canAccessProject(req, project)) return { error: { status: 403, code: 'forbidden' } };
  return { job, project };
}

function artifactTruthError(reason, message, code = 'artifact_truth_unavailable') {
  return { error: { status: 409, code, reason, message } };
}

function artifactTruthAvailability(result) {
  const truth = result?.artifactTruth;
  if (!truth || truth.blocking === true || !['valid', 'degraded'].includes(truth.status)) {
    return artifactTruthError(
      'job_artifact_truth_unavailable',
      'The completed Job does not have usable Artifact Truth.',
    );
  }
  return null;
}

function verifyArtifactRecordBytes(artifactRecord, absolutePath) {
  const expectedSha256 = String(artifactRecord?.sha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    return artifactTruthError(
      'artifact_sha256_unavailable',
      'The selected Artifact has no trusted SHA-256 in Job Artifact Truth.',
    );
  }
  let actualSha256;
  try {
    actualSha256 = hashFile(absolutePath);
  } catch {
    return artifactTruthError(
      'artifact_file_unavailable',
      'The selected Artifact file is unavailable.',
    );
  }
  if (actualSha256 !== expectedSha256) {
    return artifactTruthError(
      'artifact_hash_drift',
      'The selected Artifact bytes no longer match Job Artifact Truth.',
      'artifact_truth_drift',
    );
  }
  return { artifactRecord, expectedSha256, actualSha256 };
}

function findArtifactRecord(result, absolutePath, artifactName) {
  const unavailable = artifactTruthAvailability(result);
  if (unavailable) return unavailable;
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  let realTarget;
  try {
    realTarget = fs.realpathSync(absolutePath);
    if (!fs.statSync(realTarget).isFile()) throw new Error('artifact_not_file');
  } catch {
    return artifactTruthError(
      'artifact_file_unavailable',
      'The selected Artifact file is unavailable.',
    );
  }
  const matches = artifacts.filter((artifact) => {
    if (!artifact || !artifact.id) return false;
    if (artifact.id === artifactName || artifact.name === artifactName || artifact.filename === artifactName) return true;
    if (!artifact.path) return false;
    try { return fs.realpathSync(artifact.path) === realTarget; } catch { return false; }
  });
  if (matches.length === 0) {
    return artifactTruthError(
      'artifact_record_missing',
      'The selected file is not present in Job Artifact Truth.',
    );
  }
  if (matches.length > 1) {
    return artifactTruthError(
      'artifact_identity_ambiguous',
      'The selected file does not resolve to one unique Artifact Truth record.',
    );
  }
  return verifyArtifactRecordBytes(matches[0], realTarget);
}

function sendArtifactResolutionError(res, error) {
  const body = { error: error.code };
  if (error.reason) body.reason = error.reason;
  if (error.message) body.message = error.message;
  return res.status(error.status).json(body);
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

function parseToolJobResult(job) {
  if (job?.result && typeof job.result === 'object') return job.result;
  try { return JSON.parse(job?.result_json || '{}'); } catch { return {}; }
}

/**
 * Recompute a query-backed Selection from immutable Revision + Job Artifact
 * Truth. Browser-supplied count/hash/sample values are comparison inputs only;
 * none of them can become persisted Agent context without this exact read.
 */
function bindAuthoritativeQuerySelection({ req, project, selection, repository }, dependencies = {}) {
  if (!selection?.entityIdsTruncated || !selection.filterExpression) {
    return { selection, authoritative: false };
  }
  const reject = (code, message, status = 409) => ({ error: { status, code, message } });
  if (!selection.revisionId) {
    return reject('selection_revision_required', 'A query-backed selection requires one persisted Revision.');
  }
  const revision = repository.getRevision(selection.revisionId);
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
  const job = { ...storedJob, result: parseToolJobResult(storedJob) };
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
  const afterRead = (dependencies.verifyArtifactRecordBytes || verifyArtifactRecordBytes)(
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
  const unavailable = artifactTruthAvailability(job?.result);
  if (unavailable) return unavailable;
  const resolveLayout = dependencies.resolveProjectRunLayout || resolveProjectRunLayout;
  let layout;
  try {
    layout = resolveLayout({
      projectId: project.id,
      toolJobId: job.id,
      db,
      userId: userId(req),
      skipPermissionCheck: isAdminOrInternal(req),
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
  if (declaredMatches.length === 0) return artifactTruthError(
    'artifact_record_missing',
    'The selected file is not present in Job Artifact Truth.',
  );
  if (declaredMatches.length > 1) return artifactTruthError(
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
      return artifactTruthError(
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
    if (!fs.existsSync(absolute)) return artifactTruthError(
      'artifact_file_unavailable',
      'The selected Artifact file is unavailable.',
    );
    absolutePath = absolute;
  }
  const binding = findArtifactRecord(job.result, absolutePath, name);
  if (binding.error) return binding;
  return {
    absolutePath,
    layout,
    artifactRecord: binding.artifactRecord,
    expectedSha256: binding.expectedSha256,
  };
}

module.exports = function registerResultStudioRoutes(app) {
  // 鉴权说明：BioF3 Desktop 是 loopback-only 单本地管理员应用，
  // `bootstrap.js` 的 localIdentityMiddleware 已全局注入 req.user，
  // 仓库里**不存在** requireAuth 中间件（见 core/r-server/auth.js 注释）。
  // 因此这里沿用 harness.js 的既有模式：裸注册 + 每个端点内联 canAccessProject 校验。
  // 惰性创建：registerRoutes 对每个模块套了 try/catch，注册期抛错会让**整个**
  // result-studio 模块静默不注册（功能变死代码且没有报错）。改为首次请求时创建，
  // schema 有问题就返回 500 并带明确原因。
  let repositoryInstance = null;
  const replayService = createControlledReplayService();
  const baselineWork = createDeduplicatedBackgroundRunner(runResultStudioBackground);
  const workspaceInspectionWork = createDeduplicatedBackgroundRunner(runResultStudioBackground);
  const configuredDatabasePath = sqlite.name || process.env.BIOF3_DB_PATH || null;
  const databasePath = configuredDatabasePath && configuredDatabasePath !== ':memory:'
    ? path.resolve(configuredDatabasePath)
    : null;

  function repo() {
    // Production migrations own schema creation. A GET must never execute DDL
    // merely because this module is serving its first request.
    if (!repositoryInstance) repositoryInstance = createResultStudioRepository(sqlite, { ensureSchema: false });
    return repositoryInstance;
  }

  function projectContext(req, projectId, { write = false, git = true } = {}) {
    const project = db.getProject(projectId);
    if (!project) return { error: { status: 404, code: 'project_not_found' } };
    if (!canAccessProject(req, project)) return { error: { status: 403, code: 'forbidden' } };
    if (!git) return { project, binding: null, repository: repo(), gitPathPrefix: '' };
    const binding = bindProjectRepository({
      workspaceRoot: project.workspace_path,
      projectId,
      preferManaged: false,
      allowExistingRepository: true,
      // Read-only history/compare/status requests may inspect an existing
      // repository but must not initialize .biof3/git as a side effect.
      createManagedIfMissing: write,
    });
    if (!binding?.adapter || (write && binding.status !== 'ready')) {
      return {
        error: {
          status: 409,
          code: binding?.reason || binding?.status || 'repository_binding_failed',
          bindingStatus: binding?.status || null,
        },
      };
    }
    // 只在写路径记录绑定。此前无视自己声明的 `write` 标志无条件写入，
    // 于是纯 GET（含只读查看历史 Revision）也会 upsert 一行并盖上 updated_at，
    // 违反「查看不写入」契约。生产代码没有任何一处读回该行
    // （`getRepositoryBinding` 仅被测试消费），因此它是审计记录：
    // 在真正用到 git 的时候记录才有意义。
    if (write) {
      repo().saveRepositoryBinding({
        projectId,
        mode: binding.mode,
        workspaceRoot: binding.workspaceRoot,
        gitDir: binding.adapter.gitDir,
        workTree: binding.adapter.workTree,
        managedPaths: binding.managedPaths,
        status: binding.status,
        reason: binding.reason,
        gitVersion: binding.inspection?.runtime?.versionRaw || null,
      });
    }
    return {
      project,
      binding,
      repository: repo(),
      gitPathPrefix: binding.mode === 'existing'
        ? binding.inspection?.existing?.workspaceRelativeToRepository
        : '',
    };
  }

  function changeSetContext(req, changeSetId, options = {}) {
    const changeSet = repo().getChangeSet(changeSetId);
    if (!changeSet) return { error: { status: 404, code: 'change_set_not_found' } };
    const context = projectContext(req, changeSet.projectId, options);
    return context.error ? context : { ...context, changeSet };
  }

  /**
   * 交互清单：告诉前端这个 artifact 能怎么选、哪一列是稳定实体 ID。
   */
  app.get('/api/result-studio/interaction', async (req, res) => {
    const jobId = String(req.query.jobId || '').trim();
    const artifactName = String(req.query.artifact || '').trim();
    if (!jobId) return res.status(400).json({ error: 'jobId_required' });

    const loaded = loadJobAndProject(req, jobId);
    if (loaded.error) return res.status(loaded.error.status).json({ error: loaded.error.code });

    const resolved = resolveArtifactPath({ req, job: loaded.job, project: loaded.project, artifactName });
    if (resolved.error) {
      return sendArtifactResolutionError(res, resolved.error);
    }
    if (!TABLE_EXTENSIONS.test(artifactName) && !PLOT_EXTENSIONS.test(artifactName)) {
      return res.status(415).json({ error: 'artifact_kind_not_interactive' });
    }
    const artifactRecord = resolved.artifactRecord;
    const interaction = resolveInteractionDescriptor(loaded.job.tool_id, artifactRecord, artifactName);

    let revision = null;
    let revisionDiagnostic = null;
    const explicitRevisionId = String(req.query.revisionId || '').trim() || null;
    try {
      if (explicitRevisionId) {
        const candidate = repo().getRevision(explicitRevisionId);
        if (candidate && candidate.projectId === loaded.project.id
          && candidate.toolJobId === loaded.job.id && candidate.artifactId === artifactRecord.id) {
          revision = candidate;
        } else {
          revisionDiagnostic = { code: 'revision_not_bound_to_artifact', message: 'Requested revision is not bound to this Job.' };
        }
      } else {
        const result = loaded.job.result || {};
        const pluginManifest = pluginLoader.getPluginManifest(loaded.job.tool_id);
        const pluginDescriptor = pluginManifest?.resultStudio || null;
        const baseline = resolveInteractionBaselineRevision({
          repository: repo(),
          projectId: loaded.project.id,
          sourceJob: loaded.job,
          artifactId: artifactRecord.id,
          pluginDescriptor,
        });
        if (!baseline.requiresEnsure) {
          revision = baseline.revision;
        } else {
          const snapshot = result.executionProvenance?.script;
          if (!snapshot?.snapshotPath || !snapshot.sha256) {
            throw Object.assign(new Error('Execution script snapshot is unavailable.'), { code: 'source_script_missing' });
          }
          if (!fs.existsSync(snapshot.snapshotPath) || !fs.statSync(snapshot.snapshotPath).isFile()) {
            throw Object.assign(new Error('Execution script snapshot is unavailable.'), { code: 'source_script_missing' });
          }
          const realWorkspace = fs.realpathSync(loaded.project.workspace_path);
          const sourceScriptPath = fs.realpathSync(snapshot.snapshotPath);
          if (!isPathContained(realWorkspace, sourceScriptPath)) {
            throw Object.assign(new Error('Execution script snapshot escaped the project.'), { code: 'source_script_outside_project' });
          }
          const baselineInput = {
            projectId: loaded.project.id,
            workspaceRoot: loaded.project.workspace_path,
            sourceJob: loaded.job,
            artifactId: artifactRecord.id,
            pluginId: loaded.job.tool_id,
            language: result.tool?.language || (/\.py$/i.test(sourceScriptPath) ? 'python' : 'r'),
            sourceScriptContent: fs.readFileSync(sourceScriptPath, 'utf8'),
            sourceScriptSha256: snapshot.sha256,
            pluginDescriptor,
          };
          const baselineKey = `${loaded.project.id}\0${loaded.job.id}\0baseline-cohort`;
          const ensured = await baselineWork.run(
            baselineKey,
            'ensure-baseline',
            {
              databasePath,
              projectId: loaded.project.id,
              workspaceRoot: loaded.project.workspace_path,
              input: baselineInput,
            },
          );
          revision = ensured.revision;
        }
      }
    } catch (error) {
      revisionDiagnostic = baselineFailureDiagnostic(error);
    }
    const revisionId = revision?.revisionId || null;
    const stableArtifactId = artifactRecord.id;
    let activeReadArtifact = resolved;

    try {
      if (TABLE_EXTENSIONS.test(artifactName)) {
        const beforeRead = verifyArtifactRecordBytes(artifactRecord, resolved.absolutePath);
        if (beforeRead.error) return sendArtifactResolutionError(res, beforeRead.error);
        const sample = readTableSample(resolved.absolutePath, artifactName);
        const afterRead = verifyArtifactRecordBytes(artifactRecord, resolved.absolutePath);
        if (afterRead.error) return sendArtifactResolutionError(res, afterRead.error);
        const mapping = interaction.mapping;
        let backingTable = null;
        if (mapping?.mode === 'matrix') {
          const backingName = backingArtifactName(interaction) || artifactName;
          const backing = backingName === artifactName
            ? resolved
            : resolveArtifactPath({ req, job: loaded.job, project: loaded.project, artifactName: backingName });
          if (backing.error) return sendArtifactResolutionError(res, backing.error);
          activeReadArtifact = backing;
          backingTable = queryResultTable({
            filePath: backing.absolutePath,
            expectedSha256: backing.expectedSha256,
            idField: mapping.rowIdField || null,
            limit: 100,
          });
          const backingAfterRead = verifyArtifactRecordBytes(backing.artifactRecord, backing.absolutePath);
          if (backingAfterRead.error) return sendArtifactResolutionError(res, backingAfterRead.error);
        }
        const manifest = buildTableInteractionManifest({
          artifactId: stableArtifactId,
          revisionId,
          columns: backingTable ? backingTable.columns.map((column) => column.field) : sample.columns,
          rows: backingTable ? backingTable.rows : sample.rows,
          rowCount: backingTable?.totalRows ?? (sample.rowCount === null ? undefined : sample.rowCount),
          declaredIdField: mapping?.idField || mapping?.rowIdField || null,
          declaredEntityType: mapping?.entityType || mapping?.rowEntityType || null,
        });
        manifest.interactionMode = mapping?.mode || 'read_only';
        manifest.mapping = mapping || null;
        if (!mapping) {
          manifest.capabilities = [];
          manifest.selectionDurable = false;
          manifest.diagnostics = [...manifest.diagnostics, {
            code: 'plugin_interaction_mapping_missing',
            message: 'Plugin descriptor does not declare a stable interaction mapping; artifact is read-only.',
          }];
        }
        if (sample.truncated) {
          manifest.diagnostics = [
            ...manifest.diagnostics,
            {
              code: 'artifact_read_truncated',
              message: 'File exceeded the read limit; row count and uniqueness were assessed on a prefix only.',
            },
          ];
        }
        manifest.artifactFamilyId = revision?.artifactFamilyId || null;
        if (revisionDiagnostic) manifest.diagnostics = [...manifest.diagnostics, revisionDiagnostic];
        return res.json({
          manifest,
          revision,
          backingTable,
          sampledRows: backingTable?.rows.length || sample.rows.length,
          truncated: backingTable ? !!backingTable.nextOffset : sample.truncated,
        });
      }

      if (PLOT_EXTENSIONS.test(artifactName)) {
        const currentPlot = verifyArtifactRecordBytes(artifactRecord, resolved.absolutePath);
        if (currentPlot.error) return sendArtifactResolutionError(res, currentPlot.error);
        const mapping = interaction.mapping;
        const manifest = buildPlotInteractionManifest({
          artifactId: stableArtifactId,
          revisionId,
          declaredIdField: mapping?.idField || mapping?.rowIdField || null,
          declaredEntityType: mapping?.entityType || mapping?.rowEntityType || null,
          axes: { x: mapping?.xField || null, y: mapping?.yField || null },
          legendField: mapping?.legendField || null,
        });
        manifest.interactionMode = mapping?.mode || 'read_only';
        manifest.mapping = mapping || null;
        if (mapping?.mode === 'matrix') {
          manifest.artifactKind = 'matrix';
          manifest.capabilities = ['row_select', 'column_select'];
        }
        manifest.artifactFamilyId = revision?.artifactFamilyId || null;
        if (revisionDiagnostic) manifest.diagnostics = [...manifest.diagnostics, revisionDiagnostic];
        let backingTable = null;
        const backingName = backingArtifactName(interaction);
        if (mapping && backingName) {
          const backing = resolveArtifactPath({
            req, job: loaded.job, project: loaded.project, artifactName: backingName,
          });
          if (backing.error) return sendArtifactResolutionError(res, backing.error);
          activeReadArtifact = backing;
          backingTable = queryResultTable({
            filePath: backing.absolutePath,
            expectedSha256: backing.expectedSha256,
            idField: mapping.idField || mapping.rowIdField || null,
            limit: 250,
          });
          const backingAfterRead = verifyArtifactRecordBytes(backing.artifactRecord, backing.absolutePath);
          if (backingAfterRead.error) return sendArtifactResolutionError(res, backingAfterRead.error);
        }
        if (mapping?.mode === 'matrix' && !backingTable) {
          manifest.capabilities = [];
          manifest.selectionDurable = false;
        }
        return res.json({ manifest, revision, backingTable, sampledRows: backingTable?.rows?.length || 0, truncated: !!backingTable?.nextOffset });
      }
    } catch (error) {
      const currentTruth = verifyArtifactRecordBytes(
        activeReadArtifact.artifactRecord,
        activeReadArtifact.absolutePath,
      );
      if (currentTruth.error) return sendArtifactResolutionError(res, currentTruth.error);
      return res.status(500).json({ error: 'interaction_manifest_failed', message: error && error.message });
    }
  });

  /** 权威完整表查询；排序/过滤永远不基于浏览器中的前缀预览。 */
  app.post('/api/result-studio/table/query', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const jobId = String(body.jobId || '').trim();
    const artifactName = String(body.artifact || '').trim();
    if (!jobId || !artifactName) return res.status(400).json({ error: 'job_and_artifact_required' });
    const loaded = loadJobAndProject(req, jobId);
    if (loaded.error) return res.status(loaded.error.status).json({ error: loaded.error.code });
    const resolved = resolveArtifactPath({ req, job: loaded.job, project: loaded.project, artifactName });
    if (resolved.error) return sendArtifactResolutionError(res, resolved.error);
    const artifactRecord = resolved.artifactRecord;
    const interaction = resolveInteractionDescriptor(loaded.job.tool_id, artifactRecord, artifactName);
    const mapping = interaction.mapping;
    if (!mapping) return res.status(409).json({ error: 'plugin_interaction_mapping_missing' });
    const queryName = backingArtifactName(interaction) || artifactName;
    const queryPath = queryName === artifactName
      ? resolved
      : resolveArtifactPath({ req, job: loaded.job, project: loaded.project, artifactName: queryName });
    if (queryPath.error) return sendArtifactResolutionError(res, queryPath.error);
    try {
      const result = queryResultTable({
        filePath: queryPath.absolutePath,
        expectedSha256: queryPath.expectedSha256,
        idField: mapping.idField || mapping.rowIdField || null,
        filterExpression: body.filterExpression,
        sort: body.sort,
        offset: Number(body.offset),
        limit: Number(body.limit),
      });
      const afterRead = verifyArtifactRecordBytes(queryPath.artifactRecord, queryPath.absolutePath);
      if (afterRead.error) return sendArtifactResolutionError(res, afterRead.error);
      return res.json(result);
    } catch (error) {
      const currentTruth = verifyArtifactRecordBytes(queryPath.artifactRecord, queryPath.absolutePath);
      if (currentTruth.error) return sendArtifactResolutionError(res, currentTruth.error);
      const status = error instanceof ResultStudioTableQueryError ? 400 : 500;
      return res.status(status).json({ error: error.code || 'table_query_failed', message: error.message, detail: error.detail || null });
    }
  });

  /**
   * 持久化一个选择。大选择走 filter 权威表达，不把百万 ID 塞进库。
   */
  app.post('/api/result-studio/selection', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const projectId = String(body.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId_required' });

    const project = sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    if (!canAccessProject(req, project)) return res.status(403).json({ error: 'forbidden' });

    let validated = validateSelectionContext({
      selectionId: body.selectionId,
      projectId,
      conversationId: body.conversationId,
      artifactId: body.artifactId,
      revisionId: body.revisionId,
      entityType: body.entityType,
      entityIds: body.entityIds,
      entityIdCount: body.entityIdCount,
      entityIdsHash: body.entityIdsHash,
      filterHash: body.filterHash,
      filterExpression: body.filterExpression,
      sort: body.sort,
      viewport: body.viewport,
      displayState: body.displayState,
    });
    if (!validated.ok) {
      return res.status(400).json({ error: 'selection_invalid', details: validated.errors });
    }

    try {
      const repository = repo();
      const bound = bindAuthoritativeQuerySelection({
        req,
        project,
        selection: validated.selection,
        repository,
      });
      if (bound.error) return sendArtifactResolutionError(res, bound.error);
      if (bound.authoritative) {
        validated = validateSelectionContext(bound.selection);
        if (!validated.ok) {
          return res.status(409).json({ error: 'selection_authoritative_invalid' });
        }
      }
      const saved = repository.saveSelection(validated.selection);
      return res.json({ selection: saved, summary: summarizeSelection(saved) });
    } catch (error) {
      return res.status(500).json({ error: 'selection_persist_failed', message: error && error.message });
    }
  });

  /** 按项目+会话+Artifact 恢复最后选择，并返回兼容性状态。 */
  app.get('/api/result-studio/selection/current', (req, res) => {
    const projectId = String(req.query.projectId || '').trim();
    const artifactId = String(req.query.artifactId || '').trim();
    const conversationId = String(req.query.conversationId || '').trim() || null;
    if (!projectId || !artifactId) return res.status(400).json({ error: 'project_and_artifact_required' });
    const project = sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    if (!canAccessProject(req, project)) return res.status(403).json({ error: 'forbidden' });
    const selection = repo().findLatestSelection({ projectId, conversationId, artifactId });
    if (!selection) return res.status(404).json({ error: 'selection_not_found' });
    const compatibility = assessSelectionCompatibility({
      selection,
      projectId,
      artifactId,
      revisionId: String(req.query.revisionId || '').trim() || null,
      selectionDurable: String(req.query.selectionDurable || 'true') !== 'false',
    });
    return res.json({ selection, compatibility, summary: summarizeSelection(selection) });
  });

  /** 按 id 恢复选择。 */
  app.get('/api/result-studio/selection/:selectionId', (req, res) => {
    const selection = repo().getSelection(String(req.params.selectionId || '').trim());
    if (!selection) return res.status(404).json({ error: 'selection_not_found' });
    const project = sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(selection.projectId);
    if (!canAccessProject(req, project)) return res.status(403).json({ error: 'forbidden' });
    return res.json({
      selection,
      summary: summarizeSelection(selection),
      agentView: describeSelectionForAgent(selection),
    });
  });

  /** 删除选择（用户显式清空）。 */
  app.delete('/api/result-studio/selection/:selectionId', (req, res) => {
    const selectionId = String(req.params.selectionId || '').trim();
    const selection = repo().getSelection(selectionId);
    if (!selection) return res.status(404).json({ error: 'selection_not_found' });
    const project = sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(selection.projectId);
    if (!canAccessProject(req, project)) return res.status(403).json({ error: 'forbidden' });
    repo().deleteSelection(selectionId);
    return res.json({ deleted: true, selectionId });
  });

  /**
   * 用 filter 表达一个大选择，并返回权威 hash。
   *
   * 用于 10 万行级表格：ID 列表不进上下文，filter + hash 才是选择本体。
   */
  app.post('/api/result-studio/selection/query', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const manifest = body.manifest;
    if (!manifest || typeof manifest !== 'object') {
      return res.status(400).json({ error: 'manifest_required' });
    }
    try {
      const selection = buildQuerySelection({
        manifest,
        filter: body.filter,
        matchedCount: body.matchedCount,
        sampleEntityIds: body.sampleEntityIds,
      });
      return res.json({ selection, agentView: describeSelectionForAgent(selection) });
    } catch (error) {
      return res.status(400).json({ error: error.code || 'query_selection_failed', message: error && error.message });
    }
  });

  /**
   * 把选中的行解析成稳定实体 ID。
   *
   * positional artifact 会返回 durable=false 与诊断，调用方不得把行号当身份。
   */
  app.post('/api/result-studio/selection/resolve', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (!body.manifest || typeof body.manifest !== 'object') {
      return res.status(400).json({ error: 'manifest_required' });
    }
    try {
      const resolved = resolveSelectedEntityIds({
        manifest: body.manifest,
        selectedRows: Array.isArray(body.selectedRows) ? body.selectedRows : [],
      });
      return res.json(resolved);
    } catch (error) {
      return res.status(400).json({ error: error.code || 'resolve_failed', message: error && error.message });
    }
  });

  // ----------------------------------------------------------- RS6 review UI

  /**
   * G0-RS-P3 — 当前结果的 ResultStudioContextEnvelope 投影。
   *
   * 前端与 Agent 共用同一份真相：这里不接受调用方声明的 revision/selection
   * 身份，只接受"用户打开了哪个 Job 的哪个文件"这一线索，其余坐标全部从
   * SQLite / tool_jobs / 插件 descriptor 重新解析。缺少正式 Revision、
   * 归因只能到 Job 时返回 409 与可行动诊断，不伪造坐标。
   */
  app.get('/api/result-studio/context-envelope', (req, res) => {
    const projectId = String(req.query.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId_required' });
    const project = db.getProject(projectId);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    if (!canAccessProject(req, project)) return res.status(403).json({ error: 'forbidden' });
    const resolved = resolveResultStudioContext({
      projectId,
      userId: userId(req),
      conversationId: String(req.query.conversationId || '').trim() || null,
      activeArtifact: {
        jobId: String(req.query.jobId || '').trim() || null,
        name: String(req.query.artifact || '').trim() || null,
        revisionId: String(req.query.revisionId || '').trim() || null,
      },
    }, { repository: repo() });
    if (!resolved.ok) {
      return res.status(409).json({
        error: resolved.diagnostics[0]?.code || 'context_unavailable',
        message: resolved.diagnostics[0]?.message || null,
        diagnostics: resolved.diagnostics,
      });
    }
    // G0-RS-P4：手动控件 schema 与 Agent 可见的可编辑参数出自同一 descriptor
    // 投影，因此前端参数面板不可能显示插件未声明的参数，也不会与 AI 看到的
    // 契约分叉。currentValues 取该 Job 真实执行过的归一化参数，不用默认值冒充。
    const controlSchema = buildEditControlSchema(resolved.descriptor);
    return res.json({
      envelope: resolved.envelope,
      agentView: summarizeContextForAgent(resolved.envelope),
      editControls: {
        controlsVersion: controlSchema.controlsVersion,
        groups: controlSchema.groups,
        controls: controlSchema.controls,
        diagnostics: controlSchema.diagnostics,
        currentValues: resolved.currentParameters || {},
      },
      publicPhases: [...PUBLIC_EDIT_PHASES],
    });
  });

  app.get('/api/result-studio/changesets', (req, res) => {
    const projectId = String(req.query.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId_required' });
    const context = projectContext(req, projectId, { git: false });
    if (context.error) return res.status(context.error.status).json({ error: context.error.code });
    const artifactFamilyId = String(req.query.artifactFamilyId || '').trim() || null;
    const revisionOffset = Math.max(0, Number.parseInt(String(req.query.revisionOffset || '0'), 10) || 0);
    const revisionLimit = Math.min(200, Math.max(1, Number.parseInt(String(req.query.revisionLimit || '100'), 10) || 100));
    const changeSets = artifactFamilyId
      ? context.repository.listChangeSetsByArtifactFamily({ projectId, artifactFamilyId, limit: 200 })
      : context.repository.listChangeSets({ projectId, limit: 200 });
    const revisionPage = artifactFamilyId
      ? context.repository.listRevisions({
          artifactFamilyId,
          projectId,
          limit: revisionLimit + 1,
          offset: revisionOffset,
          order: 'desc',
        })
      : [];
    const hasMoreRevisions = revisionPage.length > revisionLimit;
    return res.json({
      changeSets,
      currentRevision: artifactFamilyId ? context.repository.getCurrentRevision(artifactFamilyId, projectId) : null,
      revisions: revisionPage.slice(0, revisionLimit),
      nextRevisionOffset: hasMoreRevisions ? revisionOffset + revisionLimit : null,
    });
  });

  /**
   * Project the exact source for one persisted Revision. This is deliberately
   * separate from the Job snapshot route: candidate/history scripts live in
   * virtual Git commits and the current worktree is not an authoritative
   * source. The route is read-only and requires the caller to name the
   * project, so a known Revision id cannot be used to cross project boundaries.
   */
  app.get('/api/result-studio/revisions/:revisionId/source', (req, res) => {
    const projectId = String(req.query.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'project_required' });
    const context = projectContext(req, projectId, { write: false, git: true });
    if (context.error) return res.status(context.error.status).json({ error: context.error.code });
    try {
      const projection = projectRevisionSource({
        projectId,
        revisionId: String(req.params.revisionId || '').trim(),
        expectSha256: String(req.query.expectSha256 || '').trim() || null,
      }, {
        repository: context.repository,
        adapter: context.binding.adapter,
        gitPathPrefix: context.gitPathPrefix,
        workspaceRoot: context.project.workspace_path,
        getToolJob: db.getToolJob,
      });
      if (String(req.query.download || '') === '1') {
        const entryPoint = String(projection.entryPoint || 'revision-source.R').replace(/[^A-Za-z0-9._-]/g, '_');
        res.type('text/plain').set('Content-Disposition', `attachment; filename="${entryPoint}"`).send(projection.content);
        return;
      }
      return res.json(projection);
    } catch (error) {
      const status = error instanceof ResultRevisionSourceError ? error.status : 500;
      const code = error instanceof ResultRevisionSourceError ? error.code : 'revision_source_failed';
      return res.status(status).json({ error: code, message: error instanceof ResultRevisionSourceError ? error.message : 'Revision source projection failed.' });
    }
  });

  /**
   * P4R-5 controlled replay: preflight and confirmation share one endpoint,
   * but neither accepts a caller-authored tool id, parameter map, script,
   * command or workflow plan.  Both phases re-bind the current context token;
   * confirmation reprojects source/params/inputs again immediately before the
   * canonical registered-tool execution and only creates a candidate Revision.
   */
  app.post('/api/result-studio/revisions/:revisionId/replay', async (req, res) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const projectId = String(body.projectId || '').trim();
    const revisionId = String(req.params.revisionId || '').trim();
    const phase = String(body.phase || 'preflight').trim();
    if (!projectId || !revisionId) return res.status(400).json({ error: 'project_and_revision_required' });
    if (!['preflight', 'confirm'].includes(phase)) return res.status(400).json({ error: 'replay_phase_invalid' });
    const context = projectContext(req, projectId, { write: phase === 'confirm', git: true });
    if (context.error) return res.status(context.error.status).json({ error: context.error.code });

    const guarded = guardContextOperation({
      projectId,
      userId: userId(req),
      conversationId: String(body.conversationId || '').trim() || null,
      activeArtifact: { revisionId },
    }, {
      contextToken: String(body.contextToken || '').trim() || null,
    }, {
      repository: context.repository,
      getToolJob: db.getToolJob,
      getPluginManifest: pluginLoader.getPluginManifest,
    });
    if (!guarded.ok) {
      return res.status(409).json({
        error: guarded.response.error,
        message: guarded.response.message,
        diagnostics: guarded.response.diagnostics,
      });
    }

    const dependencies = {
      repository: context.repository,
      adapter: context.binding.adapter,
      gitPathPrefix: context.gitPathPrefix,
      workspaceRoot: context.project.workspace_path,
      getToolJob: db.getToolJob,
      getPlugin: pluginLoader.getPlugin,
      getResultStudioDescriptor: (toolId) => pluginLoader.getPluginManifest(toolId)?.resultStudio || null,
      activePreviewJobs: context.repository.listChangeSets({ projectId, status: 'running', limit: 500 }).length,
      executeJob: async ({
        toolId,
        params,
        materializedScriptPath,
        materializedScriptSha256,
        changeSetId,
        resultStudioInputLineage = null,
      }) => {
        const result = await mcpRegistry.callTool(toolId, params, {
          userId: userId(req) || 'local-user',
          projectId,
          resultStudioMaterializedScript: {
            path: materializedScriptPath,
            sha256: materializedScriptSha256,
            changeSetId,
          },
          resultStudioInputLineage,
        });
        const toolJobId = result && result.toolJobId;
        return { result, toolJobId, job: toolJobId ? db.getToolJob(toolJobId) : null };
      },
    };
    const input = {
      ...body,
      projectId,
      revisionId,
      phase,
      request: body,
    };
    try {
      const result = phase === 'confirm'
        ? await replayService.confirm(input, dependencies)
        : replayService.prepare(input, dependencies);
      return res.status(phase === 'confirm' ? 201 : 200).json(result);
    } catch (error) {
      const status = error instanceof ResultReplayError ? error.status : 500;
      return res.status(status).json({
        error: error instanceof ResultReplayError ? error.code : 'replay_failed',
        message: error instanceof ResultReplayError ? error.message : 'Controlled replay failed.',
        detail: error instanceof ResultReplayError ? error.detail : null,
      });
    }
  });

  app.get('/api/result-studio/changesets/:changeSetId/compare', (req, res) => {
    const context = changeSetContext(req, String(req.params.changeSetId || '').trim());
    if (context.error) return res.status(context.error.status).json({ error: context.error.code });
    try {
      return res.json(compareResultChangeSet({
        projectId: context.project.id,
        workspaceRoot: context.project.workspace_path,
        changeSetId: context.changeSet.changeSetId,
      }, {
        repository: context.repository,
        adapter: context.binding.adapter,
        gitPathPrefix: context.gitPathPrefix,
        getToolJob: db.getToolJob,
      }));
    } catch (error) {
      return res.status(409).json({ error: error.code || 'compare_failed', message: error.message, detail: error.detail || null });
    }
  });

  // ---------------------------------------------------------- RS8 lifecycle

  app.get('/api/result-studio/workspace/status', async (req, res) => {
    const projectId = String(req.query.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId_required' });
    // Validate identity/project ownership on the request thread, but move Git
    // binding, full-history hashing and private-storage walking off it.
    const context = projectContext(req, projectId, { git: false });
    if (context.error) return res.status(context.error.status).json({ error: context.error.code });
    try {
      const conversationId = String(req.query.conversationId || '').trim() || null;
      const inspectionKey = `${projectId}\0${conversationId || ''}`;
      const result = await workspaceInspectionWork.run(
        inspectionKey,
        'inspect-workspace',
        {
          databasePath,
          projectId,
          workspaceRoot: context.project.workspace_path,
          conversationId,
          runtimeLease: getResultStudioRuntimeLease(),
        },
      );
      return res.json(result);
    } catch (error) {
      return res.status(409).json({
        error: error.code || 'workspace_inspection_failed',
        message: publicResultStudioErrorMessage(error, 'Result Studio workspace inspection failed.'),
      });
    }
  });

  app.post('/api/result-studio/workspace/recover', async (req, res) => {
    const projectId = String(req.body?.projectId || '').trim();
    const context = projectContext(req, projectId, { git: false });
    if (context.error) return res.status(context.error.status).json({ error: context.error.code });
    try {
      const conversationId = String(req.body?.conversationId || '').trim() || null;
      const result = await workspaceInspectionWork.run(
        `recover\0${projectId}\0${conversationId || ''}`,
        'recover-workspace',
        {
          databasePath,
          projectId,
          workspaceRoot: context.project.workspace_path,
          conversationId,
          runtimeLease: getResultStudioRuntimeLease(),
        },
      );
      return res.status(result.after.status === 'blocked' ? 409 : 200).json({ ok: result.after.status !== 'blocked', ...result });
    } catch (error) {
      return res.status(409).json({
        error: error.code || 'workspace_recovery_failed',
        message: publicResultStudioErrorMessage(error, 'Result Studio workspace recovery failed.'),
      });
    }
  });

  app.get('/api/result-studio/storage/gc', (req, res) => {
    const projectId = String(req.query.projectId || '').trim();
    const context = projectContext(req, projectId);
    if (context.error) return res.status(context.error.status).json({ error: context.error.code });
    try {
      return res.json(planResultStudioGc({
        workspaceRoot: context.project.workspace_path,
        projectId,
      }, { repository: context.repository, adapter: context.binding.adapter }));
    } catch (error) {
      return res.status(409).json({ error: error.code || 'gc_plan_failed', message: error.message });
    }
  });

  app.get('/api/result-studio/storage/deduplicate', (req, res) => {
    const projectId = String(req.query.projectId || '').trim();
    const context = projectContext(req, projectId);
    if (context.error) return res.status(context.error.status).json({ error: context.error.code });
    try {
      return res.json(planArtifactDeduplication({ workspaceRoot: context.project.workspace_path, projectId }, { repository: context.repository }));
    } catch (error) {
      return res.status(409).json({ error: error.code || 'dedup_plan_failed', message: error.message });
    }
  });

  app.post('/api/result-studio/storage/deduplicate', (req, res) => {
    const projectId = String(req.body?.projectId || '').trim();
    const context = projectContext(req, projectId, { write: true });
    if (context.error) return res.status(context.error.status).json({ error: context.error.code });
    try {
      return res.json(executeArtifactDeduplication({
        workspaceRoot: context.project.workspace_path,
        projectId,
        planToken: String(req.body?.planToken || ''),
      }, { repository: context.repository }));
    } catch (error) {
      return res.status(409).json({ error: error.code || 'dedup_execute_failed', message: error.message });
    }
  });

  app.post('/api/result-studio/storage/gc', (req, res) => {
    const projectId = String(req.body?.projectId || '').trim();
    const context = projectContext(req, projectId, { write: true });
    if (context.error) return res.status(context.error.status).json({ error: context.error.code });
    try {
      return res.json(executeResultStudioGc({
        workspaceRoot: context.project.workspace_path,
        projectId,
        planToken: String(req.body?.planToken || ''),
      }, { repository: context.repository, adapter: context.binding.adapter }));
    } catch (error) {
      return res.status(409).json({ error: error.code || 'gc_execute_failed', message: error.message });
    }
  });

  app.get('/api/result-studio/preview-budget', (req, res) => {
    const projectId = String(req.query.projectId || '').trim();
    const context = projectContext(req, projectId);
    if (context.error) return res.status(context.error.status).json({ error: context.error.code });
    let disk = null;
    try {
      if (typeof fs.statfsSync === 'function') {
        const stat = fs.statfsSync(context.project.workspace_path);
        disk = { availableBytes: Number(stat.bavail) * Number(stat.bsize), totalBytes: Number(stat.blocks) * Number(stat.bsize) };
      }
    } catch { /* snapshot reports unknown disk */ }
    const activePreviewJobs = context.repository.listChangeSets({ projectId, status: 'running', limit: 500 }).length;
    return res.json(buildContextBoundPreviewBudget({ disk, activePreviewJobs }));
  });

  app.get('/api/result-studio/revisions/:revisionId/table-page', (req, res) => {
    const revision = repo().getRevision(String(req.params.revisionId || '').trim());
    if (!revision) return res.status(404).json({ error: 'revision_not_found' });
    const context = projectContext(req, revision.projectId, { git: false });
    if (context.error) return res.status(context.error.status).json({ error: context.error.code });
    if (!TABLE_EXTENSIONS.test(revision.outputPath)) return res.status(415).json({ error: 'revision_not_table' });
    try {
      const filePath = resolveWorkspaceFileForRevision(context.project.workspace_path, revision);
      return res.json(readTablePage({
        filePath,
        expectedSha256: revision.outputHash,
        cursor: Number(req.query.cursor || 0),
        limit: Number(req.query.limit || 100),
      }));
    } catch (error) {
      return res.status(409).json({ error: error.code || 'table_page_failed', message: error.message });
    }
  });

  app.post('/api/result-studio/changesets/:changeSetId/adopt', (req, res) => {
    const context = changeSetContext(req, String(req.params.changeSetId || '').trim(), { write: true });
    if (context.error) return res.status(context.error.status).json({ error: context.error.code, bindingStatus: context.error.bindingStatus });
    try {
      const result = adoptResultChangeSet({
        projectId: context.project.id,
        workspaceRoot: context.project.workspace_path,
        changeSetId: context.changeSet.changeSetId,
      }, {
        repository: context.repository,
        adapter: context.binding.adapter,
        gitPathPrefix: context.gitPathPrefix,
        getToolJob: db.getToolJob,
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(409).json({ error: error.code || 'adopt_failed', message: error.message, detail: error.detail || null });
    }
  });

  app.post('/api/result-studio/changesets/:changeSetId/revert', (req, res) => {
    const context = changeSetContext(req, String(req.params.changeSetId || '').trim(), { write: true });
    if (context.error) return res.status(context.error.status).json({ error: context.error.code, bindingStatus: context.error.bindingStatus });
    try {
      const result = revertResultChangeSet({
        projectId: context.project.id,
        workspaceRoot: context.project.workspace_path,
        changeSetId: context.changeSet.changeSetId,
        reason: req.body?.reason || 'user_reverted',
      }, {
        repository: context.repository,
        adapter: context.binding.adapter,
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(409).json({ error: error.code || 'revert_failed', message: error.message, detail: error.detail || null });
    }
  });

  app.post('/api/result-studio/revisions/:revisionId/restore', (req, res) => {
    const revision = repo().getRevision(String(req.params.revisionId || '').trim());
    if (!revision) return res.status(404).json({ error: 'revision_not_found' });
    const context = projectContext(req, revision.projectId, { write: true });
    if (context.error) return res.status(context.error.status).json({ error: context.error.code, bindingStatus: context.error.bindingStatus });
    try {
      const result = restoreArtifactRevision({
        projectId: context.project.id,
        workspaceRoot: context.project.workspace_path,
        revisionId: revision.revisionId,
        conversationId: req.body?.conversationId || null,
        createdBy: 'user',
      }, {
        repository: context.repository,
        adapter: context.binding.adapter,
        gitPathPrefix: context.gitPathPrefix,
        getToolJob: db.getToolJob,
        getResultStudioDescriptor: (toolId) => pluginLoader.getPluginManifest(toolId)?.resultStudio || null,
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(409).json({ error: error.code || 'restore_failed', message: error.message, detail: error.detail || null });
    }
  });

  app.get('/api/result-studio/revisions/:revisionId/artifact', async (req, res) => {
    const revision = repo().getRevision(String(req.params.revisionId || '').trim());
    if (!revision) return res.status(404).json({ error: 'revision_not_found' });
    const context = projectContext(req, revision.projectId, { git: false });
    if (context.error) return res.status(context.error.status).json({ error: context.error.code });
    try {
      const opened = await openVerifiedRevisionArtifact(context.project.workspace_path, revision);
      const stream = createVerifiedSnapshotReadStream(opened);
      stream.once('error', (error) => {
        if (!res.headersSent) res.status(404).json({ error: 'revision_artifact_unavailable' });
        else res.destroy(error);
      });
      res
        .type(artifactContentTypeHint(opened.artifactPath))
        .set('Cache-Control', 'private, no-store')
        .set('Content-Length', String(opened.stat.size));
      return pipeVerifiedSnapshotToResponse(stream, req, res);
    } catch (error) {
      return res.status(404).json({ error: 'revision_artifact_unavailable', message: error.message });
    }
  });
};

module.exports._test = {
  baselineFailureDiagnostic,
  bindAuthoritativeQuerySelection,
  buildContextBoundPreviewBudget,
  findArtifactRecord,
  openVerifiedRevisionArtifact,
  publicResultStudioErrorMessage,
  resolveArtifactPath,
  resolveInteractionBaselineRevision,
  verifyArtifactRecordBytes,
};
