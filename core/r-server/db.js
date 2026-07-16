/**
 * SQLite database layer for BioF3 scRNA platform.
 *
 * Tables: projects, datasets, analyses
 * Uses better-sqlite3 (synchronous, fast, zero-config).
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { v4: _uuidv4 } = require('uuid');

const DB_PATH = process.env.BIOF3_DB_PATH || path.join(__dirname, 'biof3.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
// busy_timeout: if writer holds lock, wait up to 10s instead of immediately returning SQLITE_BUSY.
// This is the #1 cause of "admin panel frozen" — a high-frequency write (page_view / heartbeat)
// holding the WAL writer while an admin API read tries to acquire a shared lock.
db.pragma('busy_timeout = 10000');
// WAL auto-checkpoint: checkpoint every 1000 pages to keep WAL file from growing unbounded.
// Default is 1000 pages (~4MB for 4KB pages) which is reasonable. Also run a manual
// checkpoint on startup to close any stale WAL from a previous unclean shutdown.
db.pragma('wal_autocheckpoint = 1000');
try {
  db.pragma('wal_checkpoint(TRUNCATE)');
} catch {}

// ============================================================
// Schema
// ============================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS datasets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    oss_url TEXT NOT NULL,
    size INTEGER DEFAULT 0,
    description TEXT DEFAULT '',
    n_cells INTEGER,
    n_genes INTEGER,
    source_dataset_ids TEXT NOT NULL DEFAULT '[]',
    uploaded_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS analyses (
    id TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL,
    task_id TEXT,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_analysis_id TEXT,
    params TEXT DEFAULT '{}',
    status TEXT DEFAULT 'pending',
    summary TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT,
    FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_datasets_project ON datasets(project_id);


  CREATE INDEX IF NOT EXISTS idx_analyses_dataset ON analyses(dataset_id);
  CREATE INDEX IF NOT EXISTS idx_analyses_task ON analyses(task_id);
`);

// Migration: add users table
try {
  db.exec(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
} catch {}

// Migration: add is_public to projects
try {
  db.exec('ALTER TABLE projects ADD COLUMN is_public INTEGER DEFAULT 0');
} catch {}
// Migration: add quota_mb and enabled to users
try {
  db.exec('ALTER TABLE users ADD COLUMN quota_mb INTEGER DEFAULT 500');
} catch {}
try {
  db.exec('ALTER TABLE users ADD COLUMN enabled INTEGER DEFAULT 1');
} catch {}
// Migration (MODULE_PERMS_v1): per-user feature-module authorization JSON
try {
  db.exec('ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT NULL');
} catch {}
try {
  db.exec('ALTER TABLE users ADD COLUMN max_analyses_month INTEGER DEFAULT NULL');
} catch {}
// Site-wide settings (guest permissions, etc.)
try {
  db.exec(`CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
} catch {}
// Migration: add user_id to projects
try {
  db.exec('ALTER TABLE projects ADD COLUMN user_id TEXT');
} catch {}

// Migration: add results column if not exists
try {
  db.exec('ALTER TABLE analyses ADD COLUMN results TEXT');
} catch {}

// Migration: add meta_url and features_url to datasets (data preview)
try {
  db.exec('ALTER TABLE datasets ADD COLUMN meta_url TEXT');
} catch {}
try {
  db.exec('ALTER TABLE datasets ADD COLUMN features_url TEXT');
} catch {}

// Migration (W1-3, 2026-05-28): add modality to projects
// Values: 'single-cell' | 'spatial' | 'bulk'(future). Distinguishes which云平台 owns the project.
// Default 'single-cell' so existing projects backfill correctly.
try {
  db.exec(`ALTER TABLE projects ADD COLUMN modality TEXT DEFAULT 'single-cell'`);
} catch {}
try {
  db.exec(`UPDATE projects SET modality = 'single-cell' WHERE modality IS NULL`);
} catch {}
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_modality ON projects(modality)`);
} catch {}
// Migration (workspace_v1): project-scoped local workspace root for Codex-style workbench.
try {
  db.exec('ALTER TABLE projects ADD COLUMN workspace_path TEXT');
} catch {}
// Migration (project_trash_v1): soft-delete projects before permanent cleanup.
try {
  db.exec("ALTER TABLE projects ADD COLUMN status TEXT DEFAULT 'active'");
} catch {}
try {
  db.exec("UPDATE projects SET status = 'active' WHERE status IS NULL");
  db.exec('CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status, updated_at DESC)');
} catch {}

// Migration: subsets — saved cell selections for downstream analysis
try {
  db.exec(`CREATE TABLE IF NOT EXISTS subsets (
    id TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    cell_ids TEXT NOT NULL,
    n_cells INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_subsets_dataset ON subsets(dataset_id)');
} catch {}

// Migration: cell_labels — user-defined annotation columns
try {
  db.exec(`CREATE TABLE IF NOT EXISTS cell_labels (
    id TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL,
    label_name TEXT NOT NULL,
    label_value TEXT NOT NULL,
    cell_ids TEXT NOT NULL,
    n_cells INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_cell_labels_dataset ON cell_labels(dataset_id)');
} catch {}

// Migration: tool_jobs — 在线分析工具任务表（deseq2/go-kegg/...）
try {
  db.exec(`CREATE TABLE IF NOT EXISTS tool_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tool_id TEXT NOT NULL,
    params_json TEXT DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at BIGINT NOT NULL,
    name TEXT DEFAULT '',
    is_test_run INTEGER DEFAULT 0,
    is_public INTEGER DEFAULT 0,
    result_json TEXT,
    completed_at BIGINT,
    error TEXT
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_tool_jobs_user ON tool_jobs(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tool_jobs_status ON tool_jobs(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tool_jobs_created ON tool_jobs(created_at)');
  // TOOL_JOB_APPROVAL_v1（阶段2 Task3）：重操作 run_tool 强制确认列
  try { db.exec('ALTER TABLE tool_jobs ADD COLUMN ack_token TEXT'); } catch {}
  try { db.exec('ALTER TABLE tool_jobs ADD COLUMN ack_status TEXT'); } catch {}
  try { db.exec('ALTER TABLE tool_jobs ADD COLUMN ack_expires_at BIGINT'); } catch {}
  // 7.3: project_id column for project-scoped tool jobs
  try { db.exec('ALTER TABLE tool_jobs ADD COLUMN project_id TEXT'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_tool_jobs_project ON tool_jobs(project_id)'); } catch {}
} catch {}

// ============================================================
// Projects
// ============================================================

const stmts = {
  listProjects: db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY updated_at DESC'),
  // W1-3: modality-filtered listing (used by /spatial and /single-cell pages)
  listProjectsByModality: db.prepare(
    'SELECT * FROM projects WHERE modality = ? AND status = ? ORDER BY updated_at DESC'
  ),
  getProject: db.prepare('SELECT * FROM projects WHERE id = ?'),
  insertProject: db.prepare(
    'INSERT INTO projects (id, name, description, created_at, updated_at, modality, workspace_path) VALUES (?, ?, ?, ?, ?, ?, ?)'
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
  insertToolJob: db.prepare(
    'INSERT INTO tool_jobs (id, user_id, tool_id, params_json, status, created_at, name, is_test_run, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  updateToolJob: db.prepare(
    'UPDATE tool_jobs SET status = COALESCE(?, status), result_json = COALESCE(?, result_json), completed_at = COALESCE(?, completed_at), error = COALESCE(?, error) WHERE id = ?'
  ),
  updateToolJobParams: db.prepare('UPDATE tool_jobs SET params_json=? WHERE id=?'),
  prepareToolJobForRun: db.prepare(
    'UPDATE tool_jobs SET params_json=?, status=?, name=COALESCE(?, name), error=NULL, completed_at=NULL WHERE id=?'
  ),
};

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
    fs.mkdirSync(workspacePath, { recursive: true });
  } catch {}
}

function hydrateProjectWorkspace(project) {
  if (!project) return project;
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

// ---- Projects ----

function listProjects(status = 'active') {
  const normalizedStatus = status === 'archived' ? 'archived' : 'active';
  return stmts.listProjects.all(normalizedStatus).map(hydrateProjectWorkspace);
}

// W1-3: list projects by modality (single-cell | spatial | bulk).
// Pass null/undefined to get everything (back-compat with existing callers).
function listProjectsByModality(modality, status = 'active') {
  const normalizedStatus = status === 'archived' ? 'archived' : 'active';
  if (!modality) return stmts.listProjects.all(normalizedStatus).map(hydrateProjectWorkspace);
  return stmts.listProjectsByModality.all(modality, normalizedStatus).map(hydrateProjectWorkspace);
}

function getProject(id) {
  return hydrateProjectWorkspace(stmts.getProject.get(id) || null);
}

function createProject({ name, description, modality, userId, workspacePath }) {
  const id = uid('p');
  const ts = now();
  const finalWorkspacePath = workspacePath || defaultProjectWorkspacePath({ id, name });
  ensureWorkspaceDir(finalWorkspacePath);
  stmts.insertProject.run(id, name, description || '', ts, ts, modality || 'single-cell', finalWorkspacePath);
  return stmts.getProject.get(id);
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
  return hydrateProjectWorkspace(stmts.getProject.get(id));
}

function setProjectStatus(id, status) {
  const normalizedStatus = status === 'archived' ? 'archived' : 'active';
  stmts.updateProjectStatus.run(normalizedStatus, now(), id);
  return hydrateProjectWorkspace(stmts.getProject.get(id));
}

function deleteProject(id) {
  const datasets = stmts.listDatasets.all(id);
  for (const ds of datasets) {
    stmts.deleteAnalysesByDataset.run(ds.id);
  }
  db.prepare('DELETE FROM datasets WHERE project_id = ?').run(id);
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

function listProjectToolJobs(projectId) {
  const rows = stmts.listProjectToolJobs.all(projectId);
  return rows.map(parseToolJobRow);
}

function createToolJob({ toolId, userId = 'agent', params, status = 'running', name = '', isTestRun = 0, projectId = null }) {
  const id = uid('tj');
  stmts.insertToolJob.run(
    id,
    userId,
    toolId,
    JSON.stringify(params || {}),
    status,
    Date.now(),
    name,
    isTestRun,
    projectId
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

function ackToolJob(ackToken, approve) {
  const row = db.prepare('SELECT id FROM tool_jobs WHERE ack_token=?').get(ackToken);
  if (!row) return null;
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

function getToolJobByAckToken(ackToken) {
  const row = db.prepare('SELECT * FROM tool_jobs WHERE ack_token=?').get(ackToken);
  return row ? parseToolJobRow(row) : null;
}

function listStalledAnalyses() {
  return db
    .prepare(
      "SELECT id, name, task_id FROM analyses WHERE status IN ('running', 'pending', 'queued')"
    )
    .all();
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
  const adb = getAsyncDbForLegacyModules();
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

function getUserByUsername(username) {
  const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
  return stmt.get(username);
}

function getUserById(id) {
  const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
  return stmt.get(id);
}

async function getUserByUsernameAsync(username) {
  return getUserByUsername(username);
}

async function getUserByIdAsync(id) {
  return getUserById(id);
}

async function createUserAsync(payload) {
  return createUser(payload);
}

function createUser({ id, username, passwordHash, role }) {
  const stmt = db.prepare(
    'INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)'
  );
  stmt.run(id, username, passwordHash, role || 'user');
  return getUserById(id);
}

// ============================================================
// Subsets — saved cell selections
// ============================================================

function listSubsets(datasetId) {
  const rows = db
    .prepare('SELECT * FROM subsets WHERE dataset_id = ? ORDER BY created_at DESC')
    .all(datasetId);
  return rows.map(parseSubsetRow);
}

function getSubset(id) {
  const row = db.prepare('SELECT * FROM subsets WHERE id = ?').get(id);
  return row ? parseSubsetRow(row) : null;
}

function createSubset({ datasetId, name, description, cellIds }) {
  const id = uid('s');
  const ids = Array.isArray(cellIds) ? cellIds : [];
  db.prepare(
    'INSERT INTO subsets (id, dataset_id, name, description, cell_ids, n_cells) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, datasetId, name, description || '', JSON.stringify(ids), ids.length);
  return getSubset(id);
}

function updateSubset(id, { name, description }) {
  db.prepare(
    'UPDATE subsets SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?'
  ).run(name || null, description ?? null, id);
  return getSubset(id);
}

function deleteSubset(id) {
  db.prepare('DELETE FROM subsets WHERE id = ?').run(id);
}

function parseSubsetRow(row) {
  if (!row) return row;
  return {
    ...row,
    cell_ids: tryParseArray(row.cell_ids),
  };
}

function tryParseArray(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// ============================================================
// Cell labels — user-defined annotation columns
// ============================================================

function listCellLabels(datasetId) {
  const rows = db
    .prepare('SELECT * FROM cell_labels WHERE dataset_id = ? ORDER BY label_name, created_at')
    .all(datasetId);
  return rows.map(parseLabelRow);
}

function getCellLabel(id) {
  const row = db.prepare('SELECT * FROM cell_labels WHERE id = ?').get(id);
  return row ? parseLabelRow(row) : null;
}

function createCellLabel({ datasetId, labelName, labelValue, cellIds }) {
  const id = uid('lbl');
  const ids = Array.isArray(cellIds) ? cellIds : [];
  db.prepare(
    'INSERT INTO cell_labels (id, dataset_id, label_name, label_value, cell_ids, n_cells) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, datasetId, labelName, labelValue, JSON.stringify(ids), ids.length);
  return getCellLabel(id);
}

function deleteCellLabel(id) {
  db.prepare('DELETE FROM cell_labels WHERE id = ?').run(id);
}

/** Group label values by label_name for a dataset. Returns:
 *  { tumor_focus: [{value: 'yes', cells: 100, id: 'lbl_xxx'}, {value: 'no', cells: 200}], ... }
 */
function getLabelsSummary(datasetId) {
  const rows = listCellLabels(datasetId);
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

function parseLabelRow(row) {
  if (!row) return row;
  return {
    ...row,
    cell_ids: tryParseArray(row.cell_ids),
  };
}

// === Admin: user management ===
function listUsers() {
  return db
    .prepare(
      'SELECT id, username, role, quota_mb, max_analyses_month, enabled, permissions, created_at FROM users ORDER BY created_at DESC'
    )
    .all();
}

/** Async (deasync-free) user list — for hot/concurrent paths (analytics admin). */
async function listUsersAsync() {
  return db
    .prepare(
      'SELECT id, username, role, quota_mb, max_analyses_month, enabled, permissions, created_at FROM users ORDER BY created_at DESC'
    )
    .all();
}

function updateUser(id, { role, quotaMb, maxAnalysesMonth, enabled, permissions }) {
  if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  if (quotaMb !== undefined)
    db.prepare('UPDATE users SET quota_mb = ? WHERE id = ?').run(quotaMb, id);
  if (maxAnalysesMonth !== undefined)
    db.prepare('UPDATE users SET max_analyses_month = ? WHERE id = ?').run(maxAnalysesMonth, id);
  if (enabled !== undefined)
    db.prepare('UPDATE users SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  if (permissions !== undefined)
    db.prepare('UPDATE users SET permissions = ? WHERE id = ?').run(permissions, id);
  return getUserById(id);
}

async function updateUserAsync(id, { role, quotaMb, maxAnalysesMonth, enabled, permissions }) {
  return updateUser(id, { role, quotaMb, maxAnalysesMonth, enabled, permissions });
}

function getSiteSetting(key) {
  return db.prepare('SELECT key, value, updated_at FROM site_settings WHERE key = ?').get(key);
}

async function getSiteSettingAsync(key) {
  return db.prepare('SELECT key, value, updated_at FROM site_settings WHERE key = ?').get(key);
}

function setSiteSetting(key, value) {
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, nowIso);
  return getSiteSetting(key);
}

async function setSiteSettingAsync(key, value) {
  return setSiteSetting(key, value);
}

function deleteUser(id) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

async function deleteUserAsync(id) {
  return deleteUser(id);
}

// ============================================================
// Legacy-module DB accessors
//
// Historically the platform supported a PostgreSQL backend; the desktop app is
// SQLite-only. These accessors are kept for API compatibility with modules that
// consume them (chat-summary / plans / user-facts / cache-manager等).
// ============================================================

/** Sync SQLite handle for legacy modules. */
function getSqliteForLegacyModules() {
  return db;
}

/** Convert PostgreSQL-style $N placeholders to SQLite ? placeholders. */
function _pgToSqlitePlaceholders(sql) {
  if (typeof sql !== 'string' || !sql.includes('$')) return sql;
  return sql.replace(/\$(\d+)/g, '?');
}

/**
 * Async (Promise-based) DB facade over the sync better-sqlite3 handle. Legacy
 * modules author SQL with $N placeholders (a PostgreSQL habit); we translate
 * them to SQLite ? here so those modules work unchanged.
 */
function _wrapSyncDbAsync(realDb) {
  return {
    async exec(ddl) {
      return realDb.exec(ddl);
    },
    prepare(sql) {
      const stmt = realDb.prepare(_pgToSqlitePlaceholders(sql));
      return {
        async run(...p) {
          return stmt.run(...p);
        },
        async get(...p) {
          return stmt.get(...p);
        },
        async all(...p) {
          return stmt.all(...p);
        },
      };
    },
  };
}

function getAsyncDbForLegacyModules() {
  return _wrapSyncDbAsync(db);
}

module.exports = {
  listProjects,
  getProject,
  createProject,
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
  db,
  getSqliteForLegacyModules,
  getAsyncDbForLegacyModules,
};
