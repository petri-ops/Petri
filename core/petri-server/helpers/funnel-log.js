/**
 * helpers/funnel-log.js — BLOCK-186 本地漏斗事件台账（funnel_events 表，best-effort）。
 *
 * G0 定性（plan docs/block-186-funnel-ledger-plan.md）：评估报告「遥测端点化」字面隐含
 * 远程端点属 G1+（AGENTS.md 禁 G0 启动），本模块按 G0 唯一合法形态落地=本机漏斗事件记录，
 * **零外发**、独立于远程 telemetry_enabled 开关（本机常开，用户可查可删=本地可审计）。
 *
 * 契约：
 *  - 记账咽喉=recordFunnelEvent(name)：仅白名单 6 事件才记（复用 core/packages/shared-telemetry
 *    funnel-events.isFunnelEvent 单源——跨进程共享清单的唯一合法落点，见该模块归属注释），
 *    非白名单静默跳过。
 *  - best-effort：任何失败（DB 不可用/语句错误）静默跳过，永不影响业务（仿 decision-log.js）。
 *  - db 懒取（首次记账才 require），避免模块加载期副作用；测试经 _setFunnelDb 注入。
 *  - 仅覆盖后端进程事件（project_created/first_job_succeeded/report_generated）；Electron 主进程
 *    事件（app_started/runtime_install）经 src/funnel-local.js 直写同一 funnel_events 表（R5 禁
 *    src import core/petri-server，故两端各持薄写入器，共享 core/packages 单源清单 + 同一 petri.db）。
 */
'use strict';

const { isFunnelEvent } = require('../../packages/shared-telemetry/funnel-events.js');

let _cachedDb = null;

function getDb() {
  if (_cachedDb) return _cachedDb;
  const dbMod = require('../db');
  _cachedDb = dbMod.getAsyncDatabase();
  return _cachedDb;
}

/** 测试注入：替换懒取句柄。 */
function _setFunnelDb(db) {
  _cachedDb = db;
}

/**
 * 记一条漏斗事件（best-effort；永不 throw；白名单门）。
 * @param {string} name 事件名（须在 FUNNEL_EVENTS 白名单内）
 * @param {{userId?: string}} [meta]
 */
async function recordFunnelEvent(name, meta = {}) {
  try {
    if (!isFunnelEvent(name)) return;
    const db = await getDb();
    await db
      .prepare(`INSERT INTO funnel_events (at, event, user_id) VALUES (?, ?, ?)`)
      .run(new Date().toISOString(), String(name), meta.userId == null ? null : String(meta.userId));
  } catch {
    // 记账失败静默跳过——业务结果永不因台账受影响
  }
}

/**
 * TTFS（Time To First Success）计算：first_job_succeeded.at − app_started.at（毫秒）。
 * 口径=同 user_id 最近一次 app_started 之后首次 first_job_succeeded；无 app_started 或无成功→null（不编造）。
 * @param {{userId?: string}} [filter]
 * @returns {Promise<{ttfsMs: number|null, appStartedAt: string|null, firstSuccessAt: string|null}>}
 */
async function computeTTFS(filter = {}) {
  const empty = { ttfsMs: null, appStartedAt: null, firstSuccessAt: null };
  try {
    const db = await getDb();
    const userClause = filter.userId == null ? '' : ' AND user_id = ?';
    const args = filter.userId == null ? [] : [String(filter.userId)];
    const started = await db
      .prepare(`SELECT at FROM funnel_events WHERE event = 'app_started'${userClause} ORDER BY id DESC LIMIT 1`)
      .get(...args);
    if (!started) return empty;
    const success = await db
      .prepare(
        `SELECT at FROM funnel_events WHERE event = 'first_job_succeeded'${userClause} AND at >= ? ORDER BY id ASC LIMIT 1`,
      )
      .get(...args, started.at);
    if (!success) return { ...empty, appStartedAt: started.at };
    const ttfsMs = new Date(success.at).getTime() - new Date(started.at).getTime();
    return { ttfsMs: Number.isFinite(ttfsMs) && ttfsMs >= 0 ? ttfsMs : null, appStartedAt: started.at, firstSuccessAt: success.at };
  } catch {
    return empty;
  }
}

/** 台账逐条回放（观测/验收用），最新在前。DB 不可用返回 null。 */
async function recentFunnelEvents({ limit = 50 } = {}) {
  try {
    const db = await getDb();
    const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const rows = await db.prepare('SELECT at, event, user_id FROM funnel_events ORDER BY id DESC LIMIT ?').all(cap);
    return rows.map((r) => ({ at: r.at, event: r.event, userId: r.user_id }));
  } catch {
    return null;
  }
}

module.exports = { recordFunnelEvent, computeTTFS, recentFunnelEvents, _setFunnelDb };
