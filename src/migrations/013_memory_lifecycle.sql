-- BLOCK-182-MEMORY-LIFECYCLE — 记忆生命周期治理（additive：memory_audit 审计表）。
-- 设计裁决（用户预授权）：纠错免费、（模型通道）记忆写入过审批门；细节见 docs/block-182-memory-lifecycle-plan.md。
-- user_facts 生命周期三列（status/superseded_by/last_confirmed_at）不在此处 ALTER——
-- user_facts 是运行时懒建表（helpers/user-facts.js _ensureTable），全新库在迁移时点尚不存在；
-- 列升级由 helpers/memory-lifecycle.js ensureLifecycleColumns 以 try/catch 幂等兜底（ai-admin project_id 先例）。

CREATE TABLE IF NOT EXISTS memory_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  actor       TEXT NOT NULL DEFAULT 'system',
  action      TEXT NOT NULL,
  fact_id     TEXT,
  detail_json TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_audit_user ON memory_audit(user_id, created_at DESC);
