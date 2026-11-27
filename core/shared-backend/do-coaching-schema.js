'use strict';

/**
 * shared-backend/do-coaching-schema.js
 *
 * item 87 第二阶段 —— 教练循环 DDL 唯一来源（方案 §3 四阶段 + §8 补齐剩余两表）。
 *
 * 与 do-knowledge-schema.js（025）同形态：DDL 写在 JS，`src/migrations/027_do_coaching.sql`
 * 由 buildDoCoachingMigrationSql() 生成，并由 `test/item87-coaching.test.mjs` 强制二者
 * **逐字节一致**（改 schema 必须重新生成迁移文件，禁止手改 .sql 造成第二真相）。
 *
 * 三表：
 * - do_sample_libraries：品味样本库（§4 专家评审样本：维度/好判例/坏判例/理由/来源/版本）
 *   —— 87 第一阶段草稿（resources/domain-onboarding/petri-pack-bio/taste-samples.md）
 *      定稿后经 seedBioTasteSamples 结构化入库。
 * - do_coaching_runs：教练循环 engaging 记录（影子/交接/复盘阶段 + 渐进放权滑移状态）；
 *   决策讲解与状态变更走 task_events（append-only，可回放），本表只存当前态。
 * - do_competence_profiles：用户能力画像（复盘分歧点清单，结构化 JSON，append-only）。
 *
 * 不变量：
 * - 只新增表与索引，不改现有表；不用 INSERT OR REPLACE / PRAGMA / AUTOINCREMENT；
 *   不含 BEGIN/COMMIT（migration-runner 已包事务）。
 * - do_competence_profiles append-only（无 UPDATE 路径；store 不提供改写）。
 */

const DO_COACHING_CONTRACT_VERSION = 1;

const DO_COACHING_TABLES = Object.freeze([
  'do_sample_libraries',
  'do_coaching_runs',
  'do_competence_profiles',
]);

const DO_COACHING_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS do_sample_libraries (
  sample_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  domain TEXT NOT NULL,
  dimension TEXT NOT NULL,
  good_json TEXT NOT NULL,
  bad_json TEXT NOT NULL,
  rationale TEXT NOT NULL,
  source_ref TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL
)`,
  'CREATE INDEX IF NOT EXISTS idx_do_samples_domain ON do_sample_libraries(domain, dimension)',
  `CREATE TABLE IF NOT EXISTS do_coaching_runs (
  run_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  goal_id TEXT NOT NULL,
  task_id TEXT,
  domain TEXT NOT NULL,
  user_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  handover_ratio REAL NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  decision_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
  'CREATE INDEX IF NOT EXISTS idx_do_runs_goal ON do_coaching_runs(goal_id)',
  'CREATE INDEX IF NOT EXISTS idx_do_runs_user ON do_coaching_runs(user_id, domain)',
  `CREATE TABLE IF NOT EXISTS do_competence_profiles (
  profile_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  user_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  run_id TEXT NOT NULL,
  divergences_json TEXT NOT NULL,
  created_at TEXT NOT NULL
)`,
  'CREATE INDEX IF NOT EXISTS idx_do_profiles_user ON do_competence_profiles(user_id, domain)',
]);

const DO_COACHING_MIGRATION_HEADER = `-- item 87 第二阶段 — 教练循环（migration 027）
--
-- This file is generated from core/shared-backend/do-coaching-schema.js.
-- 品味样本库（好/坏判例对照）+ 教练循环运行态（影子/交接/复盘 + 渐进放权滑移）
-- + 用户能力画像（复盘分歧点，结构化 append-only）。方案 §3/§4/§8。
--
-- Constraints:
-- - No BEGIN/COMMIT: migration-runner already wraps the file in a transaction.
-- - No INSERT OR REPLACE / PRAGMA / AUTOINCREMENT.
-- - Additive only: new tables + indexes, no changes to existing tables.
-- - do_competence_profiles is append-only by contract (no update path in store).`;

function buildDoCoachingMigrationSql() {
  const body = DO_COACHING_SCHEMA_STATEMENTS.map((statement) => `${statement};`).join('\n\n');
  return `${DO_COACHING_MIGRATION_HEADER}\n\n${body}\n`;
}

function ensureDoCoachingSchema(db) {
  db.exec(buildDoCoachingMigrationSql());
}

module.exports = {
  DO_COACHING_CONTRACT_VERSION,
  DO_COACHING_TABLES,
  DO_COACHING_SCHEMA_STATEMENTS,
  buildDoCoachingMigrationSql,
  ensureDoCoachingSchema,
};
