-- item 87 第二阶段 — 教练循环（migration 027）
--
-- This file is generated from core/shared-backend/do-coaching-schema.js.
-- 品味样本库（好/坏判例对照）+ 教练循环运行态（影子/交接/复盘 + 渐进放权滑移）
-- + 用户能力画像（复盘分歧点，结构化 append-only）。方案 §3/§4/§8。
--
-- Constraints:
-- - No BEGIN/COMMIT: migration-runner already wraps the file in a transaction.
-- - No INSERT OR REPLACE / PRAGMA / AUTOINCREMENT.
-- - Additive only: new tables + indexes, no changes to existing tables.
-- - do_competence_profiles is append-only by contract (no update path in store).

CREATE TABLE IF NOT EXISTS do_sample_libraries (
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
);

CREATE INDEX IF NOT EXISTS idx_do_samples_domain ON do_sample_libraries(domain, dimension);

CREATE TABLE IF NOT EXISTS do_coaching_runs (
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
);

CREATE INDEX IF NOT EXISTS idx_do_runs_goal ON do_coaching_runs(goal_id);

CREATE INDEX IF NOT EXISTS idx_do_runs_user ON do_coaching_runs(user_id, domain);

CREATE TABLE IF NOT EXISTS do_competence_profiles (
  profile_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  user_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  run_id TEXT NOT NULL,
  divergences_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_do_profiles_user ON do_competence_profiles(user_id, domain);
