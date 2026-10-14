'use strict';

/**
 * helpers/memory-lifecycle.js — BLOCK-182 记忆生命周期单源。
 *
 * 四件：惰性衰减（TTL 未确认 auto 事实 → decayed）/ 矛盾消解（同类别规范化等值合并）/
 * 用户纠错流（superseded 替代链，免费直生效）/ 全链审计（memory_audit 六动作）。
 * 设计裁决与判据见 docs/block-182-memory-lifecycle-plan.md；CP-6 评估结论的承接。
 *
 * 惰性触发（同 BLOCK-180 审批资源 TTL 模式）：扫描挂读写路径顺手执行，不引入后台任务。
 * user_facts 原文永不删改原则延续：衰减/替代只改状态列。
 */

const crypto = require('crypto');

// 衰减参数（reopen 条件：真实使用节奏重校准，plan §reopen）。
const AUTO_FACT_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 天未确认的 auto 事实转 decayed
const DECAY_BATCH_LIMIT = 200; // 单次惰性扫描上限（读路径顺手扫，不占页）

const AUDIT_ACTIONS = new Set(['extract_write', 'merge', 'correction', 'supersede', 'decay', 'clear']);
const AUDIT_ACTORS = new Set(['system', 'user', 'model']);

function nowIso() { return new Date().toISOString(); }
function newFactId() { return `fact_${crypto.randomBytes(9).toString('hex')}`; }

function normalizeFactContent(value) {
  return String(value || '').toLowerCase().replaceAll(/\s+/g, ' ').trim();
}

/**
 * 确保生命周期列在库（迁移 013 之前的旧库兜底；已加列时静默）。
 */
function ensureLifecycleColumns(sqlite) {
  for (const col of ['status', 'superseded_by', 'last_confirmed_at']) {
    try { sqlite.exec(`ALTER TABLE user_facts ADD COLUMN ${col} ${col === 'status' ? "TEXT NOT NULL DEFAULT 'active'" : 'TEXT'}`); } catch { /* 已存在 */ }
  }
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS memory_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'system',
      action TEXT NOT NULL,
      fact_id TEXT,
      detail_json TEXT,
      created_at TEXT NOT NULL
    )`);
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_memory_audit_user ON memory_audit(user_id, created_at DESC)');
  } catch { /* 已存在 */ }
}

/**
 * 全链审计（best-effort：审计失败不阻塞记忆主流程，同 decision-log 先例）。
 */
function appendAudit(sqlite, { userId, actor = 'system', action, factId = null, detail = null }) {
  if (!AUDIT_ACTIONS.has(action)) return;
  if (!AUDIT_ACTORS.has(actor)) actor = 'system';
  try {
    sqlite.prepare(
      'INSERT INTO memory_audit (user_id, actor, action, fact_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(String(userId || ''), actor, action, factId, detail ? JSON.stringify(detail).slice(0, 2000) : null, nowIso());
  } catch { /* 审计失败不阻塞 */ }
}

function listAudit(sqlite, userId, limit = 100) {
  return sqlite.prepare(
    'SELECT actor, action, fact_id AS factId, detail_json AS detail, created_at AS createdAt FROM memory_audit WHERE user_id = ? ORDER BY id DESC LIMIT ?'
  ).all(String(userId || ''), Math.max(1, Math.min(Number(limit) || 100, 500)));
}

/**
 * 惰性衰减：TTL 未确认的 auto 非置顶事实 → status='decayed'（保留行，审计 decay）。
 * 返回本批衰减条数。
 */
function lazyDecayFacts(sqlite, userId, { now = Date.now() } = {}) {
  ensureLifecycleColumns(sqlite);
  const rows = sqlite.prepare(
    `SELECT id, updated_at FROM user_facts
     WHERE user_id = ? AND status = 'active' AND pinned = 0 AND source = 'auto'
       AND (last_confirmed_at IS NULL OR last_confirmed_at < ?)
     ORDER BY updated_at ASC LIMIT ?`
  ).all(String(userId || ''), nowIso(), DECAY_BATCH_LIMIT);
  let decayed = 0;
  for (const row of rows) {
    const anchor = Date.parse(row.updated_at || '') || 0;
    if (now - anchor < AUTO_FACT_TTL_MS) continue; // 未到 TTL（updated_at 为锚，last_confirmed 存在时上面 WHERE 已筛）
    sqlite.prepare("UPDATE user_facts SET status = 'decayed' WHERE id = ? AND status = 'active'").run(row.id);
    appendAudit(sqlite, { userId, actor: 'system', action: 'decay', factId: row.id, detail: { updatedAt: row.updated_at } });
    decayed += 1;
  }
  return decayed;
}

/**
 * 抽取矛盾消解（确定性 v1）：同用户同类别下规范化等值的内容视为同一事实——
 * 合并（更新正文为最新表述 + 刷新 last_confirmed_at + 审计 merge），不新增重复行。
 * @returns {{merged: object|null}} 命中合并时返回已更新的行
 */
function findMergeableFact(sqlite, userId, category, content) {
  const normalized = normalizeFactContent(content);
  if (!normalized) return null;
  const rows = sqlite.prepare(
    "SELECT id, content FROM user_facts WHERE user_id = ? AND category = ? AND status = 'active'"
  ).all(String(userId || ''), String(category || ''));
  return rows.find((r) => normalizeFactContent(r.content) === normalized) || null;
}

function markConfirmed(sqlite, { userId, factId, detail = null }) {
  sqlite.prepare('UPDATE user_facts SET last_confirmed_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), factId);
  appendAudit(sqlite, { userId, actor: 'system', action: 'merge', factId, detail });
}

/**
 * 用户纠错流（免费直生效）：旧事实标 superseded（superseded_by 链）+ 插入修正行。
 * 不原地覆盖——替代链可审计。@returns 新事实 id。
 */
function supersedeWithCorrection(sqlite, { userId, oldFactId, category, content, projectId = null }) {
  ensureLifecycleColumns(sqlite);
  const id = newFactId();
  const ts = nowIso();
  sqlite.prepare(
    `INSERT INTO user_facts (id, user_id, category, content, pinned, source, project_id, status, superseded_by, last_confirmed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 'manual', ?, 'active', NULL, ?, ?, ?)`
  ).run(id, String(userId || ''), String(category || 'note'), String(content || ''), projectId, ts, ts, ts);
  sqlite.prepare("UPDATE user_facts SET status = 'superseded', superseded_by = ?, updated_at = ? WHERE id = ? AND status = 'active'").run(id, ts, oldFactId);
  appendAudit(sqlite, { userId, actor: 'user', action: 'correction', factId: id, detail: { superseded: oldFactId, category } });
  appendAudit(sqlite, { userId, actor: 'user', action: 'supersede', factId: oldFactId, detail: { by: id } });
  return id;
}

module.exports = {
  AUTO_FACT_TTL_MS,
  DECAY_BATCH_LIMIT,
  ensureLifecycleColumns,
  appendAudit,
  listAudit,
  lazyDecayFacts,
  findMergeableFact,
  markConfirmed,
  supersedeWithCorrection,
  normalizeFactContent,
  newFactId,
};
