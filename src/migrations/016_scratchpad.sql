-- BLOCK-246 C13 — scratchpad (migration 016)
--
-- This file is generated from core/shared-backend/scratchpad-schema.js.
-- The scratchpad is a user asset (sidecar store): it never participates in the
-- chat context block. Entries only become context when the user explicitly
-- quotes one, at which point they travel the single ComposerContextItem path.
--
-- Constraints:
-- - No BEGIN/COMMIT: migration-runner already wraps the file in a transaction.
-- - No INSERT OR REPLACE / PRAGMA / AUTOINCREMENT.
-- - Additive only: new table + indexes, no changes to existing tables.

CREATE TABLE IF NOT EXISTS scratchpad_entries (
  entry_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL DEFAULT 'text',
  title TEXT,
  body TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'manual',
  source_ref TEXT,
  project_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scratchpad_created ON scratchpad_entries(created_at);

CREATE INDEX IF NOT EXISTS idx_scratchpad_project ON scratchpad_entries(project_id, created_at);

CREATE INDEX IF NOT EXISTS idx_scratchpad_source ON scratchpad_entries(source_kind, source_ref);
