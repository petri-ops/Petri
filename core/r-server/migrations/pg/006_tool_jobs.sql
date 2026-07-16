-- Tool jobs: deseq2, go-kegg, seurat, ml-classifier, maftools, etc.
-- Source: r-server/routes/tools.js + py-server/r-server-db.js column inventory (2026-06-06)
-- Used by: ECS platform API + Dell worker (both via DATABASE_URL)

BEGIN;

CREATE TABLE IF NOT EXISTS tool_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  params_json TEXT DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at BIGINT NOT NULL,
  name TEXT DEFAULT '',
  is_test_run INTEGER DEFAULT 0,
  is_public INTEGER DEFAULT 0,
  result_json TEXT,
  completed_at BIGINT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_tool_jobs_user ON tool_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_tool_jobs_status ON tool_jobs(status);
CREATE INDEX IF NOT EXISTS idx_tool_jobs_tool_public ON tool_jobs(tool_id, is_public) WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS idx_tool_jobs_created ON tool_jobs(created_at);

COMMIT;
