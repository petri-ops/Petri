-- PLAN_TOOL_JOB_LINK_v1 (2026-07-05): 让 plan step 能关联 bulk 工具的 tool_job
-- （run_tool 跑出的结果进 tool_jobs 表，不进 analyses，因为 bulk 工具无 dataset）。
-- 平行于 analysis_id（单细胞 session 用），同一 step 表两种关联共存。
-- 见 .claude/agent-led-stage1-plan.md Task 1-2（方案 C）。

BEGIN;

ALTER TABLE copilot_plan_steps ADD COLUMN IF NOT EXISTS tool_job_id TEXT;

CREATE INDEX IF NOT EXISTS idx_plan_steps_tool_job ON copilot_plan_steps(tool_job_id);

COMMIT;
