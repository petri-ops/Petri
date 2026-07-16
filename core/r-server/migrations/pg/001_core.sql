-- BioF3 core schema (PostgreSQL)
-- Mirror of r-server/db.js as of 2026-06-04

BEGIN;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  is_public BOOLEAN DEFAULT FALSE,
  user_id TEXT,
  modality TEXT DEFAULT 'single-cell',
  status TEXT DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_projects_modality ON projects(modality);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  oss_url TEXT NOT NULL,
  size BIGINT DEFAULT 0,
  description TEXT DEFAULT '',
  n_cells INTEGER,
  n_genes INTEGER,
  uploaded_at TIMESTAMPTZ NOT NULL,
  meta_url TEXT,
  features_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_datasets_project ON datasets(project_id);

CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  task_id TEXT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_analysis_id TEXT,
  params TEXT DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  summary TEXT,
  error TEXT,
  results TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_analyses_dataset ON analyses(dataset_id);
CREATE INDEX IF NOT EXISTS idx_analyses_task ON analyses(task_id);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  quota_mb INTEGER DEFAULT 500,
  enabled BOOLEAN DEFAULT TRUE,
  permissions TEXT,
  max_analyses_month INTEGER
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subsets (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  cell_ids TEXT NOT NULL,
  n_cells INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subsets_dataset ON subsets(dataset_id);

CREATE TABLE IF NOT EXISTS cell_labels (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  label_name TEXT NOT NULL,
  label_value TEXT NOT NULL,
  cell_ids TEXT NOT NULL,
  n_cells INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cell_labels_dataset ON cell_labels(dataset_id);

COMMIT;

COMMIT;

COMMIT;
