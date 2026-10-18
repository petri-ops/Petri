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
  CREATE INDEX IF NOT EXISTS idx_ai_usage_conv ON ai_usage(conversation_id);
`);
for (const statement of [
  'ALTER TABLE ai_usage ADD COLUMN cache_read_tokens INTEGER DEFAULT 0',
  'ALTER TABLE ai_usage ADD COLUMN cache_creation_tokens INTEGER DEFAULT 0',
  'ALTER TABLE ai_usage ADD COLUMN cost_cny REAL',
  "ALTER TABLE ai_usage ADD COLUMN cost_status TEXT DEFAULT 'unknown'",
  // BLOCK-79 P1 — 供应商归因（additive；旧行 NULL = 未归因）
  'ALTER TABLE ai_usage ADD COLUMN provider TEXT',
  // BLOCK-98 M5 — 请求韧性遥测（additive；旧行 0/NULL = 未标记）
  'ALTER TABLE ai_usage ADD COLUMN attempt INTEGER DEFAULT 0',
  'ALTER TABLE ai_usage ADD COLUMN retryable INTEGER DEFAULT 0',
  'ALTER TABLE ai_usage ADD COLUMN context_exceeded INTEGER DEFAULT 0',
  'ALTER TABLE ai_usage ADD COLUMN cancelled_by_user INTEGER DEFAULT 0',
]) {
  try { sqlite.exec(statement); } catch { /* already migrated */ }
}
try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_ai_usage_provider_ts ON ai_usage(provider, ts DESC)'); } catch {}
try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_ai_usage_conv ON ai_usage(conversation_id)'); } catch {}

function recordAiUsage({userId, kind, model, provider, promptTokens, completionTokens, cacheReadTokens, cacheCreationTokens, latencyMs, errorCode, conversationId, costCny, costStatus, attempt, retryable, contextExceeded, cancelledByUser}) {
  try {
    const normalizedCost = Number.isFinite(Number(costCny)) ? Number(costCny) : null;
    sqlite.prepare(`INSERT INTO ai_usage (user_id, ts, kind, model, provider, prompt_tokens, completion_tokens, latency_ms, cache_read_tokens, cache_creation_tokens, cost_cny, cost_status, error_code, conversation_id, attempt, retryable, context_exceeded, cancelled_by_user)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        userId || null,
        new Date().toISOString(),
        kind || 'other',
        model || null,
        provider || null,
        promptTokens|0,
        completionTokens|0,
        latencyMs|0,
        cacheReadTokens|0,
        cacheCreationTokens|0,
        normalizedCost,
        costStatus || (normalizedCost == null ? 'unknown' : 'estimated'),
        errorCode || null,
        conversationId || null,
        attempt|0,
        retryable ? 1 : 0,
        contextExceeded ? 1 : 0,
        cancelledByUser ? 1 : 0,
      );
  } catch (e) {
    console.warn('[ai-usage] insert failed:', e && e.message);
  }
}

function summarizeAiUsage({ userId = null, conversationId = null, since = null } = {}) {
  const clauses = [];
  const params = [];
  if (userId) { clauses.push('user_id = ?'); params.push(userId); }
  if (conversationId) { clauses.push('conversation_id = ?'); params.push(conversationId); }
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

/**
 * UI-523 — 会话级用量聚合（composer 运行计量条消费；只读投影，零新账本）。
 *
 * 与 `summarizeAiUsage` 同表同口径，额外给出 `latencyMs` / `tokensPerSecond`：
 * - `tokensPerSecond = SUM(completion_tokens) ÷ (SUM(latency_ms)/1000)`，端到端平均
 *   输出速率（含网络/首 token 前 prefill），BLOCK-79 口径；界面不得称「解码速度」。
 * - `latencyMs = 0`（无调用或旧行无耗时）时 `tokensPerSecond = null` ⇒ 前端显示
 *   「不可算」，不是 0。
 * - `user_id` 与 `conversation_id` 双过滤即所有权边界：他人会话自然查到全 0，
 *   不 404（不泄漏会话是否存在）。
 *
 * 不改 `summarizeAiUsage` 契约：成本熔断（BLOCK-176 CP-18）消费方零影响。
 */
function summarizeConversationUsage({ conversationId = null, userId = null } = {}) {
  const empty = {
    calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
    cacheHitRate: 0, latencyMs: 0, tokensPerSecond: null,
  };
  if (!conversationId) return empty;
  const clauses = ['conversation_id = ?'];
  const params = [conversationId];
  if (userId) { clauses.push('user_id = ?'); params.push(userId); }
  try {
    const row = sqlite.prepare(`SELECT COUNT(*) AS calls,
      COALESCE(SUM(prompt_tokens),0) AS inputTokens,
      COALESCE(SUM(completion_tokens),0) AS outputTokens,
      COALESCE(SUM(cache_read_tokens),0) AS cacheReadTokens,
      COALESCE(SUM(latency_ms),0) AS latencyMs
      FROM ai_usage WHERE ${clauses.join(' AND ')}`).get(...params);
    if (!row) return empty;
    const inputTokens = Number(row.inputTokens) || 0;
    const outputTokens = Number(row.outputTokens) || 0;
    const cacheReadTokens = Number(row.cacheReadTokens) || 0;
    const latencyMs = Number(row.latencyMs) || 0;
    return {
      calls: Number(row.calls) || 0,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheHitRate: inputTokens > 0 ? cacheReadTokens / inputTokens : 0,
      latencyMs,
      tokensPerSecond: latencyMs > 0 ? Math.round((outputTokens / (latencyMs / 1000)) * 10) / 10 : null,
    };
  } catch (e) {
    console.warn('[ai-usage] summarizeConversationUsage failed:', e && e.message);
    return empty;
  }
}

/**
 * BLOCK-78 P2-② — 项目级用量聚合（读面；不改 summarizeAiUsage 契约）。
 * ai_usage 经 conversation_id JOIN copilot_conversations.project_id 归因到
 * 项目；conversation_id 为空的行（无会话上下文调用）不计入项目口径。
 */
function summarizeProjectUsage({ projectId = null, userId = null } = {}) {
  const empty = {
    calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
    estimatedCostCny: 0, unknownCostCalls: 0, failedCalls: 0,
    cacheHitRate: 0, costStatus: 'estimated',
  };
  if (!projectId) return empty;
  try {
    const clauses = ['c.project_id = ?'];
    const params = [projectId];
    if (userId) { clauses.push('au.user_id = ?'); params.push(userId); }
    const row = sqlite.prepare(`SELECT COUNT(*) AS calls,
      COALESCE(SUM(au.prompt_tokens),0) AS inputTokens,
      COALESCE(SUM(au.completion_tokens),0) AS outputTokens,
      COALESCE(SUM(au.cache_read_tokens),0) AS cacheReadTokens,
      COALESCE(SUM(au.cost_cny),0) AS estimatedCostCny,
      SUM(CASE WHEN au.cost_status = 'unknown' THEN 1 ELSE 0 END) AS unknownCostCalls,
      SUM(CASE WHEN au.error_code IS NOT NULL THEN 1 ELSE 0 END) AS failedCalls
      FROM ai_usage au
      JOIN copilot_conversations c ON au.conversation_id = c.id
      WHERE ${clauses.join(' AND ')}`).get(...params);
    if (!row) return empty;
    return {
      ...row,
      cacheHitRate: row.inputTokens > 0 ? row.cacheReadTokens / row.inputTokens : 0,
      costStatus: row.unknownCostCalls > 0 ? 'partial' : 'estimated',
    };
  } catch (e) {
    console.warn('[ai-usage] summarizeProjectUsage failed:', e && e.message);
    return empty;
  }
}

/**
 * BLOCK-79 P1 — 按供应商的输出速率聚合（成对口径：tokens/latency 同表求和）。
 *
 * - 口径：tokensPerSecond = SUM(completion_tokens) ÷ (SUM(latency_ms)/1000)
 *   = 端到端平均输出速率（含排队/首 token 前 prefill/网络），是真实解码
 *   速度的下限；界面禁止称「解码速度」。
 * - kind 过滤：排除 embedding（无输出 token，污染分母）；其余 LLM 文本
 *   调用（chat/chat_turn/tool_summary_retry/agent_iter…）全部计入。
 * - 不可算边界：completion_tokens=0 的调用（渠道未返回 usage）单独计数，
 *   全组皆如此时 measurable=false，前端显示「不可算」而非 0。
 * - 旧行 provider 为 NULL → 归入「(未归因)」组。
 */
function summarizeProviderUsage({ userId = null, since = null, limit = 20 } = {}) {
  try {
    const clauses = ["kind <> 'embedding'"];
    const params = [];
    if (since) { clauses.push('ts >= ?'); params.push(since); }
    if (userId) { clauses.push('user_id = ?'); params.push(userId); }
    params.push(Math.max(1, Math.min(50, Number(limit) || 20)));
    const rows = sqlite.prepare(`SELECT COALESCE(provider,'(未归因)') AS provider,
        COUNT(*) AS calls,
        COALESCE(SUM(prompt_tokens),0) AS inputTokens,
        COALESCE(SUM(completion_tokens),0) AS outputTokens,
        COALESCE(SUM(latency_ms),0) AS latencyMs,
        SUM(CASE WHEN COALESCE(completion_tokens,0) > 0 THEN 1 ELSE 0 END) AS measurableCalls,
        SUM(CASE WHEN COALESCE(completion_tokens,0) = 0 THEN 1 ELSE 0 END) AS noUsageCalls
      FROM ai_usage
      WHERE ${clauses.join(' AND ')}
      GROUP BY provider
      ORDER BY outputTokens DESC
      LIMIT ?`).all(...params);
    return rows.map((r) => ({
      ...r,
      tokensPerSecond: Number(r.latencyMs) > 0
        ? Math.round((r.outputTokens / (r.latencyMs / 1000)) * 10) / 10
        : null,
      measurable: Number(r.measurableCalls) > 0,
    }));
  } catch (e) {
    console.warn('[ai-usage] summarizeProviderUsage failed:', e && e.message);
    return [];
  }
}

// Pricing in CNY per 1M tokens.
const AI_PRICING = {  'deepseek-chat':           {input: 0.5, output: 8.0,  cacheHit: 0.1},
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
  summarizeProjectUsage,
  summarizeProviderUsage,
  summarizeConversationUsage,
  estimateCostCNY,
  AI_PRICING,
};
