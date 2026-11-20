-- EVO-2 — Harness 自进化 lesson 结构化真源（与 .petri/LEARNINGS.md 双写；MD 为 prompt 投影）。
-- G0 定性：本机 lesson 台账，零外发、用户可查可删（与 014_funnel_events / 023_incidents 同族）。
-- 去重键 source_fingerprint：同一 fingerprint 反复 distill 走 ON CONFLICT 更新，不重复插入。
-- scope 与 harness-redline tier 对齐：auto（提示注入）/ ack（策略待裁决）/ draft（skill 草案）。
-- 遵 migrations/README：不用 AUTOINCREMENT / BEGIN / PRAGMA / INSERT OR REPLACE。

CREATE TABLE IF NOT EXISTS lessons (
  id                  INTEGER PRIMARY KEY,
  source_fingerprint  TEXT NOT NULL,
  title               TEXT NOT NULL,
  action              TEXT NOT NULL,
  scope               TEXT NOT NULL,
  confidence          REAL NOT NULL DEFAULT 0,
  evidence            TEXT,
  status              TEXT NOT NULL DEFAULT 'active',
  created_at          TEXT NOT NULL,
  last_seen_at        TEXT NOT NULL,
  occurrences_before  INTEGER NOT NULL DEFAULT 0,
  occurrences_after   INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lessons_fingerprint ON lessons(source_fingerprint);
CREATE INDEX IF NOT EXISTS idx_lessons_status_scope ON lessons(status, scope);
