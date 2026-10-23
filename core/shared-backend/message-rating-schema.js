'use strict';

/**
 * shared-backend/message-rating-schema.js
 *
 * BLOCK-246 C4 —— 消息评价（赞/踩）DDL 的**唯一**来源。
 *
 * 为什么独立成表而不是复用 `feedbacks`：反馈表是"给人看的意见箱"（最短 5 字、
 * 有频率限制、会推送通知），逐条回复的赞/踩是"给模型的信号"（短、可覆盖、高频、
 * 不该刷通知）。两种事实混一张表会让两边都变差。
 *
 * 不变量：
 * - 只新增表与索引，不改现有表。
 * - 一条消息一条评价（message_key 主键），重复评价 = 覆盖（toggle 为 null 即删除）。
 * - `src/migrations/017_message_ratings.sql` 由 build 函数生成并逐字节一致。
 */

const MESSAGE_RATING_MIGRATION_VERSION = 17;
const MESSAGE_RATING_CONTRACT_VERSION = 1;

const MESSAGE_RATING_TABLES = Object.freeze(['message_ratings']);

const MESSAGE_RATING_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS message_ratings (
  message_key TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  conversation_id TEXT,
  project_id TEXT,
  rating TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
  'CREATE INDEX IF NOT EXISTS idx_message_ratings_conversation ON message_ratings(conversation_id)',
  'CREATE INDEX IF NOT EXISTS idx_message_ratings_rating ON message_ratings(rating, updated_at)',
]);

const MESSAGE_RATING_MIGRATION_HEADER = `-- BLOCK-246 C4 — message ratings (migration 017)
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
-- - Additive only: new table + indexes, no changes to existing tables.`;

function buildMessageRatingMigrationSql() {
  const body = MESSAGE_RATING_SCHEMA_STATEMENTS.map((statement) => `${statement};`).join('\n\n');
  return `${MESSAGE_RATING_MIGRATION_HEADER}\n\n${body}\n`;
}

function ensureMessageRatingSchema(db) {
  if (!db || typeof db.exec !== 'function') {
    throw new Error('[message-rating-schema] db instance with exec() is required');
  }
  for (const statement of MESSAGE_RATING_SCHEMA_STATEMENTS) db.exec(`${statement};`);
  return { tables: [...MESSAGE_RATING_TABLES], contractVersion: MESSAGE_RATING_CONTRACT_VERSION };
}

function inspectMessageRatingSchema(db) {
  const present = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
  );
  const tables = MESSAGE_RATING_TABLES.filter((name) => present.has(name));
  return {
    tables,
    missing: MESSAGE_RATING_TABLES.filter((name) => !present.has(name)),
    complete: tables.length === MESSAGE_RATING_TABLES.length,
  };
}

module.exports = {
  MESSAGE_RATING_MIGRATION_VERSION,
  MESSAGE_RATING_CONTRACT_VERSION,
  MESSAGE_RATING_TABLES,
  MESSAGE_RATING_SCHEMA_STATEMENTS,
  buildMessageRatingMigrationSql,
  ensureMessageRatingSchema,
  inspectMessageRatingSchema,
};
