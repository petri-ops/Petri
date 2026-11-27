-- item 87 第一阶段 — 领域知识层（migration 025）
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
--   append-only via revision_of chain (never rewrite or remove history).

CREATE TABLE IF NOT EXISTS do_knowledge_cards (
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
);

CREATE INDEX IF NOT EXISTS idx_do_cards_domain ON do_knowledge_cards(domain, topic);

CREATE INDEX IF NOT EXISTS idx_do_cards_revision ON do_knowledge_cards(revision_of);

CREATE TABLE IF NOT EXISTS do_citation_records (
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
);

CREATE INDEX IF NOT EXISTS idx_do_citations_registry ON do_citation_records(registry);

CREATE TRIGGER IF NOT EXISTS do_knowledge_cards_append_only_update
BEFORE UPDATE ON do_knowledge_cards
BEGIN SELECT RAISE(ABORT, 'do_knowledge_cards is append-only'); END;

CREATE TRIGGER IF NOT EXISTS do_knowledge_cards_append_only_delete
BEFORE DELETE ON do_knowledge_cards
BEGIN SELECT RAISE(ABORT, 'do_knowledge_cards is append-only'); END;

CREATE TRIGGER IF NOT EXISTS do_citation_records_append_only_update
BEFORE UPDATE ON do_citation_records
BEGIN SELECT RAISE(ABORT, 'do_citation_records is append-only'); END;

CREATE TRIGGER IF NOT EXISTS do_citation_records_append_only_delete
BEFORE DELETE ON do_citation_records
BEGIN SELECT RAISE(ABORT, 'do_citation_records is append-only'); END;
