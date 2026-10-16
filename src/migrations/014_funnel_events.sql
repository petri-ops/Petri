-- BLOCK-186-FUNNEL-LEDGER P1 — 本地漏斗事件台账（additive：新表；TTFS 程序②）。
-- G0 定性：评估报告「遥测端点化」字面隐含远程端点属 G1+（AGENTS.md 禁 G0 启动），
-- 本表按 G0 唯一合法形态落地=本机漏斗事件记录（零外发，仿 decision_log additive 观测表先例）。
-- 记账咽喉=helpers/funnel-log.js recordFunnelEvent(name)：白名单 6 事件才记，best-effort 永不影响业务。
-- 独立于远程 telemetry_enabled 开关——本机常开记录（用户可查可删，本地可审计）。

CREATE TABLE IF NOT EXISTS funnel_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL,
  event     TEXT NOT NULL,
  user_id   TEXT
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_event_at ON funnel_events(event, at);
