-- G0-RS2 — Result Studio 版本与选择持久化（migration 001）
--
-- 本文件由 core/shared-backend/result-studio-schema.js 的 buildMigrationSql()
-- 定义，两者必须逐字节一致；test/result-studio-migration.test.mjs 强制该约束。
-- 不要手工编辑本文件：改 schema 请改 result-studio-schema.js 后重新生成。
--
-- 约束：
-- - 不含 BEGIN/COMMIT：migration-runner 已把本文件包在 db.transaction 内。
-- - 不使用 INSERT OR REPLACE / PRAGMA / AUTOINCREMENT。
-- - 只新增表与索引，不修改任何现有表。

CREATE TABLE IF NOT EXISTS git_repository_bindings (
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
);

CREATE TABLE IF NOT EXISTS scientific_change_sets (
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
);

CREATE INDEX IF NOT EXISTS idx_rs_change_sets_project ON scientific_change_sets(project_id);

CREATE INDEX IF NOT EXISTS idx_rs_change_sets_status ON scientific_change_sets(status);

CREATE INDEX IF NOT EXISTS idx_rs_change_sets_branch ON scientific_change_sets(working_branch_ref);

CREATE TABLE IF NOT EXISTS artifact_revisions (
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
);

CREATE INDEX IF NOT EXISTS idx_rs_revisions_project ON artifact_revisions(project_id);

CREATE INDEX IF NOT EXISTS idx_rs_revisions_family ON artifact_revisions(artifact_family_id);

CREATE INDEX IF NOT EXISTS idx_rs_revisions_change_set ON artifact_revisions(change_set_id);

CREATE INDEX IF NOT EXISTS idx_rs_revisions_job ON artifact_revisions(tool_job_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rs_revisions_family_ordinal ON artifact_revisions(artifact_family_id, revision_ordinal);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rs_revisions_family_current ON artifact_revisions(artifact_family_id) WHERE is_current = 1;

CREATE TABLE IF NOT EXISTS result_selection_contexts (
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
);

CREATE INDEX IF NOT EXISTS idx_rs_selections_project ON result_selection_contexts(project_id);

CREATE INDEX IF NOT EXISTS idx_rs_selections_artifact ON result_selection_contexts(artifact_id);

CREATE INDEX IF NOT EXISTS idx_rs_selections_conversation ON result_selection_contexts(conversation_id);

CREATE TABLE IF NOT EXISTS workspace_revision_checkpoints (
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
);

CREATE INDEX IF NOT EXISTS idx_rs_checkpoints_project ON workspace_revision_checkpoints(project_id);

CREATE INDEX IF NOT EXISTS idx_rs_checkpoints_change_set ON workspace_revision_checkpoints(change_set_id);
