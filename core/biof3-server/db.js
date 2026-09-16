/**
 * SQLite database layer for BioF3 scRNA platform.
 *
 * Tables: projects, datasets, analyses
 * Uses better-sqlite3 (synchronous, fast, zero-config).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { v4: _uuidv4 } = require('uuid');
const {
  LEGACY_BASELINE_ID,
  PROJECT_BASELINE_RECORD_VERSION,
  getCurrentG0Baseline,
  evaluateProjectBaselineCompatibility,
} = require('../shared-backend/g0-baseline');
const { runTaskConfirmationHooks } = require('../shared-backend/task-confirmation-hooks');

// BLOCK-92 Wave C-3 — 连接/DDL/用户与设置/子集与标签已拆入 db/ 子模块
// （纯搬运零行为变化）；本文件保留 stmts 预编译注册表与其余主 DAO 群，
// module.exports 面逐符号保持不变（消费方零改动）。
const {
  db,
  getDatabase,
  closeDatabase,
  createAsyncDatabaseFacade,
  getAsyncDatabase,
  uid,
  now,
} = require('./db/connection');
const {
  getUserByUsername,
  getUserById,
  createUser,
  getUserByUsernameAsync,
  getUserByIdAsync,
  createUserAsync,
  listUsers,
  updateUser,
  deleteUser,
  listUsersAsync,
  updateUserAsync,
  deleteUserAsync,
  getSiteSetting,
  setSiteSetting,
  getSiteSettingAsync,
  setSiteSettingAsync,
} = require('./db/users');
const {
  listSubsets,
  getSubset,
  createSubset,
  updateSubset,
  deleteSubset,
  listCellLabels,
  getCellLabel,
  createCellLabel,
  deleteCellLabel,
  getLabelsSummary,
} = require('./db/subsets-labels');


const stmts = {
  listProjects: db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY updated_at DESC'),
  // W1-3: modality-filtered listing (used by /spatial and /single-cell pages)
  listProjectsByModality: db.prepare(
    'SELECT * FROM projects WHERE modality = ? AND status = ? ORDER BY updated_at DESC'
  ),
  getProject: db.prepare('SELECT * FROM projects WHERE id = ?'),
  insertProject: db.prepare(
    'INSERT INTO projects (id, name, description, created_at, updated_at, modality, workspace_path, workspace_kind, ssh_host, remote_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  updateProject: db.prepare(
    'UPDATE projects SET name = COALESCE(?, name), description = COALESCE(?, description), workspace_path = COALESCE(?, workspace_path), updated_at = ? WHERE id = ?'
  ),
  updateProjectStatus: db.prepare(
    'UPDATE projects SET status = ?, updated_at = ? WHERE id = ?'
  ),
  setProjectWorkspacePath: db.prepare(
    'UPDATE projects SET workspace_path = ?, updated_at = ? WHERE id = ?'
  ),
  deleteProject: db.prepare('DELETE FROM projects WHERE id = ?'),
  touchProject: db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?'),
  getProjectG0Baseline: db.prepare('SELECT * FROM project_g0_baselines WHERE project_id = ?'),
  insertProjectG0Baseline: db.prepare(
    `INSERT INTO project_g0_baselines (
      project_id, record_version,
      created_baseline_id, created_baseline_version, created_manifest_digest, created_bundle_digest,
      opened_baseline_id, opened_baseline_version, opened_manifest_digest, opened_bundle_digest,
      compatibility_status, compatibility_reason,
      first_recorded_at, last_opened_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updateProjectG0BaselineOpen: db.prepare(
    `UPDATE project_g0_baselines SET
      opened_baseline_id = ?,
      opened_baseline_version = ?,
      opened_manifest_digest = ?,
      opened_bundle_digest = ?,
      compatibility_status = ?,
      compatibility_reason = ?,
      last_opened_at = ?
    WHERE project_id = ?`
  ),
  deleteProjectG0Baseline: db.prepare('DELETE FROM project_g0_baselines WHERE project_id = ?'),

  // Datasets
  listDatasets: db.prepare('SELECT * FROM datasets WHERE project_id = ? ORDER BY uploaded_at DESC'),
  getDataset: db.prepare('SELECT * FROM datasets WHERE id = ?'),
  insertDataset: db.prepare(
    'INSERT INTO datasets (id, project_id, name, oss_url, size, description, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ),
  updateDataset: db.prepare(
    'UPDATE datasets SET name = COALESCE(?, name), n_cells = COALESCE(?, n_cells), n_genes = COALESCE(?, n_genes), description = COALESCE(?, description) WHERE id = ?'
  ),
  deleteDataset: db.prepare('DELETE FROM datasets WHERE id = ?'),

  // Analyses
  listAnalyses: db.prepare('SELECT * FROM analyses WHERE dataset_id = ? ORDER BY created_at DESC'),
  getAnalysis: db.prepare('SELECT * FROM analyses WHERE id = ?'),
  getAnalysisByTask: db.prepare('SELECT * FROM analyses WHERE task_id = ?'),
  insertAnalysis: db.prepare(
    'INSERT INTO analyses (id, dataset_id, task_id, type, name, parent_analysis_id, params, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  updateAnalysis: db.prepare(
    'UPDATE analyses SET name = COALESCE(?, name), status = COALESCE(?, status), summary = COALESCE(?, summary), error = COALESCE(?, error), finished_at = COALESCE(?, finished_at), results = COALESCE(?, results) WHERE id = ?'
  ),
  updateAnalysisByTask: db.prepare(
    'UPDATE analyses SET status = COALESCE(?, status), summary = COALESCE(?, summary), error = COALESCE(?, error), finished_at = COALESCE(?, finished_at), results = COALESCE(?, results) WHERE task_id = ?'
  ),
  deleteAnalysis: db.prepare('DELETE FROM analyses WHERE id = ?'),
  deleteAnalysesByDataset: db.prepare('DELETE FROM analyses WHERE dataset_id = ?'),
  // tool_jobs（bulk 工具执行记录，方案 C）
  getToolJob: db.prepare('SELECT * FROM tool_jobs WHERE id = ?'),
  listProjectToolJobs: db.prepare(
    'SELECT * FROM tool_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 200'
  ),
  listProjectToolJobsByConversation: db.prepare(
    'SELECT * FROM tool_jobs WHERE project_id = ? AND conversation_id = ? ORDER BY created_at DESC LIMIT 200'
  ),
  // Workflow Truth must see the complete project history.  The bounded query
  // above is a UI/listing projection and can silently drop an older parent.
  listProjectToolJobsForWorkflow: db.prepare(
    'SELECT * FROM tool_jobs WHERE project_id = ? ORDER BY created_at ASC, id ASC'
  ),
  insertToolJob: db.prepare(
    'INSERT INTO tool_jobs (id, user_id, tool_id, params_json, status, created_at, name, is_test_run, project_id, conversation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  updateToolJob: db.prepare(
    'UPDATE tool_jobs SET status = COALESCE(?, status), result_json = COALESCE(?, result_json), completed_at = COALESCE(?, completed_at), error = COALESCE(?, error) WHERE id = ?'
  ),
  updateToolJobParams: db.prepare('UPDATE tool_jobs SET params_json=? WHERE id=?'),
  prepareToolJobForRun: db.prepare(
    'UPDATE tool_jobs SET params_json=?, status=?, name=COALESCE(?, name), error=NULL, completed_at=NULL WHERE id=?'
  ),
};


function getLocalDataRoot() {
  return (
    process.env.BIOF3_LOCAL_DATA_DIR ||
    path.join(os.homedir(), 'Documents', 'BioF3-Local')
  );
}

function safeProjectSlug(name) {
  const slug = String(name || 'project')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'project';
}

function defaultProjectWorkspacePath(project) {
  const shortId = String(project.id || 'local').replace(/^p_/, '').slice(0, 8);
  return path.join(getLocalDataRoot(), 'projects', `${safeProjectSlug(project.name)}-${shortId}`);
}

function ensureWorkspaceDir(workspacePath) {
  if (!workspacePath) return;
  try {
    fs.mkdirSync(workspacePath, { recursive: true });
  } catch {}
}

function hydrateProjectWorkspace(project) {
  if (!project) return project;
  // BLOCK-67：ssh 项目本地不落 workspace_path（远程唯一真值），不补缺省目录。
  if (project.workspace_kind === 'ssh') return project;
  if (project.workspace_path) {
    ensureWorkspaceDir(project.workspace_path);
    return project;
  }
  const workspacePath = defaultProjectWorkspacePath(project);
  try {
    stmts.setProjectWorkspacePath.run(workspacePath, now(), project.id);
  } catch {}
  ensureWorkspaceDir(workspacePath);
  return { ...project, workspace_path: workspacePath };
}

// BLOCK-67：ssh 项目字段校验（fail-closed）。alias 走 ssh-transport assertAlias 同型白名单；
// remote_path 必须绝对 POSIX 路径且不含 .. 与控制字符。
function validateSshProjectFields({ sshHost, remotePath }) {
  if (typeof sshHost !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(sshHost)) return 'invalid_ssh_host';
  if (
    typeof remotePath !== 'string'
    || !remotePath.startsWith('/')
    || remotePath.includes('..')
    || /[\0\r\n]/.test(remotePath)
    || remotePath.length > 4096
  ) return 'invalid_remote_path';
  return null;
}

function projectBaselineView(row, compatibility) {
  const current = compatibility.current || getCurrentG0Baseline();
  return {
    recordVersion: Number(row.record_version || PROJECT_BASELINE_RECORD_VERSION),
    createdBaselineId: row.created_baseline_id,
    createdBaselineVersion: row.created_baseline_version || null,
    createdManifestDigest: row.created_manifest_digest || null,
    createdBundleDigest: row.created_bundle_digest || null,
    openedBaselineId: row.opened_baseline_id || current.baselineId,
    openedBaselineVersion: row.opened_baseline_version || current.baselineVersion,
    openedManifestDigest: row.opened_manifest_digest || current.manifestDigest,
    openedBundleDigest: row.opened_bundle_digest || current.bundleDigest,
    compatibilityStatus: compatibility.status,
    compatibilityReason: compatibility.reason,
    executionAllowed: compatibility.executionAllowed === true,
    migrationRequired: compatibility.migrationRequired === true,
    firstRecordedAt: row.first_recorded_at || null,
    lastOpenedAt: row.last_opened_at || null,
  };
}

function ensureProjectG0Baseline(project, options = {}) {
  if (!project) return project;
  const current = getCurrentG0Baseline();
  const existing = stmts.getProjectG0Baseline.get(project.id);
  const ts = now();

  if (!existing) {
    const createdByCurrent = options.createdByCurrent === true;
    const seed = {
      record_version: PROJECT_BASELINE_RECORD_VERSION,
      created_baseline_id: createdByCurrent ? current.baselineId : LEGACY_BASELINE_ID,
      created_baseline_version: createdByCurrent ? current.baselineVersion : null,
      created_manifest_digest: createdByCurrent ? current.manifestDigest : null,
      created_bundle_digest: createdByCurrent ? current.bundleDigest : null,
      opened_baseline_id: current.baselineId,
      opened_baseline_version: current.baselineVersion,
      opened_manifest_digest: current.manifestDigest,
      opened_bundle_digest: current.bundleDigest,
      first_recorded_at: ts,
      last_opened_at: ts,
    };
    const compatibility = evaluateProjectBaselineCompatibility(seed);
    if (options.persist !== false) {
      stmts.insertProjectG0Baseline.run(
        project.id,
        seed.record_version,
        seed.created_baseline_id,
        seed.created_baseline_version,
        seed.created_manifest_digest,
        seed.created_bundle_digest,
        current.baselineId,
        current.baselineVersion,
        current.manifestDigest,
        current.bundleDigest,
        compatibility.status,
        compatibility.reason,
        ts,
        ts,
      );
    }
    return {
      ...project,
      g0_baseline: projectBaselineView(seed, compatibility),
    };
  }

  const compatibility = evaluateProjectBaselineCompatibility(existing);
  const shouldRefresh =
    existing.opened_baseline_id !== current.baselineId
    || existing.opened_baseline_version !== current.baselineVersion
    || existing.opened_manifest_digest !== current.manifestDigest
    || existing.opened_bundle_digest !== current.bundleDigest
    || existing.compatibility_status !== compatibility.status
    || existing.compatibility_reason !== compatibility.reason;
  if (options.recordOpen === true && shouldRefresh) {
    stmts.updateProjectG0BaselineOpen.run(
      current.baselineId,
      current.baselineVersion,
      current.manifestDigest,
      current.bundleDigest,
      compatibility.status,
      compatibility.reason,
      ts,
      project.id,
    );
  }
  return {
    ...project,
    g0_baseline: projectBaselineView(
      {
        ...existing,
        ...(options.recordOpen === true && shouldRefresh ? {
          opened_baseline_id: current.baselineId,
          opened_baseline_version: current.baselineVersion,
          opened_manifest_digest: current.manifestDigest,
          opened_bundle_digest: current.bundleDigest,
        } : {}),
        last_opened_at: options.recordOpen === true && shouldRefresh ? ts : existing.last_opened_at,
      },
      compatibility,
    ),
  };
}

function hydrateProject(project, options = {}) {
  return ensureProjectG0Baseline(hydrateProjectWorkspace(project), options);
}

// ---- Projects ----

function listProjects(status = 'active') {
  const normalizedStatus = status === 'archived' ? 'archived' : 'active';
  return stmts.listProjects.all(normalizedStatus).map((project) => hydrateProject(project, { persist: false }));
}

// W1-3: list projects by modality (single-cell | spatial | bulk).
// Pass null/undefined to get everything (back-compat with existing callers).
function listProjectsByModality(modality, status = 'active') {
  const normalizedStatus = status === 'archived' ? 'archived' : 'active';
  if (!modality) return stmts.listProjects.all(normalizedStatus).map((project) => hydrateProject(project, { persist: false }));
  return stmts.listProjectsByModality.all(modality, normalizedStatus).map((project) => hydrateProject(project, { persist: false }));
}

function getProject(id) {
  return hydrateProject(stmts.getProject.get(id) || null, { recordOpen: true });
}

function createProject({ name, description, modality, userId, workspacePath, workspaceKind, sshHost, remotePath }) {
  const id = uid('p');
  const ts = now();
  // BLOCK-67：ssh 项目 —— workspace 三字段定死不可运行时切换（防双模式回潮），
  // 本地不建 workspace 目录；local 项目行为与既有逐字节同语义（零回归红线）。
  if (workspaceKind === 'ssh') {
    const invalid = validateSshProjectFields({ sshHost, remotePath });
    if (invalid) {
      const error = new Error(invalid);
      error.code = invalid;
      throw error;
    }
    stmts.insertProject.run(id, name, description || '', ts, ts, modality || 'single-cell', null, 'ssh', sshHost, remotePath);
    return hydrateProject(stmts.getProject.get(id), { createdByCurrent: true, recordOpen: true });
  }
  const finalWorkspacePath = workspacePath || defaultProjectWorkspacePath({ id, name });
  ensureWorkspaceDir(finalWorkspacePath);
  stmts.insertProject.run(id, name, description || '', ts, ts, modality || 'single-cell', finalWorkspacePath, 'local', null, null);
  return hydrateProject(stmts.getProject.get(id), {
    createdByCurrent: true,
    recordOpen: true,
  });
}

function getProjectG0Baseline(projectId) {
  const project = stmts.getProject.get(projectId);
  return project ? hydrateProject(project, { recordOpen: true }).g0_baseline : null;
}

function setProjectUserId(projectId, userId) {
  db.prepare('UPDATE projects SET user_id = ? WHERE id = ?').run(userId, projectId);
}

// Toggle a project's public flag.
function setProjectPublic(projectId, isPublic) {
  db.prepare('UPDATE projects SET is_public = ? WHERE id = ?').run(isPublic ? 1 : 0, projectId);
}

function updateProject(id, { name, description, workspacePath }) {
  if (workspacePath) ensureWorkspaceDir(workspacePath);
  stmts.updateProject.run(name || null, description ?? null, workspacePath || null, now(), id);
  return hydrateProject(stmts.getProject.get(id), { recordOpen: true });
}

function setProjectStatus(id, status) {
  const normalizedStatus = status === 'archived' ? 'archived' : 'active';
  stmts.updateProjectStatus.run(normalizedStatus, now(), id);
  return hydrateProject(stmts.getProject.get(id), { recordOpen: true });
}

function deleteProject(id) {
  const datasets = stmts.listDatasets.all(id);
  for (const ds of datasets) {
    stmts.deleteAnalysesByDataset.run(ds.id);
  }
  db.prepare('DELETE FROM datasets WHERE project_id = ?').run(id);
  stmts.deleteProjectG0Baseline.run(id);
  stmts.deleteProject.run(id);
}

// ---- Datasets ----

function listDatasets(projectId) {
  return stmts.listDatasets.all(projectId);
}

function getDataset(id) {
  return stmts.getDataset.get(id) || null;
}

function createDataset({ projectId, name, ossUrl, size, description }) {
  const id = uid('d');
  stmts.insertDataset.run(id, projectId, name, ossUrl, size || 0, description || '', now());
  stmts.touchProject.run(now(), projectId);
  return stmts.getDataset.get(id);
}

function updateDataset(id, { name, nCells, nGenes, description }) {
  stmts.updateDataset.run(name ?? null, nCells ?? null, nGenes ?? null, description ?? null, id);
  return stmts.getDataset.get(id);
}

function deleteDataset(id) {
  stmts.deleteAnalysesByDataset.run(id);
  stmts.deleteDataset.run(id);
}

// Set data-preview URLs (meta_url/features_url). Used by task-manager after
// exporting metadata.csv/features.csv.
function setDatasetMetaUrls(id, { metaUrl, featuresUrl }) {
  db.prepare('UPDATE datasets SET meta_url = ?, features_url = ? WHERE id = ?').run(
    metaUrl ?? null,
    featuresUrl ?? null,
    id
  );
  return stmts.getDataset.get(id);
}

// ---- Analyses ----

function listAnalyses(datasetId) {
  const rows = stmts.listAnalyses.all(datasetId);
  return rows.map(parseAnalysisRow);
}

function getAnalysis(id) {
  const row = stmts.getAnalysis.get(id);
  return row ? parseAnalysisRow(row) : null;
}

function getAnalysisByTaskId(taskId) {
  const row = stmts.getAnalysisByTask.get(taskId);
  return row ? parseAnalysisRow(row) : null;
}

async function getAnalysisByTaskIdAsync(taskId) {
  const row = stmts.getAnalysisByTask.get(taskId);
  return row ? parseAnalysisRow(row) : null;
}

function createAnalysis({ datasetId, taskId, type, name, parentAnalysisId, params, status }) {
  const id = uid('a');
  stmts.insertAnalysis.run(
    id,
    datasetId,
    taskId || null,
    type,
    name,
    parentAnalysisId || null,
    JSON.stringify(params || {}),
    status || 'pending',
    now()
  );
  const ds = stmts.getDataset.get(datasetId);
  if (ds) stmts.touchProject.run(now(), ds.project_id);
  return getAnalysis(id);
}

function updateAnalysis(id, { name, status, summary, error, finishedAt, results }) {
  stmts.updateAnalysis.run(
    name || null,
    status || null,
    summary ? JSON.stringify(summary) : null,
    error || null,
    finishedAt || null,
    results ? JSON.stringify(results) : null,
    id
  );
  return getAnalysis(id);
}

function updateAnalysisByTaskId(taskId, { status, summary, error, finishedAt, results }) {
  stmts.updateAnalysisByTask.run(
    status || null,
    summary ? JSON.stringify(summary) : null,
    error || null,
    finishedAt || null,
    results ? JSON.stringify(results) : null,
    taskId
  );
  return getAnalysisByTaskId(taskId);
}

function deleteAnalysis(id) {
  stmts.deleteAnalysis.run(id);
}

// ---- Tool jobs（bulk 工具执行记录，方案 C）----

function getToolJob(id) {
  const row = stmts.getToolJob.get(id);
  return row ? parseToolJobRow(row) : null;
}

function listProjectToolJobs(projectId, conversationId = undefined) {
  const rows = conversationId == null
    ? stmts.listProjectToolJobs.all(projectId)
    : stmts.listProjectToolJobsByConversation.all(projectId, conversationId);
  return rows.map(parseToolJobRow);
}

function listProjectToolJobsForWorkflow(projectId) {
  const rows = stmts.listProjectToolJobsForWorkflow.all(projectId);
  return rows.map(parseToolJobRow);
}

function createToolJob({ toolId, userId = 'agent', params, status = 'running', name = '', isTestRun = 0, projectId = null, conversationId = null }) {
  const id = uid('tj');
  const normalizedConversationId = typeof conversationId === 'string' && conversationId.trim()
    ? conversationId.trim()
    : null;
  stmts.insertToolJob.run(
    id,
    userId,
    toolId,
    JSON.stringify(params || {}),
    status,
    Date.now(),
    name,
    isTestRun,
    projectId,
    normalizedConversationId
  );
  return getToolJob(id);
}

function updateToolJob(id, { status, resultJson, completedAt, error }) {
  stmts.updateToolJob.run(
    status || null,
    resultJson != null ? (typeof resultJson === 'string' ? resultJson : JSON.stringify(resultJson)) : null,
    completedAt != null ? completedAt : null,
    error || null,
    id
  );
  return getToolJob(id);
}

function saveScientificTaskSpec({ spec, specHash, confirmation = null, version = 1, toolJobId = null }) {
  if (!spec || !spec.taskId || !spec.projectId || !spec.conversationId || !specHash) {
    throw new Error('scientific_task_spec_persistence_fields_required');
  }
  const timestamp = new Date().toISOString();
  const existing = getScientificTaskSpec(spec.taskId, version);
  if (existing && existing.spec_hash !== specHash) {
    throw new Error('scientific_task_version_immutable');
  }
  db.prepare(`
    INSERT INTO scientific_task_specs(
      task_id, version, project_id, conversation_id, status, spec_json,
      spec_hash, confirmation_json, tool_job_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id, version) DO UPDATE SET
      confirmation_json=COALESCE(excluded.confirmation_json, scientific_task_specs.confirmation_json),
      tool_job_id=COALESCE(excluded.tool_job_id, scientific_task_specs.tool_job_id),
      updated_at=excluded.updated_at
  `).run(
    spec.taskId, version, spec.projectId, spec.conversationId, spec.status,
    JSON.stringify(spec), specHash, confirmation ? JSON.stringify(confirmation) : null,
    toolJobId, timestamp, timestamp
  );
  return getScientificTaskSpec(spec.taskId, version);
}

function parseScientificTaskRow(row) {
  if (!row) return null;
  return {
    ...row,
    spec: JSON.parse(row.spec_json),
    confirmation: row.confirmation_json ? JSON.parse(row.confirmation_json) : null,
  };
}

function getScientificTaskSpec(taskId, version = null) {
  const row = version == null
    ? db.prepare('SELECT * FROM scientific_task_specs WHERE task_id=? ORDER BY version DESC LIMIT 1').get(taskId)
    : db.prepare('SELECT * FROM scientific_task_specs WHERE task_id=? AND version=?').get(taskId, version);
  return parseScientificTaskRow(row);
}

function listConversationScientificTasks(conversationId) {
  return db.prepare('SELECT * FROM scientific_task_specs WHERE conversation_id=? ORDER BY updated_at DESC').all(conversationId).map(parseScientificTaskRow);
}

function getScientificTaskByToolJob(toolJobId) {
  return parseScientificTaskRow(db.prepare('SELECT * FROM scientific_task_specs WHERE tool_job_id=?').get(toolJobId));
}

function bindScientificTaskToolJob({ taskId, version = 1, toolJobId }) {
  const job = getToolJob(toolJobId);
  const task = getScientificTaskSpec(taskId, version);
  if (!task) throw new Error('scientific_task_not_found');
  if (!job) throw new Error('tool_job_not_found');
  if (task.project_id !== job.project_id) throw new Error('scientific_task_job_project_mismatch');
  if (task.conversation_id !== job.conversation_id) throw new Error('scientific_task_job_conversation_mismatch');
  if (task.status !== 'confirmed') throw new Error('scientific_task_not_confirmed');
  if (!task.confirmation) throw new Error('scientific_task_confirmation_missing');
  if (task.confirmation.userId !== job.user_id) throw new Error('scientific_task_job_user_mismatch');
  // BLOCK-83 D3：执行确认经领域钩子注册表（核心零注册 = 直通）；科学确认由 plugin-loader 装配注册。
  const executionGate = runTaskConfirmationHooks({
    persistedTask: task,
    projectId: job.project_id,
    toolId: job.tool_id,
    params: job.params || {},
  });
  if (!executionGate.ok) throw new Error(executionGate.error);
  db.prepare('UPDATE scientific_task_specs SET tool_job_id=?, updated_at=? WHERE task_id=? AND version=?')
    .run(toolJobId, new Date().toISOString(), taskId, version);
  return getScientificTaskSpec(taskId, version);
}

function saveContextCheckpoint(checkpoint) {
  if (!checkpoint?.checkpointId || !checkpoint.projectId || !checkpoint.conversationId || !checkpoint.sourceDigest || !checkpoint.createdAt) {
    throw new Error('context_checkpoint_persistence_fields_required');
  }
  const existing = getContextCheckpoint(checkpoint.checkpointId);
  if (existing && existing.sourceDigest !== checkpoint.sourceDigest) throw new Error('context_checkpoint_immutable');
  db.prepare(`
    INSERT INTO context_checkpoints(
      checkpoint_id, project_id, conversation_id, source_digest,
      checkpoint_json, supersedes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(checkpoint_id) DO NOTHING
  `).run(
    checkpoint.checkpointId,
    checkpoint.projectId,
    checkpoint.conversationId,
    checkpoint.sourceDigest,
    JSON.stringify(checkpoint),
    checkpoint.supersedes || null,
    checkpoint.createdAt
  );
  return getContextCheckpoint(checkpoint.checkpointId);
}

function parseContextCheckpointRow(row) {
  if (!row) return null;
  return JSON.parse(row.checkpoint_json);
}

function getContextCheckpoint(checkpointId) {
  return parseContextCheckpointRow(db.prepare('SELECT * FROM context_checkpoints WHERE checkpoint_id=?').get(checkpointId));
}

function listContextCheckpoints(projectId, conversationId) {
  return db.prepare(`
    SELECT * FROM context_checkpoints
    WHERE project_id=? AND conversation_id=?
    ORDER BY created_at DESC
  `).all(projectId, conversationId).map(parseContextCheckpointRow);
}

function getLatestContextCheckpoint(projectId, conversationId) {
  return parseContextCheckpointRow(db.prepare(`
    SELECT * FROM context_checkpoints
    WHERE project_id=? AND conversation_id=?
    ORDER BY created_at DESC LIMIT 1
  `).get(projectId, conversationId));
}

// HLE-1: LoopRun / Iteration / Action / Evidence / Decision / Snapshot repository.
// Persistence layer for core/shared-backend/loop-contract.js. Idempotent on
// action_key (UNIQUE) and on (loop_run_id, sequence) for iterations. Legacy
// conversations without a loop_run row fall back to projectLoopRunPartial()
// in loop-contract.js and must NOT be fabricated here.

function persistLoopRun(loopRun) {
  if (!loopRun?.loopRunId || !loopRun?.projectId || !loopRun?.conversationId || !loopRun?.hash) {
    throw new Error('loop_run_persistence_fields_required');
  }
  const existing = db.prepare('SELECT loop_status_hash AS hash FROM loop_runs WHERE loop_run_id=?').get(loopRun.loopRunId);
  if (existing && existing.hash !== loopRun.hash) {
    throw new Error('loop_run_immutable');
  }
  db.prepare(`
    INSERT INTO loop_runs(
      loop_run_id, project_id, conversation_id, task_spec_ref, automation_mode,
      loop_status, loop_status_hash, loop_status_json,
      is_partial, partial_reason, kind, parent_loop_run_id, task_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(loop_run_id) DO NOTHING
  `).run(
    loopRun.loopRunId,
    loopRun.projectId,
    loopRun.conversationId,
    loopRun.taskSpecRef || null,
    loopRun.automationMode || null,
    loopRun.loopStatus,
    loopRun.hash,
    JSON.stringify(loopRun),
    loopRun.isPartial ? 1 : 0,
    loopRun.partialReason || null,
    loopRun.kind || 'primary',
    loopRun.parentLoopRunId || null,
    loopRun.taskId || null,
    loopRun.createdAt || new Date().toISOString(),
    loopRun.updatedAt || loopRun.createdAt || new Date().toISOString(),
  );
  return getLoopRun(loopRun.loopRunId);
}

function updateLoopRunStatus(loopRunId, { loopStatus, hash, json, updatedAt }) {
  if (!loopRunId || !loopStatus || !hash) {
    throw new Error('loop_run_status_fields_required');
  }
  const existingRow = db.prepare('SELECT loop_status FROM loop_runs WHERE loop_run_id=?').get(loopRunId);
  if (!existingRow) throw new Error('loop_run_not_found');
  const transition = require('../shared-backend/loop-contract').checkLoopStatusTransition(
    existingRow.loop_status,
    loopStatus,
  );
  if (transition instanceof Error) throw transition;
  db.prepare(`
    UPDATE loop_runs SET loop_status=?, loop_status_hash=?, loop_status_json=?, updated_at=?
    WHERE loop_run_id=?
  `).run(loopStatus, hash, json || null, updatedAt || new Date().toISOString(), loopRunId);
  return getLoopRun(loopRunId);
}

function getLoopRun(loopRunId) {
  if (!loopRunId) return null;
  const row = db.prepare('SELECT * FROM loop_runs WHERE loop_run_id=?').get(loopRunId);
  if (!row) return null;
  const record = safeParseJson(row.loop_status_json);
  const {
    normalizeLoopAutomationMode,
    normalizeLoopExecutionIntent,
  } = require('../shared-backend/loop-contract');
  return {
    loopRunId: row.loop_run_id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    taskSpecRef: row.task_spec_ref,
    automationMode: normalizeLoopAutomationMode(row.automation_mode),
    executionIntent: normalizeLoopExecutionIntent(
      record?.executionIntent,
      row.automation_mode,
    ),
    loopStatus: row.loop_status,
    hash: row.loop_status_hash,
    kind: row.kind || 'primary',
    parentLoopRunId: row.parent_loop_run_id || null,
    taskId: row.task_id || null,
    isPartial: !!row.is_partial,
    partialReason: row.partial_reason,
    record,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// AGENT-CONCURRENCY: resolve a LoopRun by its owning task_id (sub-agent spawn
// needs the parent task's loopRunId; cancel cascade enumerates children).
function getLoopRunByTaskId(taskId) {
  if (!taskId) return null;
  const row = db.prepare('SELECT loop_run_id FROM loop_runs WHERE task_id=? ORDER BY updated_at DESC LIMIT 1').get(taskId);
  if (!row) return null;
  return getLoopRun(row.loop_run_id);
}

// AGENT-CONCURRENCY: enumerate child sub-agent LoopRuns for a parent primary
// LoopRun (used by the cancel cascade).
function getLoopRunsByParentLoopRunId(parentLoopRunId) {
  if (!parentLoopRunId) return [];
  const rows = db
    .prepare(
      `SELECT loop_run_id FROM loop_runs
       WHERE parent_loop_run_id=? AND (kind = 'subagent')
       ORDER BY updated_at ASC`
    )
    .all(parentLoopRunId);
  return rows.map((r) => getLoopRun(r.loop_run_id)).filter(Boolean);
}

function listLoopRunsForConversation(projectId, conversationId, { limit = 50 } = {}) {
  if (!projectId && !conversationId) return [];
  const clauses = [];
  const params = [];
  if (projectId) { clauses.push('project_id=?'); params.push(projectId); }
  if (conversationId) { clauses.push('conversation_id=?'); params.push(conversationId); }
  const rows = db.prepare(`
    SELECT loop_run_id FROM loop_runs
    WHERE ${clauses.join(' AND ')}
    ORDER BY updated_at DESC LIMIT ?
  `).all(...params, limit);
  return rows.map((row) => getLoopRun(row.loop_run_id));
}

function listRunningLoopRuns() {
  return db.prepare(`
    SELECT * FROM loop_runs
    WHERE loop_status = 'running'
    ORDER BY updated_at ASC
  `).all().map((row) => {
    const run = getLoopRun(row.loop_run_id);
    return {
      ...run,
      loopStatusHash: run.hash,
      loopStatusJson: row.loop_status_json,
    };
  });
}

// HLE-C3R: Durable resume resolver. Returns the latest NON-TERMINAL LoopRun
// for a conversation so a multi-turn task reuses one run instead of minting a
// new run every turn. Terminal runs (completed/failed/cancelled) are excluded,
// so a run that a server restart marked failed(recovery_required) is NOT
// silently resumed here — recovery is surfaced through the recovery API.
//
// Resolution is by (projectId, conversationId) only. automationMode is
// deliberately NOT a filter: the closure-plan uniqueness key is
// projectId+conversationId+taskSpecHash, and a task_draft(planned) run must be
// resumable+advanceable by a later task_execute turn (draft -> execute is one
// logical run). 'planned' is included so that first-execution resume can
// advance it to 'running'.
function getActiveLoopRunForConversation(projectId, conversationId) {
  if (!projectId || !conversationId) return null;
  const row = db.prepare(`
    SELECT loop_run_id FROM loop_runs
    WHERE project_id=? AND conversation_id=?
      AND loop_status IN ('planned','running')
      AND (kind IS NULL OR kind = 'primary')
    ORDER BY updated_at DESC LIMIT 1
  `).get(projectId, conversationId);
  if (!row) return null;
  return getLoopRun(row.loop_run_id);
}

function listLoopActions(loopRunId, { limit = 200 } = {}) {
  if (!loopRunId) return [];
  return db.prepare(`
    SELECT * FROM loop_actions
    WHERE loop_run_id=?
    ORDER BY sequence DESC LIMIT ?
  `).all(loopRunId, limit).map(parseLoopActionRow);
}

function persistLoopIteration(iteration) {
  if (!iteration?.iterationId || !iteration?.loopRunId || !iteration?.hash) {
    throw new Error('loop_iteration_persistence_fields_required');
  }
  if (!Number.isInteger(iteration.sequence) || iteration.sequence < 1) {
    throw new Error('loop_iteration_sequence_invalid');
  }
  const existing = db.prepare('SELECT hash FROM loop_iterations WHERE iteration_id=?').get(iteration.iterationId);
  if (existing && existing.hash !== iteration.hash) {
    throw new Error('loop_iteration_immutable');
  }
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO loop_iterations(
        iteration_id, loop_run_id, sequence,
        observed_state_digest, goal_gap_ids_json,
        decision, decision_reason_code, confidence, notes,
        public_conclusion, status, hash, parent_iteration_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(iteration_id) DO NOTHING
    `).run(
      iteration.iterationId,
      iteration.loopRunId,
      iteration.sequence,
      iteration.observedStateDigest || null,
      JSON.stringify(iteration.goalGapIds || []),
      iteration.decision,
      iteration.decisionReasonCode,
      iteration.confidence,
      iteration.notes || null,
      iteration.publicConclusion || null,
      iteration.status,
      iteration.hash,
      iteration.parentIterationHash || null,
      iteration.createdAt,
    );
    if (iteration.proposedAction && iteration.proposedAction.actionId) {
      persistLoopAction({
        ...iteration.proposedAction,
        loopRunId: iteration.loopRunId,
        sequence: iteration.sequence,
        iterationId: iteration.iterationId,
      });
    }
    if (iteration.decision || iteration.decisionReasonCode) {
      const decisionHash = require('../shared-backend/loop-contract').stableHash({
        decision: iteration.decision,
        decisionReasonCode: iteration.decisionReasonCode,
        confidence: iteration.confidence,
        notes: iteration.notes,
      });
      persistLoopDecision({
        loopRunId: iteration.loopRunId,
        iterationId: iteration.iterationId,
        decision: iteration.decision,
        decisionReasonCode: iteration.decisionReasonCode,
        confidence: iteration.confidence,
        notes: iteration.notes,
        hash: decisionHash,
      });
    }
  });
  tx();
  return getLoopIteration(iteration.iterationId);
}

function getLoopIteration(iterationId) {
  if (!iterationId) return null;
  const row = db.prepare('SELECT * FROM loop_iterations WHERE iteration_id=?').get(iterationId);
  if (!row) return null;
  return {
    iterationId: row.iteration_id,
    loopRunId: row.loop_run_id,
    sequence: row.sequence,
    observedStateDigest: row.observed_state_digest,
    goalGapIds: safeParseJson(row.goal_gap_ids_json) || [],
    decision: row.decision,
    decisionReasonCode: row.decision_reason_code,
    confidence: row.confidence,
    notes: row.notes,
    publicConclusion: row.public_conclusion,
    status: row.status,
    hash: row.hash,
    parentIterationHash: row.parent_iteration_hash,
    createdAt: row.created_at,
  };
}

function listLoopIterations(loopRunId, { limit = 200 } = {}) {
  if (!loopRunId) return [];
  return db.prepare(`
    SELECT * FROM loop_iterations
    WHERE loop_run_id=?
    ORDER BY sequence DESC LIMIT ?
  `).all(loopRunId, limit).map((row) => ({
    iterationId: row.iteration_id,
    loopRunId: row.loop_run_id,
    sequence: row.sequence,
    observedStateDigest: row.observed_state_digest,
    goalGapIds: safeParseJson(row.goal_gap_ids_json) || [],
    decision: row.decision,
    decisionReasonCode: row.decision_reason_code,
    confidence: row.confidence,
    notes: row.notes,
    publicConclusion: row.public_conclusion,
    status: row.status,
    hash: row.hash,
    parentIterationHash: row.parent_iteration_hash,
    createdAt: row.created_at,
  }));
}

function findLoopIterationByActionKey(actionKey) {
  if (!actionKey) return null;
  const row = db.prepare(`
    SELECT li.* FROM loop_iterations li
    JOIN loop_actions la ON la.iteration_id = li.iteration_id
    WHERE la.action_key=?
    ORDER BY li.sequence DESC LIMIT 1
  `).get(actionKey);
  if (!row) return null;
  return getLoopIteration(row.iteration_id);
}

function persistLoopAction(action) {
  if (!action?.actionId || !action?.actionKey || !action?.hash) {
    throw new Error('loop_action_persistence_fields_required');
  }
  const existing = db.prepare('SELECT action_id FROM loop_actions WHERE action_key=?').get(action.actionKey);
  if (existing && existing.action_id !== action.actionId) {
    throw new Error('loop_action_duplicate_action_key');
  }
  db.prepare(`
    INSERT INTO loop_actions(
      action_id, action_key, iteration_id, loop_run_id, sequence,
      action_type, tool_id, inputs_json, params_json,
      expected_artifact_kinds_json, attempt, hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(action_id) DO NOTHING
  `).run(
    action.actionId,
    action.actionKey,
    action.iterationId || null,
    action.loopRunId,
    action.sequence,
    action.actionType,
    action.toolId || null,
    JSON.stringify(action.inputs || null),
    JSON.stringify(action.params || null),
    JSON.stringify(action.expectedArtifactKinds || []),
    action.attempt || 1,
    action.hash,
    action.createdAt || new Date().toISOString(),
  );
  return getLoopAction(action.actionId);
}

function getLoopAction(actionId) {
  if (!actionId) return null;
  const row = db.prepare('SELECT * FROM loop_actions WHERE action_id=?').get(actionId);
  if (!row) return null;
  return parseLoopActionRow(row);
}

function getLoopActionByKey(actionKey) {
  if (!actionKey) return null;
  const row = db.prepare('SELECT * FROM loop_actions WHERE action_key=?').get(actionKey);
  if (!row) return null;
  return parseLoopActionRow(row);
}

function parseLoopActionRow(row) {
  return {
    actionId: row.action_id,
    actionKey: row.action_key,
    iterationId: row.iteration_id,
    loopRunId: row.loop_run_id,
    sequence: row.sequence,
    actionType: row.action_type,
    toolId: row.tool_id,
    inputs: safeParseJson(row.inputs_json),
    params: safeParseJson(row.params_json),
    expectedArtifactKinds: safeParseJson(row.expected_artifact_kinds_json) || [],
    attempt: row.attempt,
    hash: row.hash,
    createdAt: row.created_at,
  };
}

function persistLoopEvidence(evidence) {
  if (!evidence?.evidenceId || !evidence?.hash || !evidence?.loopRunId) {
    throw new Error('loop_evidence_persistence_fields_required');
  }
  db.prepare(`
    INSERT INTO loop_evidence(
      evidence_id, loop_run_id, iteration_id, kind, ref,
      summary_digest, parent_evidence_hash, hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(evidence_id) DO NOTHING
  `).run(
    evidence.evidenceId,
    evidence.loopRunId,
    evidence.iterationId || null,
    evidence.kind,
    evidence.ref,
    evidence.summaryDigest || null,
    evidence.parentEvidenceHash || null,
    evidence.hash,
    evidence.createdAt || new Date().toISOString(),
  );
  return getLoopEvidence(evidence.evidenceId);
}

function getLoopEvidence(evidenceId) {
  if (!evidenceId) return null;
  const row = db.prepare('SELECT * FROM loop_evidence WHERE evidence_id=?').get(evidenceId);
  if (!row) return null;
  return {
    evidenceId: row.evidence_id,
    loopRunId: row.loop_run_id,
    iterationId: row.iteration_id,
    kind: row.kind,
    ref: row.ref,
    summaryDigest: row.summary_digest,
    parentEvidenceHash: row.parent_evidence_hash,
    hash: row.hash,
    createdAt: row.created_at,
  };
}

function listLoopEvidence(loopRunId, { limit = 100 } = {}) {
  if (!loopRunId) return [];
  return db.prepare(`
    SELECT * FROM loop_evidence WHERE loop_run_id=?
    ORDER BY created_at DESC LIMIT ?
  `).all(loopRunId, limit).map((row) => ({
    evidenceId: row.evidence_id,
    loopRunId: row.loop_run_id,
    iterationId: row.iteration_id,
    kind: row.kind,
    ref: row.ref,
    summaryDigest: row.summary_digest,
    parentEvidenceHash: row.parent_evidence_hash,
    hash: row.hash,
    createdAt: row.created_at,
  }));
}

function persistLoopDecision(decision) {
  if (!decision?.iterationId || !decision?.decision || !decision?.decisionReasonCode) {
    throw new Error('loop_decision_persistence_fields_required');
  }
  const decisionId = decision.decisionId || `dec_${decision.iterationId}`;
  db.prepare(`
    INSERT INTO loop_decisions(
      decision_id, iteration_id, loop_run_id, decision,
      decision_reason_code, confidence, notes, hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(decision_id) DO NOTHING
  `).run(
    decisionId,
    decision.iterationId,
    decision.loopRunId,
    decision.decision,
    decision.decisionReasonCode,
    decision.confidence ?? null,
    decision.notes || null,
    decision.hash || null,
    decision.createdAt || new Date().toISOString(),
  );
  return getLoopDecision(decisionId);
}

function getLoopDecision(decisionId) {
  if (!decisionId) return null;
  const row = db.prepare('SELECT * FROM loop_decisions WHERE decision_id=?').get(decisionId);
  if (!row) return null;
  return {
    decisionId: row.decision_id,
    iterationId: row.iteration_id,
    loopRunId: row.loop_run_id,
    decision: row.decision,
    decisionReasonCode: row.decision_reason_code,
    confidence: row.confidence,
    notes: row.notes,
    hash: row.hash,
    createdAt: row.created_at,
  };
}

function persistLoopSnapshot(snapshot) {
  if (!snapshot?.snapshotId || !snapshot?.loopRunId || !snapshot?.sourceHash) {
    throw new Error('loop_snapshot_persistence_fields_required');
  }
  db.prepare(`
    INSERT INTO loop_state_snapshots(
      snapshot_id, loop_run_id, sequence_at, snapshot_json, source_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(snapshot_id) DO NOTHING
  `).run(
    snapshot.snapshotId,
    snapshot.loopRunId,
    snapshot.sequenceAt,
    JSON.stringify(snapshot.payload || {}),
    snapshot.sourceHash,
    snapshot.createdAt || new Date().toISOString(),
  );
  return getLoopSnapshot(snapshot.snapshotId);
}

function getLoopSnapshot(snapshotId) {
  if (!snapshotId) return null;
  const row = db.prepare('SELECT * FROM loop_state_snapshots WHERE snapshot_id=?').get(snapshotId);
  if (!row) return null;
  return {
    snapshotId: row.snapshot_id,
    loopRunId: row.loop_run_id,
    sequenceAt: row.sequence_at,
    payload: safeParseJson(row.snapshot_json) || {},
    sourceHash: row.source_hash,
    createdAt: row.created_at,
  };
}

function getLatestLoopSnapshot(loopRunId) {
  if (!loopRunId) return null;
  const row = db.prepare(`
    SELECT * FROM loop_state_snapshots
    WHERE loop_run_id=?
    ORDER BY sequence_at DESC LIMIT 1
  `).get(loopRunId);
  if (!row) return null;
  return getLoopSnapshot(row.snapshot_id);
}

function safeParseJson(value) {
  if (value === null || value === undefined || value === '') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function updateToolJobParams(id, params) {
  stmts.updateToolJobParams.run(JSON.stringify(params || {}), id);
  return getToolJob(id);
}

function prepareToolJobForRun(id, { params, name }) {
  stmts.prepareToolJobForRun.run(
    JSON.stringify(params || {}),
    'running',
    name || null,
    id
  );
  return getToolJob(id);
}

// TOOL_JOB_APPROVAL_v1（阶段2 Task3）：重操作 run_tool 强制确认。
// setToolJobApproval：tool_run_tool 对 HEAVY_TOOLS 跑前落 ack_status='pending' + ack_token。
// ackToolJob：前端确认卡 ack 后调，approve=true → 'approved'，false → 'rejected'。
function setToolJobApproval(id, ackToken, expiresAt) {
  db.prepare('UPDATE tool_jobs SET ack_token=?, ack_status=?, ack_expires_at=? WHERE id=?').run(
    ackToken,
    'pending',
    expiresAt,
    id
  );
  return getToolJob(id);
}

function toolJobMatchesScope(row, scope = {}) {
  if (scope.userId !== undefined && row.user_id !== scope.userId) return false;
  if (scope.projectId !== undefined && row.project_id !== scope.projectId) return false;
  if (Object.prototype.hasOwnProperty.call(scope, 'conversationId')) {
    const conversationId = scope.conversationId == null ? null : scope.conversationId;
    if (row.conversation_id !== conversationId) return false;
  }
  return true;
}

function ackToolJob(ackToken, approve, scope = {}) {
  const row = db.prepare('SELECT * FROM tool_jobs WHERE ack_token=?').get(ackToken);
  if (!row) return null;
  if (!toolJobMatchesScope(row, scope)) return null;
  if (approve) {
    db.prepare('UPDATE tool_jobs SET ack_status=? WHERE id=?').run('approved', row.id);
  } else {
    db.prepare('UPDATE tool_jobs SET ack_status=?, status=?, error=?, completed_at=? WHERE id=?').run(
      'rejected',
      'failed',
      '用户取消了该重操作',
      Date.now(),
      row.id
    );
  }
  return getToolJob(row.id);
}

function getToolJobByAckToken(ackToken, scope = {}) {
  const row = db.prepare('SELECT * FROM tool_jobs WHERE ack_token=?').get(ackToken);
  return row && toolJobMatchesScope(row, scope) ? parseToolJobRow(row) : null;
}

function listStalledAnalyses() {
  return db
    .prepare(
      "SELECT id, name, task_id FROM analyses WHERE status IN ('running', 'pending', 'queued')"
    )
    .all();
}

function markStalledToolJobsRecovery(now = Date.now()) {
  const rows = db.prepare("SELECT id FROM tool_jobs WHERE status='running'").all();
  if (rows.length > 0) {
    db.prepare("UPDATE tool_jobs SET status='failed', error='recovery_required_after_restart', completed_at=? WHERE status='running'").run(now);
  }
  return rows.map((row) => row.id);
}

function countAnalysesForUserSince(userId, sinceIso) {
  const row = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM analyses WHERE dataset_id IN (
         SELECT id FROM datasets WHERE project_id IN (
           SELECT id FROM projects WHERE user_id = ?
         )
       ) AND created_at >= ?`
    )
    .get(userId, sinceIso);
  return row?.cnt ?? 0;
}

async function countAnalysesForUserSinceAsync(userId, sinceIso) {
  const adb = getAsyncDatabase();
  const row = await adb
    .prepare(
      `SELECT COUNT(*) as cnt FROM analyses WHERE dataset_id IN (
         SELECT id FROM datasets WHERE project_id IN (
           SELECT id FROM projects WHERE user_id = ?
         )
       ) AND created_at >= ?`
    )
    .get(userId, sinceIso);
  return row?.cnt ?? 0;
}

// ---- Helpers ----

function parseAnalysisRow(row) {
  return {
    ...row,
    params: tryParse(row.params),
    summary: tryParse(row.summary),
    results: tryParse(row.results),
  };
}

function parseToolJobRow(row) {
  if (!row) return row;
  return {
    ...row,
    params: tryParse(row.params_json),
    result: tryParse(row.result_json),
  };
}

function tryParse(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

// ---- Stats ----

function getProjectStats(projectId) {
  const datasets = stmts.listDatasets.all(projectId);
  let analysisCount = 0;
  for (const ds of datasets) {
    analysisCount += db
      .prepare('SELECT COUNT(*) as c FROM analyses WHERE dataset_id = ?')
      .get(ds.id).c;
  }
  return { datasets: datasets.length, analyses: analysisCount };
}

function getDatasetStats(datasetId) {
  const count = db
    .prepare('SELECT COUNT(*) as c FROM analyses WHERE dataset_id = ?')
    .get(datasetId).c;
  const last = db
    .prepare(
      'SELECT created_at FROM analyses WHERE dataset_id = ? ORDER BY created_at DESC LIMIT 1'
    )
    .get(datasetId);
  return { analyses: count, lastAnalysisAt: last?.created_at || null };
}

// ============================================================
// Users
// ============================================================


module.exports = {
  listProjects,
  getProject,
  createProject,
  validateSshProjectFields,
  getProjectG0Baseline,
  setProjectUserId,
  setProjectPublic,
  updateProject,
  setProjectStatus,
  deleteProject,
  listProjectsByModality,
  listDatasets,
  getDataset,
  createDataset,
  updateDataset,
  deleteDataset,
  setDatasetMetaUrls,
  listAnalyses,
  getAnalysis,
  getAnalysisByTaskId,
  getAnalysisByTaskIdAsync,
  createAnalysis,
  updateAnalysis,
  updateAnalysisByTaskId,
  deleteAnalysis,
  getToolJob,
  listProjectToolJobs,
  listProjectToolJobsForWorkflow,
  createToolJob,
  updateToolJob,
  saveScientificTaskSpec,
  getScientificTaskSpec,
  listConversationScientificTasks,
  getScientificTaskByToolJob,
  bindScientificTaskToolJob,
  saveContextCheckpoint,
  getContextCheckpoint,
  listContextCheckpoints,
  getLatestContextCheckpoint,
  updateToolJobParams,
  prepareToolJobForRun,
  setToolJobApproval,
  ackToolJob,
  getToolJobByAckToken,
  listStalledAnalyses,
  markStalledToolJobsRecovery,
  countAnalysesForUserSince,
  getProjectStats,
  getDatasetStats,
  getUserByUsername,
  getUserById,
  createUser,
  listUsers,
  updateUser,
  deleteUser,
  getUserByUsernameAsync,
  getUserByIdAsync,
  createUserAsync,
  getSiteSettingAsync,
  listUsersAsync,
  updateUserAsync,
  deleteUserAsync,
  setSiteSettingAsync,
  countAnalysesForUserSinceAsync,
  getSiteSetting,
  setSiteSetting,
  listSubsets,
  getSubset,
  createSubset,
  updateSubset,
  deleteSubset,
  listCellLabels,
  getCellLabel,
  createCellLabel,
  deleteCellLabel,
  getLabelsSummary,
  // HLE-1 Loop ledger
  persistLoopRun,
  updateLoopRunStatus,
  getLoopRun,
  getLoopRunByTaskId,
  getLoopRunsByParentLoopRunId,
  listLoopRunsForConversation,
  listRunningLoopRuns,
  getActiveLoopRunForConversation,
  persistLoopIteration,
  getLoopIteration,
  listLoopIterations,
  findLoopIterationByActionKey,
  persistLoopAction,
  getLoopAction,
  getLoopActionByKey,
  listLoopActions,
  persistLoopEvidence,
  getLoopEvidence,
  listLoopEvidence,
  persistLoopDecision,
  getLoopDecision,
  persistLoopSnapshot,
  getLoopSnapshot,
  getLatestLoopSnapshot,
  db,
  getDatabase,
  closeDatabase,
  getAsyncDatabase,
};
