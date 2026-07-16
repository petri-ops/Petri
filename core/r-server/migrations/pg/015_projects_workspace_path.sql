-- Project-scoped local workspace root for Codex-style desktop workbench.

BEGIN;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_path TEXT;
CREATE INDEX IF NOT EXISTS idx_projects_workspace_path
  ON projects(workspace_path);

COMMIT;
