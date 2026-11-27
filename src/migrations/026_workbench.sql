-- item88 工作台第一波（地基）：四表独立，feature flag 关时零写入（与既有表不双写）。
-- 遵 migrations/README：不用 AUTOINCREMENT / BEGIN / PRAGMA / INSERT OR REPLACE。
-- wb_documents append-only：只 INSERT，chain_hash 串接，修正以新版本表达。

CREATE TABLE IF NOT EXISTS wb_goals (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  description         TEXT NOT NULL,
  budget_cny          REAL,
  status              TEXT NOT NULL DEFAULT 'draft',
  acceptance_json     TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wb_goals_project ON wb_goals(project_id);

CREATE TABLE IF NOT EXISTS wb_tasks (
  id                  TEXT PRIMARY KEY,
  goal_id             TEXT,
  spec_json           TEXT,
  status              TEXT NOT NULL DEFAULT 'draft',
  worker_task_id      TEXT,
  priority            INTEGER NOT NULL DEFAULT 0,
  dependencies_json   TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wb_tasks_goal ON wb_tasks(goal_id);
CREATE INDEX IF NOT EXISTS idx_wb_tasks_status ON wb_tasks(status);

CREATE TABLE IF NOT EXISTS wb_documents (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT,
  type                TEXT NOT NULL,
  version             INTEGER NOT NULL DEFAULT 1,
  content_json        TEXT NOT NULL,
  prev_chain_hash     TEXT,
  chain_hash          TEXT NOT NULL,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wb_documents_task ON wb_documents(task_id);
CREATE INDEX IF NOT EXISTS idx_wb_documents_chain ON wb_documents(task_id, version);

CREATE TABLE IF NOT EXISTS wb_changes (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT,
  content_json        TEXT NOT NULL,
  impact_json         TEXT,
  decision            TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wb_changes_task ON wb_changes(task_id);
