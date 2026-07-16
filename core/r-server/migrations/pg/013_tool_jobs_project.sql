-- 7.3 (2026-07-08): project-scoped tool jobs for activity timeline.
-- Links tool_jobs to projects so the desktop UI can list per-project job history.

BEGIN;

ALTER TABLE tool_jobs ADD COLUMN IF NOT EXISTS project_id TEXT;
CREATE INDEX IF NOT EXISTS idx_tool_jobs_project ON tool_jobs(project_id) WHERE project_id IS NOT NULL;

COMMIT;
