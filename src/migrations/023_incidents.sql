-- EVO-0 — Harness 自进化本地 incident 记录表（additive：新表）。
-- G0 定性：这是「用户机器上运行的 harness 自己观测自身失败」的本地台账，
-- 零外发、用户可查可删（仿 014_funnel_events 本机常开记录先例）。
-- 记账咽喉=后续 EVO-1 的 recordIncident()（白名单来源 + best-effort 落库，永不影响 agent 主链）。
-- 脱敏纪律：normalized 只存 normalizeIncidentFingerprint() 的脱敏输出，raw 错误文本不落盘。
-- 隐私：conversation_id 存哈希后的值，TTL 与 wipe 由上层工具提供。

CREATE TABLE IF NOT EXISTS incidents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint     TEXT NOT NULL,
  source          TEXT NOT NULL,
  error_code      TEXT,
  tool            TEXT,
  phase           TEXT,
  normalized      TEXT NOT NULL,
  conversation_id TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_incidents_fingerprint ON incidents(fingerprint, created_at);
