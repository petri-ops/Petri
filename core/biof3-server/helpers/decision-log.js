/**
 * helpers/decision-log.js — BLOCK-116 W2 决策台账（decision_log 表记账，best-effort）。
 *
 * 契约（plan docs/block-116-decision-platform-plan.md §2）：
 *  - 记账咽喉=decision-api askDecision 的 meta（{point, threshold}）：提供 meta.point
 *    才记账，缺省零行为（校准 harness/契约测试零 DB 依赖）。
 *  - 记账 best-effort：任何失败（DB 不可用/语句错误）静默跳过，永不影响决策结果。
 *  - state 只存 sha256 指纹 + 200 字预览（原文不落库——最小化敏感面，弧线 §W2）。
 *  - db 懒取（首次记账时才 require），避免模块加载期副作用；观察端点同源。
 */
'use strict';

const crypto = require('node:crypto');

let _cachedDb = null;

function getDb() {
  if (_cachedDb) return _cachedDb;
  const dbMod = require('../db');
  _cachedDb = dbMod.getAsyncDatabase();
  return _cachedDb;
}

/** 测试注入：替换懒取句柄。 */
function _setDecisionLogDb(db) {
  _cachedDb = db;
}

/**
 * 记账一条决策调用（best-effort；永不 throw）。
 * @param {object} entry {point, state, choice, confidence, threshold, degraded, reason, model, latencyMs, probabilities}
 */
async function logDecision(entry) {
  try {
    if (!entry || !entry.point) return;
    const stateHash = crypto
      .createHash('sha256')
      .update(String(entry.state || ''))
      .digest('hex')
      .slice(0, 16);
    const db = await getDb();
    await db.prepare(
      `INSERT INTO decision_log
        (at, point, state_hash, state_preview, choice, confidence, threshold, degraded, reason, model, latency_ms, probabilities_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      new Date().toISOString(),
      String(entry.point),
      stateHash,
      String(entry.state || '').slice(0, 200),
      entry.choice == null ? null : String(entry.choice),
      typeof entry.confidence === 'number' ? entry.confidence : null,
      typeof entry.threshold === 'number' ? entry.threshold : null,
      entry.degraded ? 1 : 0,
      entry.reason == null ? null : String(entry.reason).slice(0, 120),
      entry.model == null ? null : String(entry.model),
      typeof entry.latencyMs === 'number' ? entry.latencyMs : null,
      entry.probabilities ? JSON.stringify(entry.probabilities) : null
    );
  } catch (e) {
    // 记账失败静默跳过——决策结果永不因台账受影响；BLOCK116_DEBUG=1 时出口诊断
    if (process.env.BLOCK116_DEBUG) {
      try { console.error('[block116] logDecision failed:', e && e.message); } catch {}
    }
  }
}

/**
 * 按接点聚合观测（近 days 天）：调用量/均延迟/降级率。DB 不可用返回 null。
 */
async function summarizeDecisions({ days = 7 } = {}) {
  try {
    const db = await getDb();
    const rows = await db
      .prepare(
        `SELECT point, COUNT(*) AS calls, AVG(latency_ms) AS avg_latency_ms,
                SUM(degraded) AS degraded_count, MAX(at) AS last_at
         FROM decision_log
         WHERE at >= datetime('now', ?)
         GROUP BY point ORDER BY calls DESC`
      )
      .all(`-${Number(days) || 7} days`);
    return rows.map((r) => ({
      point: r.point,
      calls: r.calls,
      avgLatencyMs: Math.round(r.avg_latency_ms || 0),
      degradedCount: r.degraded_count || 0,
      degradedRate: r.calls ? Math.round(((r.degraded_count || 0) / r.calls) * 1000) / 1000 : 0,
      lastAt: r.last_at,
    }));
  } catch {
    return null;
  }
}

/**
 * 最近决策逐条回放（BLOCK-116 P3 观测面增量）：可选按接点过滤，最新在前。
 * DB 不可用返回 null。
 */
async function recentDecisions({ limit = 50, point } = {}) {
  try {
    const db = await getDb();
    const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const rows = point
      ? await db.prepare('SELECT * FROM decision_log WHERE point = ? ORDER BY id DESC LIMIT ?').all(String(point), cap)
      : await db.prepare('SELECT * FROM decision_log ORDER BY id DESC LIMIT ?').all(cap);
    return rows.map((r) => ({
      at: r.at,
      point: r.point,
      choice: r.choice,
      confidence: r.confidence,
      threshold: r.threshold,
      degraded: !!r.degraded,
      reason: r.reason,
      model: r.model,
      latencyMs: r.latency_ms,
      statePreview: r.state_preview,
    }));
  } catch {
    return null;
  }
}

module.exports = { logDecision, summarizeDecisions, recentDecisions, _setDecisionLogDb };
