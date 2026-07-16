-- TOOL_JOB_APPROVAL_v1 (2026-07-05): 重操作 run_tool 强制确认。
-- agent-led 阶段2 Task3：tool_run_tool 对 HEAVY_TOOLS（deseq2/wgcna/ml-* 等）跑前
-- 落 ack_status='pending' + ack_token，前端确认卡 ack 后才续跑。5min 超时取消。
-- 见 .claude/plans/validated-soaring-eich.md Task 3。

BEGIN;

ALTER TABLE tool_jobs ADD COLUMN IF NOT EXISTS ack_token TEXT;
ALTER TABLE tool_jobs ADD COLUMN IF NOT EXISTS ack_status TEXT;
ALTER TABLE tool_jobs ADD COLUMN IF NOT EXISTS ack_expires_at BIGINT;

CREATE INDEX IF NOT EXISTS idx_tool_jobs_ack_token ON tool_jobs(ack_token) WHERE ack_token IS NOT NULL;

COMMIT;
