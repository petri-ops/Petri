-- BLOCK-246 C4 — message ratings (migration 017)
--
-- This file is generated from core/shared-backend/message-rating-schema.js.
-- One row per message (message_key is the primary key): re-rating overwrites,
-- clearing a rating deletes the row. Ratings are model-quality signals, not the
-- human "feedback inbox" (see routes/feedback.js) — keeping them apart avoids
-- rate-limit collisions and notification spam.
--
-- Constraints:
-- - No BEGIN/COMMIT: migration-runner already wraps the file in a transaction.
-- - No INSERT OR REPLACE / PRAGMA / AUTOINCREMENT.
-- - Additive only: new table + indexes, no changes to existing tables.

CREATE TABLE IF NOT EXISTS message_ratings (
  message_key TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  conversation_id TEXT,
  project_id TEXT,
  rating TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_message_ratings_conversation ON message_ratings(conversation_id);

CREATE INDEX IF NOT EXISTS idx_message_ratings_rating ON message_ratings(rating, updated_at);
