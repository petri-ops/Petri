-- User feedback (routes/feedback.js)

BEGIN;

CREATE TABLE IF NOT EXISTS feedbacks (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  username TEXT,
  category TEXT DEFAULT 'other',
  content TEXT NOT NULL,
  page_url TEXT,
  user_agent TEXT,
  ip TEXT,
  status TEXT DEFAULT 'new',
  admin_notes TEXT,
  created_at BIGINT NOT NULL,
  resolved_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_feedbacks_status ON feedbacks(status);
CREATE INDEX IF NOT EXISTS idx_feedbacks_created ON feedbacks(created_at);
CREATE INDEX IF NOT EXISTS idx_feedbacks_user ON feedbacks(user_id);

COMMIT;