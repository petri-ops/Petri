-- Phase 1 — Branch Conversation Data Model (migration 005)
--
-- 分支对话架构的 SQLite 持久化 schema：
-- - projects：项目元数据
-- - branches：对话分支，隔离对话历史
-- - messages：分支下的对话记录
--
-- 约束：
-- - 不含 BEGIN/COMMIT：migration-runner 已把本文件包在 db.transaction 内。
-- - 不使用 INSERT OR REPLACE / PRAGMA / AUTOINCREMENT。
-- - 只新增表与索引，不修改任何现有表。

-- 项目表
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 分支表
CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_branch_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

-- 对话消息表
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_branches_project ON branches(project_id);
CREATE INDEX IF NOT EXISTS idx_branches_parent ON branches(parent_branch_id);
CREATE INDEX IF NOT EXISTS idx_branches_active ON branches(project_id, is_active);
CREATE INDEX IF NOT EXISTS idx_messages_branch ON messages(branch_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(branch_id, created_at);
