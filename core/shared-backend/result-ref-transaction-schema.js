'use strict';

const crypto = require('crypto');

const RESULT_REF_TRANSACTION_VERSION = 1;
const RESULT_REF_TRANSACTION_MIGRATION_VERSION = 3;

const RESULT_REF_TRANSACTION_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS result_ref_transactions (
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
)`,
  'CREATE INDEX IF NOT EXISTS idx_rs_ref_transactions_project_state ON result_ref_transactions(project_id, state)',
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_rs_ref_transactions_active_project
ON result_ref_transactions(project_id)
WHERE state IN ('prepared', 'refs_applied')`,
]);

const RESULT_REF_TRANSACTION_MIGRATION_HEADER = `-- G0-RS-P6 - durable Git ref and SQLite transition journal (migration 003)
--
-- This file is generated from core/shared-backend/result-ref-transaction-schema.js.
-- It records the exact compare-and-swap ref cohort and final SQLite checkpoint
-- so an owned-process crash can deterministically resume the transition.`;

function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalStringify(value[key])}`
  )).join(',')}}`;
}

function computeResultRefTransactionHash(intent = {}) {
  const immutableIntent = {
    contractVersion: intent.contractVersion,
    operationId: intent.operationId,
    projectId: intent.projectId,
    changeSetId: intent.changeSetId,
    operationKind: intent.operationKind,
    sourceStatus: intent.sourceStatus,
    targetStatus: intent.targetStatus,
    refUpdates: intent.refUpdates,
    targetRevisionIds: intent.targetRevisionIds,
    checkpoint: intent.checkpoint,
    ownerLease: intent.ownerLease,
    statusReason: intent.statusReason ?? null,
    createdAt: intent.createdAt,
  };
  return crypto.createHash('sha256').update(canonicalStringify(immutableIntent)).digest('hex');
}

function buildResultRefTransactionMigrationSql() {
  const body = RESULT_REF_TRANSACTION_SCHEMA_STATEMENTS
    .map((statement) => `${statement};`)
    .join('\n\n');
  return `${RESULT_REF_TRANSACTION_MIGRATION_HEADER}\n\n${body}\n`;
}

function ensureResultRefTransactionSchema(db) {
  if (!db || typeof db.exec !== 'function') throw new Error('result_ref_transaction_db_required');
  for (const statement of RESULT_REF_TRANSACTION_SCHEMA_STATEMENTS) db.exec(statement);
  return { version: RESULT_REF_TRANSACTION_VERSION, table: 'result_ref_transactions' };
}

module.exports = {
  RESULT_REF_TRANSACTION_VERSION,
  RESULT_REF_TRANSACTION_MIGRATION_VERSION,
  RESULT_REF_TRANSACTION_SCHEMA_STATEMENTS,
  buildResultRefTransactionMigrationSql,
  computeResultRefTransactionHash,
  ensureResultRefTransactionSchema,
};
