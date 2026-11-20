'use strict';

/**
 * helpers/lesson-store.js — EVO-2 lesson 分级写入决策核 + 结构化存储（best-effort）。
 *
 * 定性：harness 自进化把 lesson 落到行为面的**决策入口**。所有分级写入必须先过
 * harness-redline 的 fail-closed 门——红线内资产（harness 源码/工具注册表/approval 链/
 * built-in skill/凭据）一律拒绝，即使 lesson.scope=auto。物理落盘仍走既有 workspace_write
 * 治理门（路径沙箱/审批/sha256 乐观锁），本模块只产出「该写到哪个 tier、是否放行」的决策，
 * 不自己 fs 写文件（不绕过治理）。
 *
 * 与 incident-log.js 同构：懒取 DB + ON CONFLICT upsert（仿 policy-observation-store）+ fail-soft。
 */
const {
  classifyEvolutionTarget,
  assertEvolutionTargetAllowed,
} = require('../../shared-backend/harness-redline.js');
// EVO-3 — Verify 频率判据纯函数
const { judgeFrequency } = require('../../shared-backend/lesson-frequency.js');

let _cachedDb = null;
let _writeFailures = 0;

function getDb() {
  if (_cachedDb) return _cachedDb;
  _cachedDb = require('../db').getDatabase();
  return _cachedDb;
}

function _setLessonDb(db) { _cachedDb = db; }
function _resetLessonStats() { _writeFailures = 0; }

/**
 * 分级写入决策（纯逻辑 + 红线门，fail-closed）。
 * 红线 tier 优先于 lesson.scope：目标在白名单里是什么 tier，就按什么 tier 执行；
 * 不在白名单/命中红线 → rejected（拒绝优先）。
 * @param {object} lesson - 至少含 sourceFingerprint / scope
 * @param {string} target - 相对工作区的写入目标
 * @returns {{allowed: boolean, action: 'auto'|'ack'|'draft'|'rejected', effectiveTier: string, reason: string, target: string}}
 */
function applyLessonDecision(lesson = {}, target = '') {
  const classified = classifyEvolutionTarget(target);
  if (!classified.allowed) {
    return Object.freeze({
      allowed: false, action: 'rejected', effectiveTier: 'forbidden',
      reason: classified.reason, target: String(target),
    });
  }
  // 红线 tier 为准（auto 档目标才能自动写；ack/draft 档不得因 lesson 自称 auto 而越权）
  const effectiveTier = classified.tier;
  let action = effectiveTier;
  if (effectiveTier === 'auto' && lesson && lesson.scope === 'draft') action = 'draft';
  // assert 再过一遍门（双保险；classify 已判 allowed，正常不会 throw）
  try {
    assertEvolutionTargetAllowed(target);
  } catch (e) {
    return Object.freeze({
      allowed: false, action: 'rejected', effectiveTier: 'forbidden',
      reason: e && e.message ? e.message : 'redline_assert_failed', target: String(target),
    });
  }
  return Object.freeze({
    allowed: true, action, effectiveTier,
    reason: classified.reason, target: String(target),
  });
}

/**
 * upsert 一条 lesson 到结构化真源（best-effort；同 fingerprint 更新而非重复插）。
 * @param {object} lesson - buildLesson 产物
 * @returns {{ok: boolean, id?: number}}
 */
function upsertLesson(lesson = {}) {
  try {
    if (!lesson || typeof lesson.sourceFingerprint !== 'string' || !lesson.sourceFingerprint) return { ok: false };
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO lessons (source_fingerprint, title, action, scope, confidence, evidence, status,
         created_at, last_seen_at, occurrences_before, occurrences_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(source_fingerprint) DO UPDATE SET
         title = excluded.title,
         action = excluded.action,
         scope = excluded.scope,
         confidence = excluded.confidence,
         evidence = excluded.evidence,
         status = excluded.status,
         last_seen_at = excluded.last_seen_at,
         occurrences_before = excluded.occurrences_before`
    ).run(
      lesson.sourceFingerprint,
      String(lesson.title || ''),
      String(lesson.action || ''),
      String(lesson.scope || 'ack'),
      Number.isFinite(lesson.confidence) ? lesson.confidence : 0,
      Array.isArray(lesson.evidence) ? JSON.stringify(lesson.evidence) : null,
      String(lesson.status || 'needs_human'),
      lesson.createdAt || now,
      lesson.lastSeenAt || now,
      Number.isFinite(lesson.occurrencesBefore) ? lesson.occurrencesBefore : 0
    );
    const row = db.prepare('SELECT id FROM lessons WHERE source_fingerprint = ?').get(lesson.sourceFingerprint);
    return { ok: true, id: row && row.id };
  } catch (err) {
    _writeFailures += 1;
    if (process.env.EVO_DEBUG) {
      try { console.error('[evo] upsertLesson failed:', err && err.message); } catch { /* 二次抛错豁免 */ }
    }
    return { ok: false };
  }
}

/** 读取活跃 lesson（供 prompt 注入；best-effort，失败返回空数组）。 */
function listActiveLessons(limit = 8) {
  try {
    const rows = getDb().prepare(
      `SELECT source_fingerprint, title, action, scope, confidence, evidence, status
       FROM lessons WHERE status = 'active' ORDER BY confidence DESC LIMIT ?`
    ).all(limit);
    return rows.map((r) => ({
      sourceFingerprint: r.source_fingerprint,
      title: r.title,
      action: r.action,
      scope: r.scope,
      confidence: r.confidence,
      evidence: (() => { try { return JSON.parse(r.evidence || '[]'); } catch { return []; } })(),
      status: r.status,
    }));
  } catch {
    return [];
  }
}

/**
 * EVO-3 — 按 lesson.created_at 分段统计同类 fingerprint 的 before/after 频率并判据。
 * @param {string} fingerprint
 * @returns {{before:number, after:number, decision:object, ok:boolean}}
 */
function verifyLessonFrequency(fingerprint = '') {
  try {
    if (typeof fingerprint !== 'string' || !fingerprint) return { before: 0, after: 0, decision: judgeFrequency(0, 0), ok: false };
    const row = getDb().prepare(
      `SELECT l.created_at AS boundary,
              SUM(CASE WHEN i.created_at <  l.created_at THEN 1 ELSE 0 END) AS before_n,
              SUM(CASE WHEN i.created_at >= l.created_at THEN 1 ELSE 0 END) AS after_n
       FROM lessons l LEFT JOIN incidents i ON i.fingerprint = l.source_fingerprint
       WHERE l.source_fingerprint = ? GROUP BY l.id`
    ).get(fingerprint);
    if (!row) return { before: 0, after: 0, decision: judgeFrequency(0, 0), ok: false };
    const before = Number(row.before_n) || 0;
    const after = Number(row.after_n) || 0;
    // 同步回填 occurrences_after（upsert 不更新该列，EVO-3 在此路径刷新）
    try {
      getDb().prepare('UPDATE lessons SET occurrences_after = ?, last_seen_at = ? WHERE source_fingerprint = ?')
        .run(after, new Date().toISOString(), fingerprint);
    } catch { /* 回填失败不影响判据 */ }
    return { before, after, decision: judgeFrequency(before, after), ok: true };
  } catch (err) {
    _writeFailures += 1;
    if (process.env.EVO_DEBUG) { try { console.error('[evo] verifyLessonFrequency failed:', err && err.message); } catch { /* 调试日志自身失败不追加抛错：外层 catch 已计 _writeFailures，失败可见 */ } }
    return { before: 0, after: 0, decision: judgeFrequency(0, 0), ok: false };
  }
}

/**
 * EVO-3 — 自动回滚：把 lesson 状态改为 rollback 并留证据。
 * 物理 MD 段移除由调用方凭返回的 fingerprint 走 lesson-markdown-projection + workspace_write 治理门。
 * @param {string} fingerprint
 * @param {string} reasonCode - 回滚原因（如 frequency_rebound）
 */
function rollbackLesson(fingerprint = '', reasonCode = 'rollback') {
  try {
    if (typeof fingerprint !== 'string' || !fingerprint) return { ok: false };
    const info = getDb().prepare(
      `UPDATE lessons SET status = 'rollback',
         evidence = COALESCE(evidence, '[]')
       WHERE source_fingerprint = ? AND status = 'active'`
    ).run(fingerprint);
    return { ok: true, changed: info.changes, fingerprint, reason: String(reasonCode) };
  } catch (err) {
    _writeFailures += 1;
    if (process.env.EVO_DEBUG) { try { console.error('[evo] rollbackLesson failed:', err && err.message); } catch { /* 调试日志自身失败不追加抛错：外层 catch 已计 _writeFailures，失败可见 */ } }
    return { ok: false };
  }
}

/**
 * EVO-3 — 证据列表（只读）：每条 lesson 的频率结论 + 状态，供 UI 只读呈现（零代签）。
 * @returns {Array<object>}
 */
function listLessonEvidence(limit = 20) {
  try {
    const rows = getDb().prepare(
      `SELECT source_fingerprint, title, action, scope, confidence, status,
              occurrences_before, occurrences_after, created_at, last_seen_at
       FROM lessons ORDER BY last_seen_at DESC LIMIT ?`
    ).all(limit);
    return rows.map((r) => {
      const before = Number(r.occurrences_before) || 0;
      const after = Number(r.occurrences_after) || 0;
      return {
        sourceFingerprint: r.source_fingerprint,
        title: r.title,
        action: r.action,
        scope: r.scope,
        confidence: r.confidence,
        status: r.status,
        verdict: judgeFrequency(before, after),
        before,
        after,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
      };
    });
  } catch {
    return [];
  }
}

function lessonStoreStats() { return { failures: _writeFailures }; }

module.exports = {
  applyLessonDecision,
  upsertLesson,
  listActiveLessons,
  verifyLessonFrequency,
  rollbackLesson,
  listLessonEvidence,
  lessonStoreStats,
  _setLessonDb,
  _resetLessonStats,
};
