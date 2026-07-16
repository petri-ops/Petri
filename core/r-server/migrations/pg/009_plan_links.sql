-- Phase B residue (2026-06-07): columns added by helpers/plans.js via SQLite-only
-- `ALTER TABLE ... ADD COLUMN` (the PG shim skips DDL), so they were never created
-- in PG. Without them, getActivePlanForUser / syncPlanStepStatusFromAnalysis error
-- ("column conversation_id does not exist") and the agent's plan features break.

BEGIN;

ALTER TABLE copilot_plans      ADD COLUMN IF NOT EXISTS conversation_id TEXT;
ALTER TABLE copilot_plan_steps ADD COLUMN IF NOT EXISTS analysis_id TEXT;

CREATE INDEX IF NOT EXISTS idx_plan_steps_analysis ON copilot_plan_steps(analysis_id);

COMMIT;
