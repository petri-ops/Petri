'use strict';

/**
 * shared-backend/scratchpad-schema.js
 *
 * BLOCK-246 C13 —— 速记板（scratchpad）DDL 的**唯一**来源。
 *
 * 与 result-annotation-schema.js（015）/ result-studio-schema.js（001）同形态：
 * DDL 写在 JS，`src/migrations/016_scratchpad.sql` 由 build 函数生成，并由
 * `test/block246-scratchpad.test.mjs` 强制二者**逐字节一致**（改 schema 必须重新生成
 * 迁移文件，禁止手改 .sql 造成第二真相）。
 *
 * 不变量：
 * - 只新增表与索引，不修改任何现有表。
 * - 不用 INSERT OR REPLACE / PRAGMA / AUTOINCREMENT；不含 BEGIN/COMMIT
 *   （migration-runner 已把每个文件包在事务里）。
 * - 速记板是**用户资产**（旁路表），不是会话上下文真源：它不参与上行引用块组装，
 *   只有用户显式「引用」时才转成 ComposerContextItem。
 */

const SCRATCHPAD_MIGRATION_VERSION = 16;
const SCRATCHPAD_CONTRACT_VERSION = 1;

const SCRATCHPAD_TABLES = Object.freeze(['scratchpad_entries']);

const SCRATCHPAD_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS scratchpad_entries (
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
)`,
  'CREATE INDEX IF NOT EXISTS idx_scratchpad_created ON scratchpad_entries(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_scratchpad_project ON scratchpad_entries(project_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_scratchpad_source ON scratchpad_entries(source_kind, source_ref)',
]);

const SCRATCHPAD_MIGRATION_HEADER = `-- BLOCK-246 C13 — scratchpad (migration 016)
--
-- This file is generated from core/shared-backend/scratchpad-schema.js.
-- The scratchpad is a user asset (sidecar store): it never participates in the
-- chat context block. Entries only become context when the user explicitly
-- quotes one, at which point they travel the single ComposerContextItem path.
--
-- Constraints:
-- - No BEGIN/COMMIT: migration-runner already wraps the file in a transaction.
-- - No INSERT OR REPLACE / PRAGMA / AUTOINCREMENT.
-- - Additive only: new table + indexes, no changes to existing tables.`;

function buildScratchpadMigrationSql() {
  const body = SCRATCHPAD_SCHEMA_STATEMENTS.map((statement) => `${statement};`).join('\n\n');
  return `${SCRATCHPAD_MIGRATION_HEADER}\n\n${body}\n`;
}

/**
 * 幂等建表（路由/测试可直接调用；正常路径由 migration-runner 应用 016）。
 * @param {object} db better-sqlite3 实例
 */
function ensureScratchpadSchema(db) {
  if (!db || typeof db.exec !== 'function') {
    throw new Error('[scratchpad-schema] db instance with exec() is required');
  }
  for (const statement of SCRATCHPAD_SCHEMA_STATEMENTS) {
    db.exec(`${statement};`);
  }
  return { tables: [...SCRATCHPAD_TABLES], contractVersion: SCRATCHPAD_CONTRACT_VERSION };
}

/**
 * 结构体检（测试与诊断用）：表齐全才算 complete。
 * @param {object} db
 */
function inspectScratchpadSchema(db) {
  const present = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name)
  );
  const tables = SCRATCHPAD_TABLES.filter((name) => present.has(name));
  return {
    tables,
    missing: SCRATCHPAD_TABLES.filter((name) => !present.has(name)),
    complete: tables.length === SCRATCHPAD_TABLES.length,
    contractVersion: SCRATCHPAD_CONTRACT_VERSION,
  };
}

module.exports = {
  SCRATCHPAD_MIGRATION_VERSION,
  SCRATCHPAD_CONTRACT_VERSION,
  SCRATCHPAD_TABLES,
  SCRATCHPAD_SCHEMA_STATEMENTS,
  buildScratchpadMigrationSql,
  ensureScratchpadSchema,
  inspectScratchpadSchema,
};
