/**
 * P1 PostgreSQL: projects, datasets, analyses, subsets, cell_labels
 */
const {query} = require('./db-pg');
const fs = require('fs');
const os = require('os');
const path = require('path');

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
function now() {
  return new Date().toISOString();
}

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
    fs.mkdirSync(workspacePath, {recursive: true});
  } catch {}
}

async function hydrateProjectWorkspace(project) {
  if (!project) return project;
  if (project.workspace_path) {
    ensureWorkspaceDir(project.workspace_path);
    return project;
  }
  const workspacePath = defaultProjectWorkspacePath(project);
  try {
    await query('UPDATE projects SET workspace_path = $1, updated_at = $2 WHERE id = $3', [
      workspacePath,
      now(),
      project.id,
    ]);
  } catch {}
  ensureWorkspaceDir(workspacePath);
  return {...project, workspace_path: workspacePath};
}

function tryParse(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

function parseAnalysisRow(row) {
  if (!row) return row;
  return {
    ...row,
    params: tryParse(row.params),
    summary: tryParse(row.summary),
    results: tryParse(row.results),
  };
}

function parseSubsetRow(row) {
  if (!row) return row;
  let cell_ids = row.cell_ids;
  if (typeof cell_ids === 'string') {
    try {
      cell_ids = JSON.parse(cell_ids);
    } catch {
      cell_ids = [];
    }
  }
  return {...row, cell_ids: Array.isArray(cell_ids) ? cell_ids : []};
}

function parseLabelRow(row) {
  if (!row) return row;
  let cell_ids = row.cell_ids;
  if (typeof cell_ids === 'string') {
    try {
      cell_ids = JSON.parse(cell_ids);
    } catch {
      cell_ids = [];
    }
  }
  return {...row, cell_ids: Array.isArray(cell_ids) ? cell_ids : []};
}

// ---- Projects ----

async function listProjects(_modality, status = 'active') {
  const normalizedStatus = status === 'archived' ? 'archived' : 'active';
  const r = await query('SELECT * FROM projects WHERE status = $1 ORDER BY updated_at DESC', [normalizedStatus]);
  return Promise.all(r.rows.map(hydrateProjectWorkspace));
}

async function listProjectsByModality(modality, status = 'active') {
  if (!modality) return listProjects(undefined, status);
  const normalizedStatus = status === 'archived' ? 'archived' : 'active';
  const r = await query('SELECT * FROM projects WHERE modality = $1 AND status = $2 ORDER BY updated_at DESC', [modality, normalizedStatus]);
  return Promise.all(r.rows.map(hydrateProjectWorkspace));
}

async function getProject(id) {
  const r = await query('SELECT * FROM projects WHERE id = $1', [id]);
  return hydrateProjectWorkspace(r.rows[0] || null);
}

async function createProject({name, description, modality, userId, workspacePath}) {
  const id = uid('p');
  const ts = now();
  const mod = modality || 'single-cell';
  const finalWorkspacePath = workspacePath || defaultProjectWorkspacePath({id, name});
  ensureWorkspaceDir(finalWorkspacePath);
  await query(
    `INSERT INTO projects (id, name, description, created_at, updated_at, modality, user_id, is_public, workspace_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8)`,
    [id, name, description || '', ts, ts, mod, userId || null, finalWorkspacePath],
  );
  return getProject(id);
}

async function setProjectUserId(projectId, userId) {
  await query('UPDATE projects SET user_id = $1 WHERE id = $2', [userId, projectId]);
}

async function setProjectPublic(projectId, isPublic) {
  await query('UPDATE projects SET is_public = $1 WHERE id = $2', [!!isPublic, projectId]);
}

async function updateProject(id, {name, description, workspacePath}) {
  if (workspacePath) ensureWorkspaceDir(workspacePath);
  await query(
    'UPDATE projects SET name = COALESCE($1, name), description = COALESCE($2, description), workspace_path = COALESCE($3, workspace_path), updated_at = $4 WHERE id = $5',
    [name || null, description ?? null, workspacePath || null, now(), id],
  );
  return getProject(id);
}

async function setProjectStatus(id, status) {
  const normalizedStatus = status === 'archived' ? 'archived' : 'active';
  await query('UPDATE projects SET status = $1, updated_at = $2 WHERE id = $3', [normalizedStatus, now(), id]);
  return getProject(id);
}

async function deleteProject(id) {
  const ds = await query('SELECT id FROM datasets WHERE project_id = $1', [id]);
  for (const row of ds.rows) {
    await query('DELETE FROM analyses WHERE dataset_id = $1', [row.id]);
  }
  await query('DELETE FROM datasets WHERE project_id = $1', [id]);
  await query('DELETE FROM projects WHERE id = $1', [id]);
}

// ---- Datasets ----

async function listDatasets(projectId) {
  const r = await query('SELECT * FROM datasets WHERE project_id = $1 ORDER BY uploaded_at DESC', [projectId]);
  return r.rows;
}

async function getDataset(id) {
  const r = await query('SELECT * FROM datasets WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function createDataset({projectId, name, ossUrl, size, description}) {
  const id = uid('d');
  const ts = now();
  await query(
    `INSERT INTO datasets (id, project_id, name, oss_url, size, description, uploaded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, projectId, name, ossUrl, size || 0, description || '', ts],
  );
  await query('UPDATE projects SET updated_at = $1 WHERE id = $2', [ts, projectId]);
  return getDataset(id);
}

async function updateDataset(id, {name, nCells, nGenes, description}) {
  await query(
    `UPDATE datasets SET name = COALESCE($1, name), n_cells = COALESCE($2, n_cells),
     n_genes = COALESCE($3, n_genes), description = COALESCE($4, description) WHERE id = $5`,
    [name ?? null, nCells ?? null, nGenes ?? null, description ?? null, id],
  );
  return getDataset(id);
}

async function deleteDataset(id) {
  await query('DELETE FROM analyses WHERE dataset_id = $1', [id]);
  await query('DELETE FROM datasets WHERE id = $1', [id]);
}

// Set data-preview URLs (used by task-manager after metadata/features export).
async function setDatasetMetaUrls(id, {metaUrl, featuresUrl}) {
  await query(
    'UPDATE datasets SET meta_url = $1, features_url = $2 WHERE id = $3',
    [metaUrl ?? null, featuresUrl ?? null, id],
  );
  return getDataset(id);
}

// ---- Analyses ----

async function listAnalyses(datasetId) {
  const r = await query('SELECT * FROM analyses WHERE dataset_id = $1 ORDER BY created_at DESC', [datasetId]);
  return r.rows.map(parseAnalysisRow);
}

async function getAnalysis(id) {
  const r = await query('SELECT * FROM analyses WHERE id = $1', [id]);
  return r.rows[0] ? parseAnalysisRow(r.rows[0]) : null;
}

async function getAnalysisByTaskId(taskId) {
  const r = await query('SELECT * FROM analyses WHERE task_id = $1', [taskId]);
  return r.rows[0] ? parseAnalysisRow(r.rows[0]) : null;
}

async function createAnalysis({datasetId, taskId, type, name, parentAnalysisId, params, status}) {
  const id = uid('a');
  const ts = now();
  await query(
    `INSERT INTO analyses (id, dataset_id, task_id, type, name, parent_analysis_id, params, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      datasetId,
      taskId || null,
      type,
      name,
      parentAnalysisId || null,
      JSON.stringify(params || {}),
      status || 'pending',
      ts,
    ],
  );
  const ds = await getDataset(datasetId);
  if (ds) await query('UPDATE projects SET updated_at = $1 WHERE id = $2', [ts, ds.project_id]);
  return getAnalysis(id);
}

async function updateAnalysis(id, {name, status, summary, error, finishedAt, results}) {
  await query(
    `UPDATE analyses SET name = COALESCE($1, name), status = COALESCE($2, status),
     summary = COALESCE($3, summary), error = COALESCE($4, error),
     finished_at = COALESCE($5, finished_at), results = COALESCE($6, results) WHERE id = $7`,
    [
      name || null,
      status || null,
      summary ? JSON.stringify(summary) : null,
      error || null,
      finishedAt || null,
      results ? JSON.stringify(results) : null,
      id,
    ],
  );
  return getAnalysis(id);
}

async function updateAnalysisByTaskId(taskId, {status, summary, error, finishedAt, results}) {
  await query(
    `UPDATE analyses SET status = COALESCE($1, status), summary = COALESCE($2, summary),
     error = COALESCE($3, error), finished_at = COALESCE($4, finished_at),
     results = COALESCE($5, results) WHERE task_id = $6`,
    [
      status || null,
      summary ? JSON.stringify(summary) : null,
      error || null,
      finishedAt || null,
      results ? JSON.stringify(results) : null,
      taskId,
    ],
  );
  return getAnalysisByTaskId(taskId);
}

async function deleteAnalysis(id) {
  await query('DELETE FROM analyses WHERE id = $1', [id]);
}

// ---- Tool jobs (bulk 工具执行记录，无 dataset；方案 C，见 011 迁移) ----

function parseToolJobRow(row) {
  if (!row) return row;
  return {
    ...row,
    params: tryParse(row.params_json),
    result: tryParse(row.result_json),
  };
}

async function getToolJob(id) {
  const r = await query('SELECT * FROM tool_jobs WHERE id = $1', [id]);
  return r.rows[0] ? parseToolJobRow(r.rows[0]) : null;
}

async function listProjectToolJobs(projectId) {
  const r = await query(
    'SELECT * FROM tool_jobs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 200',
    [projectId],
  );
  return r.rows.map(parseToolJobRow);
}

async function createToolJob({toolId, userId = 'agent', params, status = 'running', name = '', isTestRun = 0, projectId = null}) {
  const id = uid('tj');
  const ts = Date.now();
  await query(
    `INSERT INTO tool_jobs (id, user_id, tool_id, params_json, status, created_at, name, is_test_run, project_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, userId, toolId, JSON.stringify(params || {}), status, ts, name, isTestRun, projectId],
  );
  return getToolJob(id);
}

async function updateToolJob(id, {status, resultJson, completedAt, error}) {
  await query(
    `UPDATE tool_jobs SET status = COALESCE($1, status),
     result_json = COALESCE($2, result_json), completed_at = COALESCE($3, completed_at),
     error = COALESCE($4, error) WHERE id = $5`,
    [
      status || null,
      resultJson != null ? (typeof resultJson === 'string' ? resultJson : JSON.stringify(resultJson)) : null,
      completedAt != null ? completedAt : null,
      error || null,
      id,
    ],
  );
  return getToolJob(id);
}

async function updateToolJobParams(id, params) {
  await query('UPDATE tool_jobs SET params_json = $1 WHERE id = $2', [JSON.stringify(params || {}), id]);
  return getToolJob(id);
}

async function prepareToolJobForRun(id, {params, name}) {
  await query(
    `UPDATE tool_jobs
     SET params_json = $1, status = $2, name = COALESCE($3, name), error = NULL, completed_at = NULL
     WHERE id = $4`,
    [JSON.stringify(params || {}), 'running', name || null, id],
  );
  return getToolJob(id);
}

// TOOL_JOB_APPROVAL_v1（阶段2 Task3）：重操作 run_tool 强制确认。
async function setToolJobApproval(id, ackToken, expiresAt) {
  await query(
    `UPDATE tool_jobs SET ack_token = $1, ack_status = $2, ack_expires_at = $3 WHERE id = $4`,
    [ackToken, 'pending', expiresAt, id],
  );
  return getToolJob(id);
}

async function ackToolJob(ackToken, approve) {
  const r = await query('SELECT id FROM tool_jobs WHERE ack_token = $1', [ackToken]);
  if (!r.rows[0]) return null;
  const id = r.rows[0].id;
  if (approve) {
    await query('UPDATE tool_jobs SET ack_status = $1 WHERE id = $2', ['approved', id]);
  } else {
    await query(
      'UPDATE tool_jobs SET ack_status = $1, status = $2, error = $3, completed_at = $4 WHERE id = $5',
      ['rejected', 'failed', '用户取消了该重操作', Date.now(), id]
    );
  }
  return getToolJob(id);
}

async function getToolJobByAckToken(ackToken) {
  const r = await query('SELECT * FROM tool_jobs WHERE ack_token = $1', [ackToken]);
  return r.rows[0] ? parseToolJobRow(r.rows[0]) : null;
}

async function listStalledAnalyses() {
  const r = await query(
    `SELECT id, name, task_id FROM analyses WHERE status IN ('running', 'pending', 'queued')`,
  );
  return r.rows;
}

async function countAnalysesForUserSince(userId, sinceIso) {
  const r = await query(
    `SELECT COUNT(*)::int AS cnt FROM analyses a
     INNER JOIN datasets d ON d.id = a.dataset_id
     INNER JOIN projects p ON p.id = d.project_id
     WHERE p.user_id = $1 AND a.created_at >= $2`,
    [userId, sinceIso],
  );
  return r.rows[0]?.cnt ?? 0;
}

async function getProjectStats(projectId) {
  const datasets = await listDatasets(projectId);
  let analysisCount = 0;
  for (const ds of datasets) {
    const c = await query('SELECT COUNT(*)::int AS c FROM analyses WHERE dataset_id = $1', [ds.id]);
    analysisCount += c.rows[0].c;
  }
  return {datasets: datasets.length, analyses: analysisCount};
}

async function getDatasetStats(datasetId) {
  const c = await query('SELECT COUNT(*)::int AS c FROM analyses WHERE dataset_id = $1', [datasetId]);
  const last = await query(
    'SELECT created_at FROM analyses WHERE dataset_id = $1 ORDER BY created_at DESC LIMIT 1',
    [datasetId],
  );
  return {analyses: c.rows[0].c, lastAnalysisAt: last.rows[0]?.created_at || null};
}

// ---- Subsets ----

async function listSubsets(datasetId) {
  const r = await query('SELECT * FROM subsets WHERE dataset_id = $1 ORDER BY created_at DESC', [datasetId]);
  return r.rows.map(parseSubsetRow);
}

async function getSubset(id) {
  const r = await query('SELECT * FROM subsets WHERE id = $1', [id]);
  return r.rows[0] ? parseSubsetRow(r.rows[0]) : null;
}

async function createSubset({datasetId, name, description, cellIds}) {
  const id = uid('s');
  const ids = Array.isArray(cellIds) ? cellIds : [];
  await query(
    `INSERT INTO subsets (id, dataset_id, name, description, cell_ids, n_cells)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, datasetId, name, description || '', JSON.stringify(ids), ids.length],
  );
  return getSubset(id);
}

async function updateSubset(id, {name, description}) {
  await query(
    'UPDATE subsets SET name = COALESCE($1, name), description = COALESCE($2, description) WHERE id = $3',
    [name || null, description ?? null, id],
  );
  return getSubset(id);
}

async function deleteSubset(id) {
  await query('DELETE FROM subsets WHERE id = $1', [id]);
}

// ---- Cell labels ----

async function listCellLabels(datasetId) {
  const r = await query(
    'SELECT * FROM cell_labels WHERE dataset_id = $1 ORDER BY label_name, created_at',
    [datasetId],
  );
  return r.rows.map(parseLabelRow);
}

async function getCellLabel(id) {
  const r = await query('SELECT * FROM cell_labels WHERE id = $1', [id]);
  return r.rows[0] ? parseLabelRow(r.rows[0]) : null;
}

async function createCellLabel({datasetId, labelName, labelValue, cellIds}) {
  const id = uid('lbl');
  const ids = Array.isArray(cellIds) ? cellIds : [];
  await query(
    `INSERT INTO cell_labels (id, dataset_id, label_name, label_value, cell_ids, n_cells)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, datasetId, labelName, labelValue, JSON.stringify(ids), ids.length],
  );
  return getCellLabel(id);
}

async function deleteCellLabel(id) {
  await query('DELETE FROM cell_labels WHERE id = $1', [id]);
}

async function getLabelsSummary(datasetId) {
  const rows = await listCellLabels(datasetId);
  const grouped = {};
  for (const r of rows) {
    if (!grouped[r.label_name]) grouped[r.label_name] = [];
    grouped[r.label_name].push({
      id: r.id,
      value: r.label_value,
      cells: r.n_cells,
      createdAt: r.created_at,
    });
  }
  return grouped;
}

module.exports = {
  listProjects,
  listProjectsByModality,
  getProject,
  createProject,
  setProjectUserId,
  setProjectPublic,
  updateProject,
  setProjectStatus,
  deleteProject,
  listDatasets,
  getDataset,
  createDataset,
  updateDataset,
  deleteDataset,
  setDatasetMetaUrls,
  listAnalyses,
  getAnalysis,
  getAnalysisByTaskId,
  createAnalysis,
  updateAnalysis,
  updateAnalysisByTaskId,
  deleteAnalysis,
  getToolJob,
  listProjectToolJobs,
  createToolJob,
  updateToolJob,
  updateToolJobParams,
  prepareToolJobForRun,
  setToolJobApproval,
  ackToolJob,
  getToolJobByAckToken,
  listStalledAnalyses,
  countAnalysesForUserSince,
  getProjectStats,
  getDatasetStats,
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
};
