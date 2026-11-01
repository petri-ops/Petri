/**
 * helpers/policy-observation-store.js — BLOCK-323 放权坡道观察存储（policy_observations 表）。
 *
 * 为什么独立表：task_events 有 30 天保留清扫（agent-task-store.js TASK_EVENTS_RETENTION_DAYS），
 * 不能承载复盘证据；decision_log 是 AI 决策原语台账（BLOCK-119/244 语义），不挪用。
 * policy_observations 是放权坡道的一等事实：observe 命中的「本可自动执行」证据、
 * rule-auto-allow 的授权行使审计、policy-change 的规则演变留痕——本地可查可复盘。
 *
 * 合并语义（dsh Effects kind/key 合并同思想）：同 (kind, rule_id, tool_name, fingerprint)
 * 只有一行——hits 累计、首见脱敏样本保留、last_seen 刷新；policy-change 行指纹含时间戳，
 * 永不合并（历史追加）。
 *
 * 失败语义：写侧 best-effort 永不 throw（观察失败绝不阻断工具调用，仿 decision-log.js）；
 * 查询/复盘接口如实抛错（设置面可感知）。
 * db 懒取（首次调用才 require），测试经 _setPolicyObservationDb 注入。
 */

'use strict';

const OBSERVATION_KINDS = new Set(['rule-observe', 'tool-observe', 'rule-auto-allow', 'policy-change']);
const REVIEWABLE_KINDS = "('rule-observe','tool-observe')";

let _cachedDb = null;
let _schemaReady = false;

function getDb() {
  if (_cachedDb) return _cachedDb;
  const dbMod = require('../db');
  _cachedDb = dbMod.getAsyncDatabase();
  return _cachedDb;
}

/** 测试注入：替换懒取句柄。 */
function _setPolicyObservationDb(db) {
  _cachedDb = db;
  _schemaReady = false;
}

async function ensureSchema(db) {
  if (_schemaReady) return;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS policy_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      rule_id TEXT NOT NULL DEFAULT '',
      tool_name TEXT NOT NULL DEFAULT '',
      fingerprint TEXT NOT NULL DEFAULT '',
      guard_key TEXT NOT NULL DEFAULT '',
      sample_preview TEXT,
      hits INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      reviewed_at TEXT
    )
  `);
  await db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_obs_key ON policy_observations(kind, rule_id, tool_name, fingerprint)'
  );
  await db.exec('CREATE INDEX IF NOT EXISTS idx_policy_obs_reviewed ON policy_observations(reviewed_at)');
  _schemaReady = true;
}

/**
 * 记一条观察（UPSERT 合并；best-effort）。
 * @param {{kind:string, ruleId?:string, toolName?:string, fingerprint?:string,
 *          guardKey?:string, samplePreview?:string|null}} entry
 * @returns {Promise<{ok:boolean, id?:number, hits?:number}>}
 */
async function recordObservation(entry) {
  try {
    const kind = String((entry && entry.kind) || '');
    if (!OBSERVATION_KINDS.has(kind)) return { ok: false };
    const db = await getDb();
    await ensureSchema(db);
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO policy_observations
           (kind, rule_id, tool_name, fingerprint, guard_key, sample_preview, hits, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(kind, rule_id, tool_name, fingerprint) DO UPDATE SET
           hits = hits + 1,
           last_seen_at = excluded.last_seen_at`
      )
      .run(
        kind,
        String((entry && entry.ruleId) || ''),
        String((entry && entry.toolName) || ''),
        String((entry && entry.fingerprint) || ''),
        String((entry && entry.guardKey) || ''),
        (entry && entry.samplePreview) || null,
        now,
        now
      );
    const row = await db
      .prepare(
        'SELECT id, hits FROM policy_observations WHERE kind = ? AND rule_id = ? AND tool_name = ? AND fingerprint = ?'
      )
      .get(kind, String((entry && entry.ruleId) || ''), String((entry && entry.toolName) || ''), String((entry && entry.fingerprint) || ''));
    return { ok: true, id: row ? row.id : undefined, hits: row ? row.hits : undefined };
  } catch {
    return { ok: false };
  }
}

/**
 * 记一条规则变更留痕（kind=policy-change；历史追加，永不合并；best-effort）。
 * @param {{summary:string}} entry — summary 为变更摘要 JSON 文本（动作变化条目 id before→after）
 */
async function recordPolicyChange(summary) {
  const at = new Date().toISOString();
  return recordObservation({
    kind: 'policy-change',
    ruleId: '',
    toolName: '',
    fingerprint: `change:${at}:${Math.random().toString(36).slice(2, 8)}`,
    guardKey: '',
    samplePreview: String(summary || ''),
    // policy-change 行的 first_seen/last_seen 即变更时间
  }).then((result) => (result.ok ? { ...result, at } : result));
}

function rowToView(row) {
  return {
    id: row.id,
    kind: row.kind,
    ruleId: row.rule_id || null,
    toolName: row.tool_name || null,
    fingerprint: row.fingerprint,
    guardKey: row.guard_key || null,
    samplePreview: row.sample_preview || null,
    hits: row.hits,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    reviewedAt: row.reviewed_at || null,
  };
}

/** 未复盘观察分组（待复盘列表；按最近命中排序）。 */
async function listUnreviewed(limit = 200) {
  const db = await getDb();
  await ensureSchema(db);
  const rows = await db
    .prepare(
      `SELECT * FROM policy_observations
       WHERE reviewed_at IS NULL AND kind IN ${REVIEWABLE_KINDS}
       ORDER BY last_seen_at DESC LIMIT ?`
    )
    .all(Math.max(1, Math.min(500, Number(limit) || 200)));
  return rows.map(rowToView);
}

/** 近期自动放行（rule-auto-allow 审计；授权行使可回放）。 */
async function listAutoAllow(limit = 20) {
  const db = await getDb();
  await ensureSchema(db);
  const rows = await db
    .prepare(
      "SELECT * FROM policy_observations WHERE kind = 'rule-auto-allow' ORDER BY last_seen_at DESC LIMIT ?"
    )
    .all(Math.max(1, Math.min(100, Number(limit) || 20)));
  return rows.map(rowToView);
}

/** 近期规则变更留痕。 */
async function listPolicyChanges(limit = 20) {
  const db = await getDb();
  await ensureSchema(db);
  const rows = await db
    .prepare(
      "SELECT * FROM policy_observations WHERE kind = 'policy-change' ORDER BY id DESC LIMIT ?"
    )
    .all(Math.max(1, Math.min(100, Number(limit) || 20)));
  return rows.map(rowToView);
}

/** 未复盘观察数（通知桥阈值判据）。 */
async function unreviewedCount() {
  const db = await getDb();
  await ensureSchema(db);
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM policy_observations WHERE reviewed_at IS NULL AND kind IN ${REVIEWABLE_KINDS}`)
    .get();
  return row ? row.n : 0;
}

/**
 * 标复盘（观察行退出待复盘列表；null 让位新观察再触发通知）。
 * @param {{ids?: number[], all?: boolean}} input
 * @returns {Promise<{ok:boolean, updated?:number}>}
 */
async function markReviewed(input = {}) {
  const db = await getDb();
  await ensureSchema(db);
  const now = new Date().toISOString();
  if (input.all === true) {
    const result = await db
      .prepare(`UPDATE policy_observations SET reviewed_at = ? WHERE reviewed_at IS NULL AND kind IN ${REVIEWABLE_KINDS}`)
      .run(now);
    return { ok: true, updated: result.changes };
  }
  const ids = Array.isArray(input.ids) ? input.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  if (ids.length === 0) return { ok: false };
  let updated = 0;
  for (const id of ids.slice(0, 500)) {
    const result = await db
      .prepare(`UPDATE policy_observations SET reviewed_at = ? WHERE id = ? AND reviewed_at IS NULL AND kind IN ${REVIEWABLE_KINDS}`)
      .run(now, id);
    updated += result.changes;
  }
  return { ok: true, updated };
}

module.exports = {
  OBSERVATION_KINDS,
  recordObservation,
  recordPolicyChange,
  listUnreviewed,
  listAutoAllow,
  listPolicyChanges,
  unreviewedCount,
  markReviewed,
  _setPolicyObservationDb,
};
