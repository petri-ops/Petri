-- Phase 2 — Result Studio Data Model (migration 006)
--
-- Result 持久化架构：
-- - Result 归属项目，不归属分支
-- - 分支切换时 Result 保持可见
-- - 同一项目的所有分支共享同一份 Result
--
-- 约束：
-- - 不含 BEGIN/COMMIT：migration-runner 已把本文件包在 db.transaction 内。
-- - 不使用 INSERT OR REPLACE / PRAGMA / AUTOINCREMENT。
-- - 只新增表与索引，不修改任何现有表。

-- results 表（分析结果）
CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('chart', 'table', 'code', 'text', 'file')),
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  config TEXT,
  source_branch_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- result_tags 表（标签分类）
CREATE TABLE IF NOT EXISTS result_tags (
  id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  FOREIGN KEY (result_id) REFERENCES results(id) ON DELETE CASCADE,
  UNIQUE(result_id, tag)
);

-- result_versions 表（版本快照）
CREATE TABLE IF NOT EXISTS result_versions (
  id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  config TEXT,
  created_at INTEGER NOT NULL,
  created_by_branch_id TEXT,
  FOREIGN KEY (result_id) REFERENCES results(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_results_project ON results(project_id);
CREATE INDEX IF NOT EXISTS idx_results_type ON results(project_id, type);
CREATE INDEX IF NOT EXISTS idx_results_created ON results(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_result_tags_result ON result_tags(result_id);
CREATE INDEX IF NOT EXISTS idx_result_versions_result ON result_versions(result_id, version DESC);
