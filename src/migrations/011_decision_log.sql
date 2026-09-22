-- BLOCK-116-DECISION-PLATFORM W2 — 决策台账（additive：新表；决策原语每次调用的可回放记录）。
-- 记账咽喉=helpers/decision-api.js askDecision 的 optional meta（{point, threshold}）：
-- 提供 meta.point 才记账，缺省零行为；记账 best-effort，永不影响决策结果。
-- 对齐 ai_usage 先例（additive 观测表）；弧线 §W2「任何一次路由可回放『当时为什么这么判』」。

CREATE TABLE IF NOT EXISTS decision_log (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  at                 TEXT NOT NULL,
  point              TEXT NOT NULL,
  state_hash         TEXT NOT NULL,
  state_preview      TEXT,
  choice             TEXT,
  confidence         REAL,
  threshold          REAL,
  degraded           INTEGER NOT NULL DEFAULT 0,
  reason             TEXT,
  model              TEXT,
  latency_ms         INTEGER,
  probabilities_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_decision_log_point_at ON decision_log(point, at);
