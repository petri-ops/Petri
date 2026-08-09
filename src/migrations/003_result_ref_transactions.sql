-- G0-RS-P6 - durable Git ref and SQLite transition journal (migration 003)
--
-- This file is generated from core/shared-backend/result-ref-transaction-schema.js.
-- It records the exact compare-and-swap ref cohort and final SQLite checkpoint
-- so an owned-process crash can deterministically resume the transition.

CREATE TABLE IF NOT EXISTS result_ref_transactions (
  operation_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  project_id TEXT NOT NULL,
  change_set_id TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  state TEXT NOT NULL,
  source_status TEXT NOT NULL,
  target_status TEXT NOT NULL,
  ref_updates_json TEXT NOT NULL,
  target_revision_ids_json TEXT NOT NULL DEFAULT '[]',
  checkpoint_json TEXT NOT NULL,
  owner_lease_json TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  status_reason TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_rs_ref_transactions_project_state ON result_ref_transactions(project_id, state);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rs_ref_transactions_active_project
ON result_ref_transactions(project_id)
WHERE state IN ('prepared', 'refs_applied');
