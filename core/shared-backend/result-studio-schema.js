'use strict';

/**
 * shared-backend/result-studio-schema.js
 *
 * G0-RS2 — Result Studio 持久化层的**唯一** DDL 来源。
 *
 * 决策来源：docs/g0-rs0-result-studio-audit.md ADR-RS-2
 * - RS 的 5 张新表走正式 migration 文件，不沿用 db.js 的
 *   `try { ALTER TABLE } catch {}` 惯例。
 *
 * 为什么 DDL 在 JS 里而不是只写在 .sql 里：
 * `src/migrations/001_result_studio.sql` 必须与本文件的 `buildMigrationSql()`
 * 逐字节一致，并由 test/result-studio-migration.test.mjs 强制。这样既满足
 * "正式 migration 文件"的可审计要求，又避免 schema 在两处漂移。
 *
 * 不变量：
 * - 不使用 `INSERT OR REPLACE`、`PRAGMA`、`AUTOINCREMENT`（项目 Global Constraints）。
 * - 不含 BEGIN/COMMIT：migration-runner 已把每个文件包在 db.transaction 里，
 *   再嵌套事务会直接报 "cannot start a transaction within a transaction"。
 * - 不修改任何现有表。RS 只新增表。
 * - "当前版本"唯一性由部分唯一索引在数据库层保证，不靠应用层自觉。
 */

const RESULT_STUDIO_SCHEMA_VERSION = 1;

/** migration 文件编号；与 src/migrations/001_result_studio.sql 对应。 */
const RESULT_STUDIO_MIGRATION_VERSION = 1;

const RESULT_STUDIO_TABLES = Object.freeze([
  'git_repository_bindings',
  'scientific_change_sets',
  'artifact_revisions',
  'result_selection_contexts',
  'workspace_revision_checkpoints',
]);

/**
 * 逐条 DDL。顺序固定：表在索引之前。
 * 每条都是幂等的（IF NOT EXISTS），因此可重复执行。
 */
const SCHEMA_STATEMENTS = Object.freeze([
  // -------------------------------------------------------------------------
  // 1. 项目 → Git 版本后端绑定（RS1 bindProjectRepository 的持久化投影）
  // -------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS git_repository_bindings (
  project_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  mode TEXT NOT NULL,
  workspace_root TEXT NOT NULL,
  git_dir TEXT NOT NULL,
  work_tree TEXT NOT NULL,
  managed_paths_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  reason TEXT,
  git_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,

  // -------------------------------------------------------------------------
  // 2. ScientificChangeSet v1 — 一次原子修改
  // -------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS scientific_change_sets (
  change_set_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  project_id TEXT NOT NULL,
  conversation_id TEXT,
  intent_ref TEXT,
  base_commit TEXT NOT NULL,
  candidate_commit TEXT,
  working_branch_ref TEXT NOT NULL,
  status TEXT NOT NULL,
  status_reason TEXT,
  changed_paths_json TEXT NOT NULL DEFAULT '[]',
  parent_artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  candidate_artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  job_refs_json TEXT NOT NULL DEFAULT '[]',
  validation_summary_json TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  adopted_at TEXT,
  reverted_at TEXT
)`,
  'CREATE INDEX IF NOT EXISTS idx_rs_change_sets_project ON scientific_change_sets(project_id)',
  'CREATE INDEX IF NOT EXISTS idx_rs_change_sets_status ON scientific_change_sets(status)',
  'CREATE INDEX IF NOT EXISTS idx_rs_change_sets_branch ON scientific_change_sets(working_branch_ref)',

  // -------------------------------------------------------------------------
  // 3. ArtifactRevision v1 — 科学产物的一个版本
  //
  // validation_status 与 reproducibility_status 是两套不同词汇，必须分开：
  //   validation_status      ← reconcileArtifactTruth()  valid|degraded|blocked
  //   reproducibility_status ← delivery-manifest         unavailable|available|verified
  // RS0 审计已记录计划原文把两者混成一个枚举是契约缺陷。
  // -------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS artifact_revisions (
  revision_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  project_id TEXT NOT NULL,
  artifact_family_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  revision_ordinal INTEGER NOT NULL DEFAULT 1,
  parent_revision_ids_json TEXT NOT NULL DEFAULT '[]',
  source_commit TEXT,
  source_script_ref_json TEXT,
  input_artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  parameters_ref TEXT,
  parameters_hash TEXT,
  tool_job_id TEXT,
  output_path TEXT NOT NULL,
  output_hash TEXT,
  validation_status TEXT NOT NULL,
  reproducibility_status TEXT NOT NULL DEFAULT 'unavailable',
  change_set_id TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  superseded_at TEXT,
  created_at TEXT NOT NULL
)`,
  'CREATE INDEX IF NOT EXISTS idx_rs_revisions_project ON artifact_revisions(project_id)',
  'CREATE INDEX IF NOT EXISTS idx_rs_revisions_family ON artifact_revisions(artifact_family_id)',
  'CREATE INDEX IF NOT EXISTS idx_rs_revisions_change_set ON artifact_revisions(change_set_id)',
  'CREATE INDEX IF NOT EXISTS idx_rs_revisions_job ON artifact_revisions(tool_job_id)',
  // 同一 family 的 ordinal 不可重复 → 版本序不会因并发写入错乱。
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_rs_revisions_family_ordinal ON artifact_revisions(artifact_family_id, revision_ordinal)',
  // 同一 family 最多一个 current → 数据库层排除"两个当前版本"。
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_rs_revisions_family_current ON artifact_revisions(artifact_family_id) WHERE is_current = 1',

  // -------------------------------------------------------------------------
  // 4. SelectionContext v1 — 用户在表格/图形上的结构化选择
  //
  // 大规模选择不把百万 ID 落库：超过阈值时只存 filter + hash + count。
  // -------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS result_selection_contexts (
  selection_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  project_id TEXT NOT NULL,
  conversation_id TEXT,
  artifact_id TEXT NOT NULL,
  revision_id TEXT,
  entity_type TEXT NOT NULL,
  entity_ids_json TEXT NOT NULL DEFAULT '[]',
  entity_id_count INTEGER NOT NULL DEFAULT 0,
  entity_ids_truncated INTEGER NOT NULL DEFAULT 0,
  entity_ids_hash TEXT,
  filter_expression_json TEXT,
  sort_json TEXT,
  viewport_json TEXT,
  display_state_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
  'CREATE INDEX IF NOT EXISTS idx_rs_selections_project ON result_selection_contexts(project_id)',
  'CREATE INDEX IF NOT EXISTS idx_rs_selections_artifact ON result_selection_contexts(artifact_id)',
  'CREATE INDEX IF NOT EXISTS idx_rs_selections_conversation ON result_selection_contexts(conversation_id)',

  // -------------------------------------------------------------------------
  // 5. WorkspaceCheckpoint v1 — 重启后恢复当前版本/选择/未采用预览
  // -------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS workspace_revision_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  project_id TEXT NOT NULL,
  conversation_id TEXT,
  base_commit TEXT,
  candidate_commit TEXT,
  change_set_id TEXT,
  change_set_status TEXT,
  current_revision_ids_json TEXT NOT NULL DEFAULT '[]',
  selection_id TEXT,
  pending_preview_json TEXT,
  job_refs_json TEXT NOT NULL DEFAULT '[]',
  loop_refs_json TEXT NOT NULL DEFAULT '[]',
  checkpoint_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
  'CREATE INDEX IF NOT EXISTS idx_rs_checkpoints_project ON workspace_revision_checkpoints(project_id)',
  'CREATE INDEX IF NOT EXISTS idx_rs_checkpoints_change_set ON workspace_revision_checkpoints(change_set_id)',
]);

const MIGRATION_HEADER = `-- G0-RS2 — Result Studio 版本与选择持久化（migration 001）
--
-- 本文件由 core/shared-backend/result-studio-schema.js 的 buildMigrationSql()
-- 定义，两者必须逐字节一致；test/result-studio-migration.test.mjs 强制该约束。
-- 不要手工编辑本文件：改 schema 请改 result-studio-schema.js 后重新生成。
--
-- 约束：
-- - 不含 BEGIN/COMMIT：migration-runner 已把本文件包在 db.transaction 内。
-- - 不使用 INSERT OR REPLACE / PRAGMA / AUTOINCREMENT。
-- - 只新增表与索引，不修改任何现有表。`;

/**
 * 生成 migration 文件正文。
 *
 * @returns {string} 以换行结尾的完整 SQL
 */
function buildMigrationSql() {
  const body = SCHEMA_STATEMENTS.map((statement) => `${statement};`).join('\n\n');
  return `${MIGRATION_HEADER}\n\n${body}\n`;
}

/**
 * 幂等建表。
 *
 * 用途：开发与测试环境中 r-server 可能在 Electron migration 之前就需要这些表。
 * 生产升级路径仍是 migration 文件；本函数执行的是同一份 DDL，不是第二套 schema。
 *
 * @param {{ exec: Function }} db better-sqlite3 实例
 * @returns {{ schemaVersion: number, tables: string[] }}
 */
function ensureResultStudioSchema(db) {
  if (!db || typeof db.exec !== 'function') {
    throw new Error('[result-studio-schema] db instance with exec() is required');
  }
  for (const statement of SCHEMA_STATEMENTS) db.exec(statement);
  return { schemaVersion: RESULT_STUDIO_SCHEMA_VERSION, tables: [...RESULT_STUDIO_TABLES] };
}

/**
 * 检查 RS 表是否齐备。缺表时返回缺失清单，不自动创建。
 *
 * @param {{ prepare: Function }} db
 * @returns {{ complete: boolean, missingTables: string[], presentTables: string[] }}
 */
function inspectResultStudioSchema(db) {
  if (!db || typeof db.prepare !== 'function') {
    throw new Error('[result-studio-schema] db instance with prepare() is required');
  }
  const statement = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?");
  const missingTables = RESULT_STUDIO_TABLES.filter((table) => !statement.get(table));
  const presentTables = RESULT_STUDIO_TABLES.filter((table) => !missingTables.includes(table));
  return { complete: missingTables.length === 0, missingTables, presentTables };
}

module.exports = {
  RESULT_STUDIO_SCHEMA_VERSION,
  RESULT_STUDIO_MIGRATION_VERSION,
  RESULT_STUDIO_TABLES,
  SCHEMA_STATEMENTS,
  buildMigrationSql,
  ensureResultStudioSchema,
  inspectResultStudioSchema,
};
