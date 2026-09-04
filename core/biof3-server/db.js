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
const {
  LEGACY_BASELINE_ID,
  PROJECT_BASELINE_RECORD_VERSION,
  getCurrentG0Baseline,
  evaluateProjectBaselineCompatibility,
} = require('../shared-backend/g0-baseline');

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

// HRT-3: durable ScientificTaskSpec + confirmation ledger. The immutable
// spec hash and confirmation record are stored separately from tool_jobs;
// execution still uses tool_jobs as the only runtime truth.
try {
  db.exec(`CREATE TABLE IF NOT EXISTS scientific_task_specs (
    task_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    status TEXT NOT NULL,
    spec_json TEXT NOT NULL,
    spec_hash TEXT NOT NULL,
    confirmation_json TEXT,
    tool_job_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (task_id, version)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_scientific_task_project ON scientific_task_specs(project_id, updated_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_scientific_task_conversation ON scientific_task_specs(conversation_id, updated_at DESC)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_scientific_task_hash ON scientific_task_specs(spec_hash)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_scientific_task_job ON scientific_task_specs(tool_job_id) WHERE tool_job_id IS NOT NULL');
} catch {}

// HRT-6: durable, source-addressed context checkpoints used by exported
// scientific replay/handoff packages. Raw conversation text remains in the
// conversation ledger; checkpoints store only the validated structured
// projection and its source digest.
try {
  db.exec(`CREATE TABLE IF NOT EXISTS context_checkpoints (
    checkpoint_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    source_digest TEXT NOT NULL,
    checkpoint_json TEXT NOT NULL,
    supersedes TEXT,
    created_at TEXT NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_context_checkpoint_conversation ON context_checkpoints(project_id, conversation_id, created_at DESC)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_context_checkpoint_source ON context_checkpoints(project_id, conversation_id, source_digest)');
} catch {}

// HLE-1: durable Loop ledger — LoopRun / Iteration / Action / Evidence / Decision
// / Snapshot. JSON columns hold the canonical contract objects produced by
// core/shared-backend/loop-contract.js; the hash columns enable stable
// dedupe and replay. Loop ledger is append-only; idempotent actionKey
// prevents double execution. Raw Provider responses and stack traces
// never enter these columns (handled by loop-contract redaction).
try {
  db.exec(`CREATE TABLE IF NOT EXISTS loop_runs (
    loop_run_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    task_spec_ref TEXT,
    automation_mode TEXT,
    loop_status TEXT NOT NULL,
    loop_status_hash TEXT NOT NULL,
    loop_status_json TEXT NOT NULL,
    is_partial INTEGER NOT NULL DEFAULT 0,
    partial_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_loop_run_conversation ON loop_runs(project_id, conversation_id, updated_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_loop_run_status ON loop_runs(loop_status)');

  db.exec(`CREATE TABLE IF NOT EXISTS loop_iterations (
    iteration_id TEXT PRIMARY KEY,
    loop_run_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    observed_state_digest TEXT,
    goal_gap_ids_json TEXT,
    decision TEXT NOT NULL,
    decision_reason_code TEXT NOT NULL,
    confidence REAL,
    notes TEXT,
    public_conclusion TEXT,
    status TEXT NOT NULL,
    hash TEXT NOT NULL,
    parent_iteration_hash TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(loop_run_id, sequence)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_loop_iter_run ON loop_iterations(loop_run_id, sequence DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_loop_iter_hash ON loop_iterations(hash)');

  db.exec(`CREATE TABLE IF NOT EXISTS loop_actions (
    action_id TEXT PRIMARY KEY,
    action_key TEXT NOT NULL UNIQUE,
    iteration_id TEXT,
    loop_run_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    action_type TEXT NOT NULL,
    tool_id TEXT,
    inputs_json TEXT,
    params_json TEXT,
    expected_artifact_kinds_json TEXT,
    attempt INTEGER NOT NULL DEFAULT 1,
    hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_loop_action_run ON loop_actions(loop_run_id, sequence DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_loop_action_iter ON loop_actions(iteration_id)');

  db.exec(`CREATE TABLE IF NOT EXISTS loop_evidence (
    evidence_id TEXT PRIMARY KEY,
    loop_run_id TEXT NOT NULL,
    iteration_id TEXT,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    summary_digest TEXT,
    parent_evidence_hash TEXT,
    hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_loop_evidence_run ON loop_evidence(loop_run_id, created_at DESC)');

  db.exec(`CREATE TABLE IF NOT EXISTS loop_decisions (
    decision_id TEXT PRIMARY KEY,
    iteration_id TEXT NOT NULL,
    loop_run_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    decision_reason_code TEXT NOT NULL,
    confidence REAL,
    notes TEXT,
    hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_loop_decision_iter ON loop_decisions(iteration_id)');

  db.exec(`CREATE TABLE IF NOT EXISTS loop_state_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    loop_run_id TEXT NOT NULL,
    sequence_at INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_loop_snapshot_run ON loop_state_snapshots(loop_run_id, sequence_at DESC)');
} catch {}

// AGENT-CONCURRENCY: sub-agent task pool — LoopRun identity columns (idempotent, safe to re-run)
try { db.exec('ALTER TABLE loop_runs ADD COLUMN kind TEXT'); } catch {}
try { db.exec('ALTER TABLE loop_runs ADD COLUMN parent_loop_run_id TEXT'); } catch {}
try { db.exec('ALTER TABLE loop_runs ADD COLUMN task_id TEXT'); } catch {}

// ============================================================
// Schema
// ============================================================
//
// Schema 分为两类：
// 1. 用户数据持久化表（projects/branches/messages/results 等）：
//    由 src/migrations/*.sql 管理，启动时 src/main.js 先执行 migration-runner
// 2. 运行时工作表（datasets/analyses/tool_jobs 等）：
//    在本文件中通过 CREATE TABLE IF NOT EXISTS 创建，用于临时计算和任务管理
//
// 历史遗留：project_g0_baselines 等表由 G0-LF0 特性引入，
// 未迁移到 migration 是因为它们是运行时元数据（非用户数据持久化）。

// 运行时工作表：datasets 和 analyses 用于单细胞分析流程的临时数据管理
db.exec(`
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

// G0-LF0: every project records the baseline that created it (or an explicit
// legacy marker), the baseline that most recently opened it, and the current
// compatibility verdict. This is metadata about the existing project truth;
// it does not create a second task, Job, Artifact or workflow ledger.
db.exec(`CREATE TABLE IF NOT EXISTS project_g0_baselines (
  project_id TEXT PRIMARY KEY,
  record_version INTEGER NOT NULL,
  created_baseline_id TEXT NOT NULL,
  created_baseline_version TEXT,
  created_manifest_digest TEXT,
  created_bundle_digest TEXT,
  opened_baseline_id TEXT NOT NULL,
  opened_baseline_version TEXT NOT NULL,
  opened_manifest_digest TEXT NOT NULL,
  opened_bundle_digest TEXT NOT NULL,
  compatibility_status TEXT NOT NULL,
  compatibility_reason TEXT NOT NULL,
  first_recorded_at TEXT NOT NULL,
  last_opened_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_project_g0_compatibility ON project_g0_baselines(compatibility_status, last_opened_at DESC)');

// The LF0 schema may already exist from an earlier establishing build. SQLite's
// CREATE TABLE IF NOT EXISTS does not add later columns, so upgrade the record
// in place before preparing statements. Creator bundle identity is backfilled
// only when the stored baseline id/version/manifest still exactly match the
// current baseline; legacy or ambiguous creator history remains null.
const projectG0Columns = new Set(
  db.prepare('PRAGMA table_info(project_g0_baselines)').all().map((column) => column.name)
);
if (!projectG0Columns.has('created_bundle_digest')) {
  db.exec('ALTER TABLE project_g0_baselines ADD COLUMN created_bundle_digest TEXT');
}
if (!projectG0Columns.has('opened_bundle_digest')) {
  db.exec('ALTER TABLE project_g0_baselines ADD COLUMN opened_bundle_digest TEXT');
}
const g0MigrationBaseline = getCurrentG0Baseline();
db.prepare(
  `UPDATE project_g0_baselines
   SET opened_bundle_digest = ?
   WHERE opened_bundle_digest IS NULL
     AND opened_baseline_id = ?
     AND opened_baseline_version = ?
     AND opened_manifest_digest = ?`
).run(
  g0MigrationBaseline.bundleDigest,
  g0MigrationBaseline.baselineId,
  g0MigrationBaseline.baselineVersion,
  g0MigrationBaseline.manifestDigest,
);
db.prepare(
  `UPDATE project_g0_baselines
   SET created_bundle_digest = ?
   WHERE created_bundle_digest IS NULL
     AND created_baseline_id = ?
     AND created_baseline_version = ?
     AND created_manifest_digest = ?`
).run(
  g0MigrationBaseline.bundleDigest,
  g0MigrationBaseline.baselineId,
  g0MigrationBaseline.baselineVersion,
  g0MigrationBaseline.manifestDigest,
);

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
// Migration (PROJECT_MEMORY_SCOPE_v1): memory payloads must never cross projects.
// Legacy rows remain project-less unless a linked conversation can identify
// their project safely; helpers/conversations.js performs that backfill.
try { db.exec('ALTER TABLE user_facts ADD COLUMN project_id TEXT'); } catch {}
try { db.exec('ALTER TABLE memory_vectors ADD COLUMN project_id TEXT'); } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_user_facts_project ON user_facts(user_id, project_id, pinned DESC, updated_at DESC)'); } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_memvec_project ON memory_vectors(user_id, project_id, ts DESC)'); } catch {}
try {
  db.exec(`CREATE TABLE IF NOT EXISTS project_chat_summaries (
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL,
    msg_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, project_id)
  )`);
  db.exec(`
    INSERT OR IGNORE INTO project_chat_summaries(user_id, project_id, summary, msg_count, updated_at)
    SELECT user_id, '', summary, msg_count, updated_at FROM chat_summaries
  `);
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
    error TEXT,
    conversation_id TEXT
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
  try { db.exec('ALTER TABLE tool_jobs ADD COLUMN process_pid INTEGER'); } catch {}
  try { db.exec('ALTER TABLE tool_jobs ADD COLUMN heartbeat_at BIGINT'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_tool_jobs_project ON tool_jobs(project_id)'); } catch {}
  // BLOCK-57：远程执行目标（作业级 ExecutionTarget，本地永远是默认——列为 NULL 即本地路径）
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS execution_targets (
      id TEXT PRIMARY KEY,
      alias TEXT NOT NULL,
      label TEXT DEFAULT '',
      created_at BIGINT NOT NULL,
      last_probe_json TEXT,
      last_probe_at BIGINT,
      status TEXT DEFAULT 'unprobed'
    )`);
  } catch {}
  try { db.exec('ALTER TABLE tool_jobs ADD COLUMN execution_target_id TEXT'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_tool_jobs_execution_target ON tool_jobs(execution_target_id)'); } catch {}
  // 目标级运行时路径覆盖（{"r":"/abs/Rscript"}）——集群 module 系统 / 非 PATH 安装的运行时
  try { db.exec('ALTER TABLE execution_targets ADD COLUMN runtime_json TEXT'); } catch {}
} catch {}

// UX1G-1: bind persisted tool jobs to the conversation that authorized them.
// Legacy jobs are backfilled only when exactly one scientific task in the same
// project points at the job. Ambiguous, cross-project, and otherwise unknown
// history remains explicitly unscoped (NULL).
try { db.exec('ALTER TABLE tool_jobs ADD COLUMN conversation_id TEXT'); } catch {}
try {
  db.exec(`
    UPDATE tool_jobs
    SET conversation_id = (
      SELECT MIN(spec.conversation_id)
      FROM scientific_task_specs AS spec
      WHERE spec.tool_job_id = tool_jobs.id
        AND spec.project_id = tool_jobs.project_id
        AND json_extract(spec.confirmation_json, '$.userId') = tool_jobs.user_id
        AND json_extract(spec.confirmation_json, '$.selectedToolId') = tool_jobs.tool_id
    )
    WHERE conversation_id IS NULL
      AND (
        SELECT COUNT(*)
        FROM scientific_task_specs AS spec
        WHERE spec.tool_job_id = tool_jobs.id
          AND spec.project_id = tool_jobs.project_id
          AND json_extract(spec.confirmation_json, '$.userId') = tool_jobs.user_id
          AND json_extract(spec.confirmation_json, '$.selectedToolId') = tool_jobs.tool_id
      ) = 1
  `);
} catch {}
try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_tool_jobs_project_conversation ON tool_jobs(project_id, conversation_id, created_at DESC)');
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

function createProject({ name, description, modality, userId, workspacePath }) {
  const id = uid('p');
  const ts = now();
  const finalWorkspacePath = workspacePath || defaultProjectWorkspacePath({ id, name });
  ensureWorkspaceDir(finalWorkspacePath);
  stmts.insertProject.run(id, name, description || '', ts, ts, modality || 'single-cell', finalWorkspacePath);
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
  const { validateScientificTaskExecution } = require('../shared-backend/scientific-task-confirmation');
  const executionGate = validateScientificTaskExecution({
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

/** Async user list for route handlers. */
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
// Shared SQLite accessors
// ============================================================

function getDatabase() {
  return db;
}

/** Close the underlying SQLite connection (releases the file handle).
 *  Needed so callers/tests can remove the DB file on platforms (Windows)
 *  that forbid deleting an open file. Safe to call when already closed. */
function closeDatabase() {
  try {
    db.close();
  } catch (_) {
    // already closed or never opened
  }
}

/** Promise facade over better-sqlite3 for async route handlers. */
function createAsyncDatabaseFacade(realDb) {
  return {
    async exec(ddl) {
      return realDb.exec(ddl);
    },
    prepare(sql) {
      const stmt = realDb.prepare(sql);
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

function getAsyncDatabase() {
  return createAsyncDatabaseFacade(db);
}

module.exports = {
  listProjects,
  getProject,
  createProject,
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
