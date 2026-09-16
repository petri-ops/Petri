'use strict';

const { now } = require('./connection');
const { getCurrentG0Baseline } = require('../../shared-backend/g0-baseline');

// BLOCK-92 Wave C-3 — DDL 与迁移外迁（原 db.js，纯搬运零行为变化）。
// initSchema(db) 由 connection.js 在连接建立、pragma 设置后立即调用，
// 与拆分前"模块加载即执行 DDL"的时序逐行一致。

function initSchema(db) {
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
// Migration (BLOCK-67 ssh_remote_v1): 远程项目工作区形态。workspace_kind = 'local'(默认) | 'ssh'；
// ssh 项目：ssh_host = ~/.ssh/config 别名（assertAlias 白名单），remote_path = 远端绝对路径，
// workspace_path 保持 NULL（本地不留副本真值，D3 远程唯一真值）。
try {
  db.exec("ALTER TABLE projects ADD COLUMN workspace_kind TEXT DEFAULT 'local'");
} catch {}
try {
  db.exec('ALTER TABLE projects ADD COLUMN ssh_host TEXT');
} catch {}
try {
  db.exec('ALTER TABLE projects ADD COLUMN remote_path TEXT');
} catch {}
try {
  db.exec("UPDATE projects SET workspace_kind = 'local' WHERE workspace_kind IS NULL");
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
}

module.exports = { initSchema };
