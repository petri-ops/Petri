-- Analytics (mirror routes/analytics.js)

BEGIN;

CREATE TABLE IF NOT EXISTS user_heartbeats (
  user_id TEXT PRIMARY KEY,
  last_seen BIGINT NOT NULL,
  page TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_heartbeats_seen ON user_heartbeats(last_seen);

CREATE TABLE IF NOT EXISTS page_views (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  ts BIGINT NOT NULL,
  path TEXT NOT NULL,
  title TEXT,
  referrer TEXT,
  session_id TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_pv_ts ON page_views(ts);
CREATE INDEX IF NOT EXISTS idx_pv_user ON page_views(user_id);
CREATE INDEX IF NOT EXISTS idx_pv_path ON page_views(path);
CREATE INDEX IF NOT EXISTS idx_pv_ip ON page_views(ip);

CREATE TABLE IF NOT EXISTS daily_stats (
  date TEXT PRIMARY KEY,
  dau INTEGER DEFAULT 0,
  new_users INTEGER DEFAULT 0,
  total_users INTEGER DEFAULT 0,
  ai_messages INTEGER DEFAULT 0,
  ai_active_users INTEGER DEFAULT 0,
  page_views INTEGER DEFAULT 0,
  avg_session_pv REAL DEFAULT 0,
  created_at BIGINT NOT NULL
);

COMMIT;