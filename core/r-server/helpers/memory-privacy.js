/**
 * helpers/memory-privacy.js — MEMORY_PRIVACY_v1 (privacy stats + wipe + audit)
 *
 * Extracted from server.js (Phase 8.6 helper modularization).
 * Pure module: depends only on ../db.
 *
 * Public API:
 *   logChatAudit(userId, page, msgCount)
 *   getMemoryStats(userId) → {facts, factsPinned, summary, vectors, audit}
 *   wipeAllMemory(userId) → number (rows removed)
 */

const dbMod = require('../db');
const sqlite = dbMod.getSqliteForLegacyModules();

// One-time table create (idempotent)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS chat_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    page TEXT,
    msg_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_chat_audit_user ON chat_audit(user_id, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_chat_audit_ts ON chat_audit(ts DESC);
`);

function logChatAudit(userId, page, msgCount) {
  if (!userId) return;
  try {
    sqlite
      .prepare('INSERT INTO chat_audit(user_id, ts, page, msg_count) VALUES (?,?,?,?)')
      .run(userId, new Date().toISOString(), page || null, msgCount || 0);
  } catch {
    /* ignore */
  }
}

function getMemoryStats(userId) {
  const stats = {};
  try {
    stats.facts = sqlite
      .prepare('SELECT COUNT(*) AS n FROM user_facts WHERE user_id = ?')
      .get(userId).n;
    stats.factsPinned = sqlite
      .prepare('SELECT COUNT(*) AS n FROM user_facts WHERE user_id = ? AND pinned = 1')
      .get(userId).n;
  } catch {
    stats.facts = 0;
    stats.factsPinned = 0;
  }
  try {
    const sumRow = sqlite
      .prepare('SELECT msg_count, updated_at FROM chat_summaries WHERE user_id = ?')
      .get(userId);
    stats.summary = sumRow ? { msgCount: sumRow.msg_count, updatedAt: sumRow.updated_at } : null;
  } catch {
    stats.summary = null;
  }
  try {
    stats.vectors = sqlite
      .prepare('SELECT COUNT(*) AS n FROM memory_vectors WHERE user_id = ?')
      .get(userId).n;
  } catch {
    stats.vectors = 0;
  }
  try {
    const auditRow = sqlite
      .prepare(
        'SELECT COUNT(*) AS n, MIN(ts) AS first_ts, MAX(ts) AS last_ts FROM chat_audit WHERE user_id = ?'
      )
      .get(userId);
    stats.audit = { totalCalls: auditRow.n, firstAt: auditRow.first_ts, lastAt: auditRow.last_ts };
  } catch {
    stats.audit = { totalCalls: 0 };
  }
  return stats;
}

function wipeAllMemory(userId) {
  let removed = 0;
  try {
    removed += sqlite.prepare('DELETE FROM user_facts WHERE user_id = ?').run(userId).changes;
  } catch {}
  try {
    removed += sqlite.prepare('DELETE FROM chat_summaries WHERE user_id = ?').run(userId).changes;
  } catch {}
  try {
    removed += sqlite.prepare('DELETE FROM memory_vectors WHERE user_id = ?').run(userId).changes;
  } catch {}
  return removed;
}

module.exports = {
  logChatAudit,
  getMemoryStats,
  wipeAllMemory,
};
