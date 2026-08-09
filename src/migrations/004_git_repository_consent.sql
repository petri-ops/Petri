-- G0-RS-P7 - explicit consent for user-owned Git repositories (migration 004)
--
-- A git_repository_bindings row describes a runtime binding. It does not prove
-- user authorization. This table is the durable opt-in truth consumed by every
-- production Result Studio Git binding call.

CREATE TABLE IF NOT EXISTS git_repository_consents (
  project_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  allow_existing_repository INTEGER NOT NULL CHECK (allow_existing_repository IN (0, 1)),
  decision_source TEXT NOT NULL CHECK (decision_source = 'explicit_api'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
