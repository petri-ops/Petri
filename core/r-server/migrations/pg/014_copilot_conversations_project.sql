-- Project-scoped Copilot conversations for Codex-style desktop workbench.

BEGIN;

ALTER TABLE copilot_conversations ADD COLUMN IF NOT EXISTS project_id TEXT;
CREATE INDEX IF NOT EXISTS idx_conv_project
  ON copilot_conversations(user_id, project_id, status, updated_at DESC);

COMMIT;
