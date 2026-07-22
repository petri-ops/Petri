/**
 * helpers/ai-usage.js — AI_USAGE_v1 (telemetry: tokens / latency / errors)
 *
 * Extracted from server.js. Pure module: depends only on ../db.
 *
 * Public API:
 *   recordAiUsage({userId, kind, model, promptTokens, completionTokens, latencyMs, errorCode, conversationId})
 *   estimateCostCNY(model, promptTokens, completionTokens) → number (¥)
 *   AI_PRICING        — exported pricing table (¥ per 1M tokens)
 */

const dbMod = require('../db');
const sqlite = dbMod.getDatabase();

// One-time table create (idempotent)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    ts TEXT NOT NULL,
    kind TEXT NOT NULL,
    model TEXT,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    latency_ms INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0,
    cache_creation_tokens INTEGER DEFAULT 0,
    cost_cny REAL,
    cost_status TEXT DEFAULT 'unknown',
    error_code TEXT,
    conversation_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ai_usage_user_ts ON ai_usage(user_id, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_ai_usage_ts ON ai_usage(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_ai_usage_kind ON ai_usage(kind, ts DESC);
`);
for (const statement of [
  'ALTER TABLE ai_usage ADD COLUMN cache_read_tokens INTEGER DEFAULT 0',
  'ALTER TABLE ai_usage ADD COLUMN cache_creation_tokens INTEGER DEFAULT 0',
  'ALTER TABLE ai_usage ADD COLUMN cost_cny REAL',
  "ALTER TABLE ai_usage ADD COLUMN cost_status TEXT DEFAULT 'unknown'",
]) {
  try { sqlite.exec(statement); } catch (_) { /* already migrated */ }
}

function recordAiUsage({userId, kind, model, promptTokens, completionTokens, cacheReadTokens, cacheCreationTokens, latencyMs, errorCode, conversationId, costCny, costStatus}) {
  try {
    const normalizedCost = Number.isFinite(Number(costCny)) ? Number(costCny) : null;
    sqlite.prepare(`INSERT INTO ai_usage(user_id, ts, kind, model, prompt_tokens, completion_tokens, latency_ms, cache_read_tokens, cache_creation_tokens, cost_cny, cost_status, error_code, conversation_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        userId || null,
        new Date().toISOString(),
        kind || 'other',
        model || null,
        promptTokens|0,
        completionTokens|0,
        latencyMs|0,
        cacheReadTokens|0,
        cacheCreationTokens|0,
        normalizedCost,
        costStatus || (normalizedCost == null ? 'unknown' : 'estimated'),
        errorCode || null,
        conversationId || null,
      );
  } catch (e) {
    console.warn('[ai-usage] insert failed:', e && e.message);
  }
}

function summarizeAiUsage({ userId = null, since = null } = {}) {
  const clauses = [];
  const params = [];
  if (userId) { clauses.push('user_id = ?'); params.push(userId); }
  if (since) { clauses.push('ts >= ?'); params.push(since); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const row = sqlite.prepare(`SELECT COUNT(*) AS calls,
    COALESCE(SUM(prompt_tokens),0) AS inputTokens,
    COALESCE(SUM(completion_tokens),0) AS outputTokens,
    COALESCE(SUM(cache_read_tokens),0) AS cacheReadTokens,
    COALESCE(SUM(cache_creation_tokens),0) AS cacheCreationTokens,
    COALESCE(SUM(cost_cny),0) AS estimatedCostCny,
    SUM(CASE WHEN cost_status = 'unknown' THEN 1 ELSE 0 END) AS unknownCostCalls,
    SUM(CASE WHEN error_code IS NOT NULL THEN 1 ELSE 0 END) AS failedCalls
    FROM ai_usage ${where}`).get(...params);
  return { ...row, cacheHitRate: row.inputTokens > 0 ? row.cacheReadTokens / row.inputTokens : 0, costStatus: row.unknownCostCalls > 0 ? 'partial' : 'estimated' };
}

// Pricing in CNY per 1M tokens.
const AI_PRICING = {
  'deepseek-chat':           {input: 0.5, output: 8.0,  cacheHit: 0.1},
  'deepseek-reasoner':       {input: 0.5, output: 8.0,  cacheHit: 0.1},
  'text-embedding-v3':       {input: 0.7, output: 0.0},
};

function estimateCostCNY(model, promptTokens, completionTokens) {
  const p = AI_PRICING[model] || {input: 0.5, output: 8.0};
  const cost = (promptTokens / 1e6) * p.input + (completionTokens / 1e6) * (p.output || 0);
  return Math.round(cost * 1e6) / 1e6;
}

module.exports = {
  recordAiUsage,
  summarizeAiUsage,
  estimateCostCNY,
  AI_PRICING,
};
