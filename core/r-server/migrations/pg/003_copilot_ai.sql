-- Copilot conversations, plans, memory, usage, audit

BEGIN;

CREATE TABLE IF NOT EXISTS copilot_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '新对话',
  status TEXT NOT NULL DEFAULT 'active',
  last_page TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_topic_shift_at TIMESTAMPTZ,
  last_topic_shift_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_conv_user ON copilot_conversations(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS copilot_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  meta_json TEXT,
  ts TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conv_ts ON copilot_messages(conversation_id, ts ASC);

CREATE TABLE IF NOT EXISTS copilot_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  goal TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  chat_context_excerpt TEXT
);
CREATE INDEX IF NOT EXISTS idx_copilot_plans_user ON copilot_plans(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS copilot_plan_steps (
  plan_id TEXT NOT NULL REFERENCES copilot_plans(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  title TEXT NOT NULL,
  hint TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  ts TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (plan_id, n)
);

CREATE TABLE IF NOT EXISTS user_facts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL DEFAULT 'auto',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_facts_user ON user_facts(user_id, pinned DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_summaries (
  user_id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  msg_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_vectors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref_id TEXT,
  page TEXT,
  page_title TEXT,
  content TEXT NOT NULL,
  embedding BYTEA NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  conversation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_memvec_user ON memory_vectors(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_memvec_user_kind ON memory_vectors(user_id, kind);

CREATE TABLE IF NOT EXISTS chat_audit (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  page TEXT,
  msg_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chat_audit_user ON chat_audit(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_chat_audit_ts ON chat_audit(ts DESC);

CREATE TABLE IF NOT EXISTS ai_usage (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  ts TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL,
  model TEXT,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  error_code TEXT,
  conversation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_ts ON ai_usage(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_ts ON ai_usage(ts DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_kind ON ai_usage(kind, ts DESC);

CREATE TABLE IF NOT EXISTS agent_audit (
  id BIGSERIAL PRIMARY KEY,
  undo_token TEXT UNIQUE,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  args TEXT,
  result TEXT,
  ts TIMESTAMPTZ NOT NULL,
  undone BOOLEAN NOT NULL DEFAULT FALSE,
  undone_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_audit_user_ts ON agent_audit(user_id, ts DESC);

CREATE TABLE IF NOT EXISTS copilot_settings (
  user_id TEXT PRIMARY KEY,
  agent_paused BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS user_progress (
  user_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, resource)
);
CREATE INDEX IF NOT EXISTS idx_user_progress_user_updated ON user_progress(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS review_queue (
  user_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  concept TEXT NOT NULL,
  signal TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  retired_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, resource, concept)
);
CREATE INDEX IF NOT EXISTS idx_review_user_signal ON review_queue(user_id, signal, retired_at, updated_at DESC);

COMMIT;