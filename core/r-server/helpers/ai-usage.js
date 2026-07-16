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
const sqlite = dbMod.getSqliteForLegacyModules();

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
    error_code TEXT,
    conversation_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ai_usage_user_ts ON ai_usage(user_id, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_ai_usage_ts ON ai_usage(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_ai_usage_kind ON ai_usage(kind, ts DESC);
`);

function recordAiUsage({userId, kind, model, promptTokens, completionTokens, latencyMs, errorCode, conversationId}) {
  try {
    sqlite.prepare(`INSERT INTO ai_usage(user_id, ts, kind, model, prompt_tokens, completion_tokens, latency_ms, error_code, conversation_id)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(
        userId || null,
        new Date().toISOString(),
        kind || 'other',
        model || null,
        promptTokens|0,
        completionTokens|0,
        latencyMs|0,
        errorCode || null,
        conversationId || null,
      );
  } catch (e) {
    console.warn('[ai-usage] insert failed:', e && e.message);
  }
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
  estimateCostCNY,
  AI_PRICING,
};
