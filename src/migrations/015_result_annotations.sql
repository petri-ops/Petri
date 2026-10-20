-- BLOCK-219 Q6 — artifact annotations (migration 015)
--
-- This file is generated from core/shared-backend/result-annotation-schema.js.
-- Annotations are sidecar metadata: they never write back into the original
-- artifact file, and coordinates are always normalized to 0..1 so the same
-- annotation survives zoom/scale changes.
--
-- Constraints:
-- - No BEGIN/COMMIT: migration-runner already wraps the file in a transaction.
-- - No INSERT OR REPLACE / PRAGMA / AUTOINCREMENT.
-- - Additive only: new table + indexes, no changes to existing tables.

CREATE TABLE IF NOT EXISTS result_annotations (
  annotation_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  project_id TEXT NOT NULL,
  conversation_id TEXT,
  surface TEXT NOT NULL,
  artifact_id TEXT,
  revision_id TEXT,
  file_path TEXT,
  artifact_name TEXT,
  kind TEXT NOT NULL DEFAULT 'region',
  page INTEGER,
  rect_json TEXT NOT NULL,
  comment TEXT NOT NULL,
  color TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rs_annotations_project ON result_annotations(project_id);

CREATE INDEX IF NOT EXISTS idx_rs_annotations_artifact ON result_annotations(project_id, artifact_id, revision_id);

CREATE INDEX IF NOT EXISTS idx_rs_annotations_file ON result_annotations(project_id, file_path);
