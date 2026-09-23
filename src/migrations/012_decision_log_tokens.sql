-- BLOCK-118 加映 1 — 决策台账增 input_tokens（additive 可空列；每次调用的 token 用量逐条可查）。
-- 用量取自决策 API 响应 usage.input_tokens（本地供给/降级行/缺 usage 时为 NULL）。
ALTER TABLE decision_log ADD COLUMN input_tokens INTEGER;
