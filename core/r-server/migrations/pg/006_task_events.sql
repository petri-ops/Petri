-- 006_task_events.sql — agent loop 解放（P2-b 阶段 1）
-- agent task 事件流：订阅端点按 seq 回放，支持断线重连
-- tasks 表加 user_id（订阅鉴权）+ agent_status（agent task 独立状态机）

CREATE TABLE IF NOT EXISTS task_events (
  id BIGSERIAL PRIMARY KEY,
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_events_task_seq ON task_events(task_id, seq);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS agent_status TEXT;
