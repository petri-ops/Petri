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

// --- PostgreSQL (阶段 B P0+P1) when DATABASE_URL is set ---
let USE_PG = !!(process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim());
let _pgAuth = null;
let _pgCore = null;
let _runPg = null;
let _p2PgShim = null;
let _p2PgAsyncShim = null;
if (USE_PG) {
  try {
    const deasync = require('deasync');
    _pgAuth = require('./db-auth-pg');
    _pgCore = require('./db-core-pg');
    let _pgStale = false;
    _runPg = (promiseFn, opts = {}) => {
      if (_pgStale) {
        try {
          require('./db-pg').end();
        } catch {}
        _pgStale = false;
      }
      let done = false;
      let err = null;
      let result = null;
      const DEADLINE_MS = opts.deadline ?? 25_000;
      Promise.resolve(promiseFn())
        .then((r) => {
          result = r;
          done = true;
        })
        .catch((e) => {
          err = e;
          done = true;
        });
      const deadline = Date.now() + DEADLINE_MS;
      const ka = setInterval(() => {}, 250);
      try {
        deasync.loopWhile(() => !done && Date.now() < deadline);
      } finally {
        clearInterval(ka);
      }
      if (!done) {
        _pgStale = true;
        try {
          require('./db-pg').end();
        } catch {}
        throw new Error(`[db] _runPg exceeded ${DEADLINE_MS}ms deadline — stale PG pool discarded`);
      }
      if (err) throw err;
      return result;
    };
    _runPg(() => _pgAuth.getSiteSetting('__ping__'));
    _runPg(() => _pgCore.listProjects());
    console.log(
      '[db] PostgreSQL P0+P1: users, site_settings, projects, datasets, analyses, subsets, cell_labels'
    );
    try {
      runPgStartupChecks();
      const p2 = require('./db-p2');
      if (process.env.BIOF3_P2_PG === '1') {
        console.log('[db] Phase B: P2 via PostgreSQL (BIOF3_P2_PG=1)');
      } else if (p2.auxSqlitePath()) {
        console.log('[db] P2 aux SQLite:', p2.auxSqlitePath());
      } else {
        console.warn('[db] P2: set BIOF3_PG_AUX_SQLITE_PATH or BIOF3_P2_PG=1 for production');
      }
    } catch (p2e) {
      console.error('[db] P2 startup failed:', p2e.message);
      throw p2e;
    }
  } catch (e) {
    console.error(
      '[db] DATABASE_URL set but PG unavailable — using SQLite for all tables:',
      e.message
    );
    USE_PG = false;
    _pgAuth = null;
    _pgCore = null;
    _runPg = null;
  }
}

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
// PG 版见 migrations/pg/006_tool_jobs.sql；桌面版 SQLite 在此建表
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
  // tool_jobs（bulk 工具执行记录，方案 C；PG 版见 db-core-pg.js）
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
  if (USE_PG) return _runPg(() => _pgCore.listProjects(undefined, status));
  const normalizedStatus = status === 'archived' ? 'archived' : 'active';
  return stmts.listProjects.all(normalizedStatus).map(hydrateProjectWorkspace);
}

// W1-3: list projects by modality (single-cell | spatial | bulk).
// Pass null/undefined to get everything (back-compat with existing callers).
function listProjectsByModality(modality, status = 'active') {
  if (USE_PG) return _runPg(() => _pgCore.listProjectsByModality(modality, status));
  const normalizedStatus = status === 'archived' ? 'archived' : 'active';
  if (!modality) return stmts.listProjects.all(normalizedStatus).map(hydrateProjectWorkspace);
  return stmts.listProjectsByModality.all(modality, normalizedStatus).map(hydrateProjectWorkspace);
}

function getProject(id) {
  if (USE_PG) return _runPg(() => _pgCore.getProject(id));
  return hydrateProjectWorkspace(stmts.getProject.get(id) || null);
}

function createProject({ name, description, modality, userId, workspacePath }) {
  if (USE_PG) return _runPg(() => _pgCore.createProject({ name, description, modality, userId, workspacePath }));
  const id = uid('p');
  const ts = now();
  const finalWorkspacePath = workspacePath || defaultProjectWorkspacePath({ id, name });
  ensureWorkspaceDir(finalWorkspacePath);
  stmts.insertProject.run(id, name, description || '', ts, ts, modality || 'single-cell', finalWorkspacePath);
  return stmts.getProject.get(id);
}

function setProjectUserId(projectId, userId) {
  if (USE_PG) return _runPg(() => _pgCore.setProjectUserId(projectId, userId));
  db.prepare('UPDATE projects SET user_id = ? WHERE id = ?').run(userId, projectId);
}

// Toggle a project's public flag. PG column is BOOLEAN, SQLite is INTEGER(0/1).
function setProjectPublic(projectId, isPublic) {
  if (USE_PG) return _runPg(() => _pgCore.setProjectPublic(projectId, !!isPublic));
  db.prepare('UPDATE projects SET is_public = ? WHERE id = ?').run(isPublic ? 1 : 0, projectId);
}

function updateProject(id, { name, description, workspacePath }) {
  if (USE_PG) return _runPg(() => _pgCore.updateProject(id, { name, description, workspacePath }));
  if (workspacePath) ensureWorkspaceDir(workspacePath);
  stmts.updateProject.run(name || null, description ?? null, workspacePath || null, now(), id);
  return hydrateProjectWorkspace(stmts.getProject.get(id));
}

function setProjectStatus(id, status) {
  if (USE_PG) return _runPg(() => _pgCore.setProjectStatus(id, status));
  const normalizedStatus = status === 'archived' ? 'archived' : 'active';
  stmts.updateProjectStatus.run(normalizedStatus, now(), id);
  return hydrateProjectWorkspace(stmts.getProject.get(id));
}

function deleteProject(id) {
  if (USE_PG) return _runPg(() => _pgCore.deleteProject(id));
  const datasets = stmts.listDatasets.all(id);
  for (const ds of datasets) {
    stmts.deleteAnalysesByDataset.run(ds.id);
  }
  db.prepare('DELETE FROM datasets WHERE project_id = ?').run(id);
  stmts.deleteProject.run(id);
}

// ---- Datasets ----

function listDatasets(projectId) {
  if (USE_PG) return _runPg(() => _pgCore.listDatasets(projectId));
  return stmts.listDatasets.all(projectId);
}

function getDataset(id) {
  if (USE_PG) return _runPg(() => _pgCore.getDataset(id));
  return stmts.getDataset.get(id) || null;
}

function createDataset({ projectId, name, ossUrl, size, description }) {
  if (USE_PG)
    return _runPg(() => _pgCore.createDataset({ projectId, name, ossUrl, size, description }));
  const id = uid('d');
  stmts.insertDataset.run(id, projectId, name, ossUrl, size || 0, description || '', now());
  stmts.touchProject.run(now(), projectId);
  return stmts.getDataset.get(id);
}

function updateDataset(id, { name, nCells, nGenes, description }) {
  if (USE_PG) return _runPg(() => _pgCore.updateDataset(id, { name, nCells, nGenes, description }));
  stmts.updateDataset.run(name ?? null, nCells ?? null, nGenes ?? null, description ?? null, id);
  return stmts.getDataset.get(id);
}

function deleteDataset(id) {
  if (USE_PG) return _runPg(() => _pgCore.deleteDataset(id));
  stmts.deleteAnalysesByDataset.run(id);
  stmts.deleteDataset.run(id);
}

// Set data-preview URLs (meta_url/features_url). Used by task-manager after
// exporting metadata.csv/features.csv. Goes through the PG switch layer so it
// never writes to local SQLite while the rest of the app reads PG.
function setDatasetMetaUrls(id, { metaUrl, featuresUrl }) {
  if (USE_PG) return _runPg(() => _pgCore.setDatasetMetaUrls(id, { metaUrl, featuresUrl }));
  db.prepare('UPDATE datasets SET meta_url = ?, features_url = ? WHERE id = ?').run(
    metaUrl ?? null,
    featuresUrl ?? null,
    id
  );
  return stmts.getDataset.get(id);
}

// ---- Analyses ----

function listAnalyses(datasetId) {
  if (USE_PG) return _runPg(() => _pgCore.listAnalyses(datasetId));
  const rows = stmts.listAnalyses.all(datasetId);
  return rows.map(parseAnalysisRow);
}

function getAnalysis(id) {
  if (USE_PG) return _runPg(() => _pgCore.getAnalysis(id));
  const row = stmts.getAnalysis.get(id);
  return row ? parseAnalysisRow(row) : null;
}

function getAnalysisByTaskId(taskId) {
  if (USE_PG) return _runPg(() => _pgCore.getAnalysisByTaskId(taskId));
  const row = stmts.getAnalysisByTask.get(taskId);
  return row ? parseAnalysisRow(row) : null;
}

async function getAnalysisByTaskIdAsync(taskId) {
  if (USE_PG) return _pgCore.getAnalysisByTaskId(taskId);
  const row = stmts.getAnalysisByTask.get(taskId);
  return row ? parseAnalysisRow(row) : null;
}

function createAnalysis({ datasetId, taskId, type, name, parentAnalysisId, params, status }) {
  if (USE_PG) {
    return _runPg(() =>
      _pgCore.createAnalysis({ datasetId, taskId, type, name, parentAnalysisId, params, status })
    );
  }
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
  if (USE_PG)
    return _runPg(() =>
      _pgCore.updateAnalysis(id, { name, status, summary, error, finishedAt, results })
    );
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
  if (USE_PG)
    return _runPg(() =>
      _pgCore.updateAnalysisByTaskId(taskId, { status, summary, error, finishedAt, results })
    );
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
  if (USE_PG) return _runPg(() => _pgCore.deleteAnalysis(id));
  stmts.deleteAnalysis.run(id);
}

// ---- Tool jobs（bulk 工具执行记录，方案 C；PG 版见 db-core-pg.js）----

function getToolJob(id) {
  if (USE_PG) return _runPg(() => _pgCore.getToolJob(id));
  const row = stmts.getToolJob.get(id);
  return row ? parseToolJobRow(row) : null;
}

function listProjectToolJobs(projectId) {
  if (USE_PG) return _runPg(() => _pgCore.listProjectToolJobs(projectId));
  const rows = stmts.listProjectToolJobs.all(projectId);
  return rows.map(parseToolJobRow);
}

function createToolJob({ toolId, userId = 'agent', params, status = 'running', name = '', isTestRun = 0, projectId = null }) {
  if (USE_PG) {
    return _runPg(() =>
      _pgCore.createToolJob({ toolId, userId, params, status, name, isTestRun, projectId })
    );
  }
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
  if (USE_PG) {
    return _runPg(() =>
      _pgCore.updateToolJob(id, { status, resultJson, completedAt, error })
    );
  }
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
  if (USE_PG) return _runPg(() => _pgCore.updateToolJobParams(id, params));
  stmts.updateToolJobParams.run(JSON.stringify(params || {}), id);
  return getToolJob(id);
}

function prepareToolJobForRun(id, { params, name }) {
  if (USE_PG) {
    return _runPg(() => _pgCore.prepareToolJobForRun(id, { params, name }));
  }
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
  if (USE_PG) return _runPg(() => _pgCore.setToolJobApproval(id, ackToken, expiresAt));
  db.prepare('UPDATE tool_jobs SET ack_token=?, ack_status=?, ack_expires_at=? WHERE id=?').run(
    ackToken,
    'pending',
    expiresAt,
    id
  );
  return getToolJob(id);
}

function ackToolJob(ackToken, approve) {
  if (USE_PG) return _runPg(() => _pgCore.ackToolJob(ackToken, approve));
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
  if (USE_PG) return _runPg(() => _pgCore.getToolJobByAckToken(ackToken));
  const row = db.prepare('SELECT * FROM tool_jobs WHERE ack_token=?').get(ackToken);
  return row ? parseToolJobRow(row) : null;
}

function listStalledAnalyses() {
  if (USE_PG) return _runPg(() => _pgCore.listStalledAnalyses());
  return db
    .prepare(
      "SELECT id, name, task_id FROM analyses WHERE status IN ('running', 'pending', 'queued')"
    )
    .all();
}

function countAnalysesForUserSince(userId, sinceIso) {
  if (USE_PG) return _runPg(() => _pgCore.countAnalysesForUserSince(userId, sinceIso));
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
  if (USE_PG && _pgCore) return _pgCore.countAnalysesForUserSince(userId, sinceIso);
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
  if (USE_PG) return _runPg(() => _pgCore.getProjectStats(projectId));
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
  if (USE_PG) return _runPg(() => _pgCore.getDatasetStats(datasetId));
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
  if (USE_PG) return _runPg(() => _pgAuth.getUserByUsername(username));
  const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
  return stmt.get(username);
}

function getUserById(id) {
  if (USE_PG) return _runPg(() => _pgAuth.getUserById(id));
  const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
  return stmt.get(id);
}

/** P0 ECS platform: no deasync on auth / module gate hot path */
async function getUserByUsernameAsync(username) {
  if (USE_PG && _pgAuth) return _pgAuth.getUserByUsername(username);
  return getUserByUsername(username);
}

async function getUserByIdAsync(id) {
  if (USE_PG && _pgAuth) return _pgAuth.getUserById(id);
  return getUserById(id);
}

async function createUserAsync(payload) {
  if (USE_PG && _pgAuth) return _pgAuth.createUser(payload);
  return createUser(payload);
}

function createUser({ id, username, passwordHash, role }) {
  if (USE_PG) return _runPg(() => _pgAuth.createUser({ id, username, passwordHash, role }));
  const stmt = db.prepare(
    'INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)'
  );
  stmt.run(id, username, passwordHash, role || 'user');
  return getUserById(id);
}

// ============================================================
// Subsets — saved cell selections
// ============================================================

// ponytail: uid 重复定义（line 305 已有），此处删除避免 no-redeclare。
// subsets 区块如需 uid 直接用上面的全局 uid() 即可。

function listSubsets(datasetId) {
  if (USE_PG) return _runPg(() => _pgCore.listSubsets(datasetId));
  const rows = db
    .prepare('SELECT * FROM subsets WHERE dataset_id = ? ORDER BY created_at DESC')
    .all(datasetId);
  return rows.map(parseSubsetRow);
}

function getSubset(id) {
  if (USE_PG) return _runPg(() => _pgCore.getSubset(id));
  const row = db.prepare('SELECT * FROM subsets WHERE id = ?').get(id);
  return row ? parseSubsetRow(row) : null;
}

function createSubset({ datasetId, name, description, cellIds }) {
  if (USE_PG) return _runPg(() => _pgCore.createSubset({ datasetId, name, description, cellIds }));
  const id = uid('s');
  const ids = Array.isArray(cellIds) ? cellIds : [];
  db.prepare(
    'INSERT INTO subsets (id, dataset_id, name, description, cell_ids, n_cells) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, datasetId, name, description || '', JSON.stringify(ids), ids.length);
  return getSubset(id);
}

function updateSubset(id, { name, description }) {
  if (USE_PG) return _runPg(() => _pgCore.updateSubset(id, { name, description }));
  db.prepare(
    'UPDATE subsets SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?'
  ).run(name || null, description ?? null, id);
  return getSubset(id);
}

function deleteSubset(id) {
  if (USE_PG) return _runPg(() => _pgCore.deleteSubset(id));
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
  if (USE_PG) return _runPg(() => _pgCore.listCellLabels(datasetId));
  const rows = db
    .prepare('SELECT * FROM cell_labels WHERE dataset_id = ? ORDER BY label_name, created_at')
    .all(datasetId);
  return rows.map(parseLabelRow);
}

function getCellLabel(id) {
  if (USE_PG) return _runPg(() => _pgCore.getCellLabel(id));
  const row = db.prepare('SELECT * FROM cell_labels WHERE id = ?').get(id);
  return row ? parseLabelRow(row) : null;
}

function createCellLabel({ datasetId, labelName, labelValue, cellIds }) {
  if (USE_PG)
    return _runPg(() => _pgCore.createCellLabel({ datasetId, labelName, labelValue, cellIds }));
  const id = uid('lbl');
  const ids = Array.isArray(cellIds) ? cellIds : [];
  db.prepare(
    'INSERT INTO cell_labels (id, dataset_id, label_name, label_value, cell_ids, n_cells) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, datasetId, labelName, labelValue, JSON.stringify(ids), ids.length);
  return getCellLabel(id);
}

function deleteCellLabel(id) {
  if (USE_PG) return _runPg(() => _pgCore.deleteCellLabel(id));
  db.prepare('DELETE FROM cell_labels WHERE id = ?').run(id);
}

/** Group label values by label_name for a dataset. Returns:
 *  { tumor_focus: [{value: 'yes', cells: 100, id: 'lbl_xxx'}, {value: 'no', cells: 200}], ... }
 */
function getLabelsSummary(datasetId) {
  if (USE_PG) return _runPg(() => _pgCore.getLabelsSummary(datasetId));
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
  if (USE_PG) return _runPg(() => _pgAuth.listUsers());
  return db
    .prepare(
      'SELECT id, username, role, quota_mb, max_analyses_month, enabled, permissions, created_at FROM users ORDER BY created_at DESC'
    )
    .all();
}

/** Async (deasync-free) user list — for hot/concurrent paths (analytics admin). */
async function listUsersAsync() {
  if (USE_PG && _pgAuth) return _pgAuth.listUsers();
  return db
    .prepare(
      'SELECT id, username, role, quota_mb, max_analyses_month, enabled, permissions, created_at FROM users ORDER BY created_at DESC'
    )
    .all();
}

function updateUser(id, { role, quotaMb, maxAnalysesMonth, enabled, permissions }) {
  if (USE_PG)
    return _runPg(() =>
      _pgAuth.updateUser(id, { role, quotaMb, maxAnalysesMonth, enabled, permissions })
    );
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
  if (USE_PG && _pgAuth)
    return _pgAuth.updateUser(id, { role, quotaMb, maxAnalysesMonth, enabled, permissions });
  return updateUser(id, { role, quotaMb, maxAnalysesMonth, enabled, permissions });
}

function getSiteSetting(key) {
  if (USE_PG) return _runPg(() => _pgAuth.getSiteSetting(key));
  return db.prepare('SELECT key, value, updated_at FROM site_settings WHERE key = ?').get(key);
}

async function getSiteSettingAsync(key) {
  if (USE_PG && _pgAuth) return _pgAuth.getSiteSetting(key);
  return db.prepare('SELECT key, value, updated_at FROM site_settings WHERE key = ?').get(key);
}

function setSiteSetting(key, value) {
  if (USE_PG) return _runPg(() => _pgAuth.setSiteSetting(key, value));
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, now);
  return getSiteSetting(key);
}

async function setSiteSettingAsync(key, value) {
  if (USE_PG && _pgAuth) return _pgAuth.setSiteSetting(key, value);
  return setSiteSetting(key, value);
}

function deleteUser(id) {
  if (USE_PG) return _runPg(() => _pgAuth.deleteUser(id));
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

async function deleteUserAsync(id) {
  if (USE_PG && _pgAuth) return _pgAuth.deleteUser(id);
  return deleteUser(id);
}

/** P2: SQLite aux, or PostgreSQL shim when BIOF3_P2_PG=1 / no aux path (Phase B). */
let _pgReachable = null; // null=unknown, true=reachable, false=unreachable
// TTL cache: once PG is reachable we never re-check; until then we re-check
// on every call so a delayed PG startup (e.g. Docker restart race) can still
// upgrade to the async shim and avoid the deasync sync path.
function _checkPgReachable() {
  if (!USE_PG || !_runPg) {
    _pgReachable = false;
    return false;
  }
  if (_pgReachable !== null) return _pgReachable;
  try {
    _runPg(() => _pgAuth.getSiteSetting('__ping__'));
    _pgReachable = true;
    console.log('[db] PG reachable — using PostgreSQL for P2 tables');
    return true;
  } catch {
    _pgReachable = false;
    return false;
  }
}

function getSqliteForLegacyModules() {
  if (!USE_PG) return db;
  const p2 = require('./db-p2');
  const forcePg = process.env.BIOF3_P2_PG === '1';
  const aux = !forcePg ? p2.getAuxSqlite() : null;
  if (aux) return aux;
  if (forcePg) {
    const { createSyncShim } = require('./db-p2-pg-shim');
    if (!_p2PgShim) {
      _p2PgShim = createSyncShim();
      console.log('[db] Phase B: P2 tables via PostgreSQL (no aux sqlite)');
    }
    return _p2PgShim;
  }
  if (process.env.BIOF3_PG_STRICT === '1') {
    throw new Error(
      '[db] DATABASE_URL + BIOF3_PG_STRICT=1: set BIOF3_PG_AUX_SQLITE_PATH or BIOF3_P2_PG=1'
    );
  }
  if (!_pgReachable) {
    console.warn(
      '[db] P2: PG unreachable — using local SQLite (tool_jobs). This is expected on Dell worker nodes without VPC access.'
    );
  } else {
    console.warn('[db] P2: BIOF3_P2_PG not set — using local SQLite for aux tables');
  }
  return db;
}

/**
 * Async (Promise-based) DB accessor for hot platform routes — same selection
 * logic as getSqliteForLegacyModules() but returns a facade whose run/get/all
 * are async, so PG-mode access goes through the deasync-FREE async shim. In
 * SQLite mode it wraps the sync better-sqlite3 handle (await of a sync result).
 * Use this on high-frequency paths (analytics) to avoid freezing the event loop.
 */
/** Convert PostgreSQL-style $N placeholders to SQLite ? placeholders. */
function _pgToSqlitePlaceholders(sql) {
  if (typeof sql !== 'string' || !sql.includes('$')) return sql;
  return sql.replace(/\$(\d+)/g, '?');
}

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
  if (!USE_PG) return _wrapSyncDbAsync(db);
  const p2 = require('./db-p2');
  const forcePg = process.env.BIOF3_P2_PG === '1';
  const aux = !forcePg ? p2.getAuxSqlite() : null;
  if (aux) return _wrapSyncDbAsync(aux);
  if (forcePg) {
    const { createAsyncShim } = require('./db-p2-pg-shim');
    if (!_p2PgAsyncShim) _p2PgAsyncShim = createAsyncShim();
    return _p2PgAsyncShim;
  }
  return _wrapSyncDbAsync(db);
}
function runPgStartupChecks() {
  if (!USE_PG || !_runPg) return;
  const p2 = require('./db-p2');
  if (process.env.BIOF3_PG_SKIP_AUX_CHECK === '1') {
    console.warn('[db] BIOF3_PG_SKIP_AUX_CHECK=1 — skipping P2 schema check');
    return;
  }
  _runPg(() => p2.ensurePgAuxSchema());
  if (process.env.BIOF3_PG_STRICT === '1' && !p2.auxSqlitePath()) {
    throw new Error(
      '[db] BIOF3_PG_STRICT=1 requires BIOF3_PG_AUX_SQLITE_PATH until P2 queries are ported to PG'
    );
  }
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
  isPgUsers: () => USE_PG,
  isPg: () => USE_PG,
  getSqliteForLegacyModules,
  getAsyncDbForLegacyModules,
  runPgStartupChecks,
  USE_PG,
};
