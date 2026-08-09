'use strict';

/**
 * Durable, explicit consent for attaching a BioF3 project to a user-owned Git
 * repository. A runtime binding records where history is written; it is not
 * evidence that the user authorized the `existing` mode.
 */

const GIT_REPOSITORY_CONSENT_VERSION = 1;
const GIT_REPOSITORY_CONSENT_MIGRATION_VERSION = 4;

const GIT_REPOSITORY_CONSENT_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS git_repository_consents (
  project_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  allow_existing_repository INTEGER NOT NULL CHECK (allow_existing_repository IN (0, 1)),
  decision_source TEXT NOT NULL CHECK (decision_source = 'explicit_api'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
]);

const GIT_REPOSITORY_CONSENT_MIGRATION_HEADER = `-- G0-RS-P7 - explicit consent for user-owned Git repositories (migration 004)
--
-- A git_repository_bindings row describes a runtime binding. It does not prove
-- user authorization. This table is the durable opt-in truth consumed by every
-- production Result Studio Git binding call.`;

function buildGitRepositoryConsentMigrationSql() {
  const body = GIT_REPOSITORY_CONSENT_SCHEMA_STATEMENTS
    .map((statement) => `${statement};`)
    .join('\n\n');
  return `${GIT_REPOSITORY_CONSENT_MIGRATION_HEADER}\n\n${body}\n`;
}

function ensureGitRepositoryConsentSchema(db) {
  if (!db || typeof db.exec !== 'function') throw new Error('git_repository_consent_db_required');
  for (const statement of GIT_REPOSITORY_CONSENT_SCHEMA_STATEMENTS) db.exec(statement);
  return { version: GIT_REPOSITORY_CONSENT_VERSION, table: 'git_repository_consents' };
}

module.exports = {
  GIT_REPOSITORY_CONSENT_VERSION,
  GIT_REPOSITORY_CONSENT_MIGRATION_VERSION,
  GIT_REPOSITORY_CONSENT_SCHEMA_STATEMENTS,
  buildGitRepositoryConsentMigrationSql,
  ensureGitRepositoryConsentSchema,
};
