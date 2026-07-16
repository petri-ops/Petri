BEGIN;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
UPDATE projects SET status = 'active' WHERE status IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status, updated_at DESC);

COMMIT;
