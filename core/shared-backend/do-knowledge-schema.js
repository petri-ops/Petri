'use strict';

/**
 * shared-backend/do-knowledge-schema.js
 *
 * item 87 第一阶段 —— 领域知识层 DDL 的**唯一**来源（方案 §8 前缀 do_）。
 *
 * 与 scratchpad-schema.js（016）同形态：DDL 写在 JS，`src/migrations/025_domain_knowledge.sql`
 * 由 buildDoKnowledgeMigrationSql() 生成，并由 `test/item87-do-knowledge.test.mjs` 强制二者
 * **逐字节一致**（改 schema 必须重新生成迁移文件，禁止手改 .sql 造成第二真相）。
 *
 * 不变量：
 * - 只新增表/索引/触发器，不修改任何现有表。
 * - 不用 INSERT OR REPLACE / PRAGMA / AUTOINCREMENT；不含 BEGIN/COMMIT
 *   （migration-runner 已把每个文件包在事务里）。
 * - **append-only**：两张表都有 BEFORE UPDATE/DELETE 触发器 RAISE(ABORT)——
 *   修订只能追加新卡（revision_of 指向旧卡），任何改写/删除在 SQL 层就失败，
 *   不是靠调用方自觉（方案 §8「append-only 修订」+ §12 五件套纪律）。
 * - do_knowledge_cards：结论/证据等级/来源/日期/有效期/版本链（NOT NULL 到位，
 *   字段级业务校验在 do-knowledge-store.js——SQL 层保结构，store 层保语义）。
 * - do_citation_records：DOI 唯一约束——同 DOI 不得二次入库。
 */

const DO_CONTRACT_VERSION = 1;

const DO_KNOWLEDGE_TABLES = Object.freeze(['do_knowledge_cards', 'do_citation_records']);

const DO_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS do_knowledge_cards (
  card_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  domain TEXT NOT NULL,
  topic TEXT NOT NULL,
  conclusion TEXT NOT NULL,
  evidence_level TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_date TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  freshness_class TEXT NOT NULL,
  provenance TEXT,
  revision_of TEXT,
  created_at TEXT NOT NULL
)`,
  'CREATE INDEX IF NOT EXISTS idx_do_cards_domain ON do_knowledge_cards(domain, topic)',
  'CREATE INDEX IF NOT EXISTS idx_do_cards_revision ON do_knowledge_cards(revision_of)',
  `CREATE TABLE IF NOT EXISTS do_citation_records (
  citation_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  doi TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  authors TEXT,
  year INTEGER,
  container TEXT,
  registry TEXT NOT NULL,
  verify_status TEXT NOT NULL,
  verify_detail TEXT,
  created_at TEXT NOT NULL
)`,
  'CREATE INDEX IF NOT EXISTS idx_do_citations_registry ON do_citation_records(registry)',
  `CREATE TRIGGER IF NOT EXISTS do_knowledge_cards_append_only_update
BEFORE UPDATE ON do_knowledge_cards
BEGIN SELECT RAISE(ABORT, 'do_knowledge_cards is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS do_knowledge_cards_append_only_delete
BEFORE DELETE ON do_knowledge_cards
BEGIN SELECT RAISE(ABORT, 'do_knowledge_cards is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS do_citation_records_append_only_update
BEFORE UPDATE ON do_citation_records
BEGIN SELECT RAISE(ABORT, 'do_citation_records is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS do_citation_records_append_only_delete
BEFORE DELETE ON do_citation_records
BEGIN SELECT RAISE(ABORT, 'do_citation_records is append-only'); END`,
]);

const DO_MIGRATION_HEADER = `-- item 87 第一阶段 — 领域知识层（migration 025）
--
-- This file is generated from core/shared-backend/do-knowledge-schema.js.
-- 知识卡片（结论/证据等级/来源/日期/有效期/版本链）与引用记录（DOI/题录/验真），
-- 领域包 2.0 知识层 MVP（方案 do_* §8）。全本地 SQLite，零外发。
--
-- Constraints:
-- - No BEGIN/COMMIT: migration-runner already wraps the file in a transaction.
-- - No INSERT OR REPLACE / PRAGMA / AUTOINCREMENT.
-- - Additive only: new tables + indexes + triggers, no changes to existing tables.
-- - Append-only: UPDATE/DELETE on both tables abort via triggers; revision is
--   append-only via revision_of chain (never rewrite or remove history).`;

function buildDoKnowledgeMigrationSql() {
  const body = DO_SCHEMA_STATEMENTS.map((statement) => `${statement};`).join('\n\n');
  return `${DO_MIGRATION_HEADER}\n\n${body}\n`;
}

function ensureDoKnowledgeSchema(db) {
  db.exec(buildDoKnowledgeMigrationSql());
}

module.exports = {
  DO_CONTRACT_VERSION,
  DO_KNOWLEDGE_TABLES,
  buildDoKnowledgeMigrationSql,
  ensureDoKnowledgeSchema,
};
