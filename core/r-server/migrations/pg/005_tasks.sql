-- R async task queue (single-cell /api/task) — shared by ECS platform enqueue + Dell workers
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  params TEXT DEFAULT '{}',
  oss_input_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  progress_message TEXT DEFAULT '排队中...',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  results TEXT,
  error TEXT,
  work_dir TEXT,
  container_work_dir TEXT,
  worker_id TEXT,
  claimed_at TIMESTAMPTZ,
  parent_task_id TEXT,
  engine TEXT DEFAULT 'R'
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_pending ON tasks(status, created_at) WHERE status = 'pending';

-- Existing deployments may have created tasks before Python workers shared the
-- queue. CREATE TABLE IF NOT EXISTS will not add later columns, so keep these
-- schema upgrades idempotent.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS engine TEXT DEFAULT 'R';
UPDATE tasks SET engine = 'R' WHERE engine IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_engine_status ON tasks(engine, status);
