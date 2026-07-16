-- Phase B residue (2026-06-07):
--   1) copilot_global_settings — agent kill-switch state (helpers/admin-gov.js).
--      Was SQLite-only; missing in PG so the global pause was split-brain.
--   2) datasets.parent_dataset_id — exists in live SQLite (runtime ALTER) but was
--      never added to PG. helpers/site-snapshot.js SELECTs it; without it the AI
--      site snapshot query errors under PG and silently returns null (AI loses
--      user project/dataset/analysis context).

BEGIN;

CREATE TABLE IF NOT EXISTS copilot_global_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

ALTER TABLE datasets ADD COLUMN IF NOT EXISTS parent_dataset_id TEXT;

COMMIT;
