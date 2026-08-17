-- Phase 4 — Result Studio conversation_export type
--
-- C-002 修复（BLOCK-10-AUDIT-CLOSEOUT PHASE 1）：
-- electron.d.ts L356-357 + result.types.ts L12 的 ResultType union 已声明
-- `'conversation_export'`，但 results.type 的 CHECK 约束仅允许
-- ('chart','table','code','text','file')，导致 result:create({type:'conversation_export'})
-- 即便通过 validTypes 校验也会被 DB 拒。
--
-- 修复：重建 results 表扩展 CHECK 集合为 6 个值（含 conversation_export）。
-- 遵循 Global Constraints：不用 INSERT OR REPLACE / PRAGMA / AUTOINCREMENT；
-- migration-runner 已把本文件包在 db.transaction 内，故不写 BEGIN/COMMIT。
--
-- 12-step SQLite table-rebuild 是标准模式（保留 rowid / 所有数据 / 所有索引）：

CREATE TABLE IF NOT EXISTS results_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('chart', 'table', 'code', 'text', 'file', 'conversation_export')),
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  config TEXT,
  source_branch_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

INSERT INTO results_new (id, project_id, type, name, data, config, source_branch_id, created_at, updated_at)
SELECT id, project_id, type, name, data, config, source_branch_id, created_at, updated_at
FROM results;

DROP TABLE results;

ALTER TABLE results_new RENAME TO results;

-- 重建索引（与 migration 006 一致）
CREATE INDEX IF NOT EXISTS idx_results_project ON results(project_id);
CREATE INDEX IF NOT EXISTS idx_results_type ON results(project_id, type);
CREATE INDEX IF NOT EXISTS idx_results_created ON results(project_id, created_at DESC);