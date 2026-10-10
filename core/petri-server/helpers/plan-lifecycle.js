'use strict';

/**
 * helpers/plan-lifecycle.js — BLOCK-55 计划生命周期编排（批准三选一 + 修订应用）。
 *
 * 从 routes/ai-plans.js 抽出的可单测编排层：路由只做 HTTP 形状转换，
 * 状态迁移语义全部在这里。用 async DB facade（与 ai-plans.js 一致）。
 */

// PLAN_TOOL_v1 基础表 DDL —— 与 ai-bridge setupPlanTables 共用同一事实源
//（测试库从 src/migrations 自举，不含 ai-bridge 的运行时建表）。
const PLAN_BASE_DDL = `
    CREATE TABLE IF NOT EXISTS copilot_plans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      goal TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_copilot_plans_user ON copilot_plans(user_id, status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS copilot_plan_steps (
      plan_id TEXT NOT NULL,
      n INTEGER NOT NULL,
      title TEXT NOT NULL,
      hint TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      ts TEXT NOT NULL,
      PRIMARY KEY (plan_id, n)
    );
  `;

function ensurePlanBaseSchema(sqlite) {
  sqlite.exec(PLAN_BASE_DDL);
  // PLAN_CHAT_LINK_v1 additive 列（运行时迁移，与 ai-bridge 原逻辑同语义）
  try {
    sqlite.exec('ALTER TABLE copilot_plans ADD COLUMN chat_context_excerpt TEXT');
  } catch {
    /* exists */
  }
}

// BLOCK-55 P1/P2/P3 additive DDL —— ai-bridge 运行时迁移与本包测试共用同一
// 事实源（测试库从 src/migrations 自举，不含 ai-bridge 的运行时迁移）。
const BLOCK55_PLAN_DDL = [
  'ALTER TABLE copilot_plans ADD COLUMN spec_md TEXT',
  'ALTER TABLE copilot_plan_steps ADD COLUMN assignee TEXT',
  `CREATE TABLE IF NOT EXISTS copilot_plan_revisions (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      rev_no INTEGER NOT NULL,
      reason TEXT,
      proposed_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL,
      applied_at TEXT
    )`,
  'CREATE INDEX IF NOT EXISTS idx_copilot_plan_revisions_plan ON copilot_plan_revisions(plan_id, rev_no)',
];

function ensureBlock55PlanSchema(sqlite) {
  for (const stmt of BLOCK55_PLAN_DDL) {
    try {
      sqlite.exec(stmt);
    } catch {
      /* exists */
    }
  }
}

const APPROVE_ACTIONS = new Set(['execute', 'execute-fresh', 'keep-planning']);

/**
 * BLOCK-55 P1 — 批准三选一。
 * @param {string} userId
 * @param {string} planId
 * @param {'execute'|'execute-fresh'|'keep-planning'} action
 *   - execute        批准并执行（draft → approved，当前上下文继续）
 *   - execute-fresh  批准并清上下文执行（draft → approved，前端仅发 spec 自包含首 turn）
 *   - keep-planning  继续留在计划模式（状态不动，前端收起弹层）
 * @returns {Promise<{ok: true, plan: object, action: string}|{ok: false, error: string, message?: string}>}
 */
async function approvePlanDraft(db, userId, planId, action) {
  if (!APPROVE_ACTIONS.has(action)) {
    return { ok: false, error: 'invalid_action', message: 'action 仅支持 execute / execute-fresh / keep-planning' };
  }
  const plan = await db
    .prepare('SELECT * FROM copilot_plans WHERE id=? AND user_id=?')
    .get(planId, userId);
  if (!plan) return { ok: false, error: 'plan_not_found' };
  if (action === 'keep-planning') {
    return { ok: true, action, plan };
  }
  if (plan.status !== 'draft') {
    return { ok: false, error: 'plan_not_draft', message: '仅 draft 态计划需要批准。' };
  }
  await db
    .prepare('UPDATE copilot_plans SET status=?, updated_at=? WHERE id=? AND user_id=?')
    .run('approved', new Date().toISOString(), planId, userId);
  const steps = await db
    .prepare('SELECT * FROM copilot_plan_steps WHERE plan_id=? ORDER BY n ASC')
    .all(planId);
  return {
    ok: true,
    action,
    plan: { ...plan, status: 'approved', steps },
  };
}

/**
 * BLOCK-55 P3 — 应用修订案：用提议步骤整体替换当前步骤表，历史留存于修订记录。
 * 提议步骤自带动 status（模型应把已完成的步骤原样保留为 done 以延续进度）。
 * @returns {Promise<{ok: true, plan: object, revNo: number}|{ok: false, error: string, message?: string}>}
 */
async function applyPlanRevision(db, userId, planId, revNo) {
  const plan = await db
    .prepare('SELECT * FROM copilot_plans WHERE id=? AND user_id=?')
    .get(planId, userId);
  if (!plan) return { ok: false, error: 'plan_not_found' };
  const rev = await db
    .prepare('SELECT * FROM copilot_plan_revisions WHERE plan_id=? AND rev_no=?')
    .get(planId, revNo);
  if (!rev) return { ok: false, error: 'revision_not_found' };
  if (rev.status !== 'proposed') {
    return { ok: false, error: 'revision_not_proposed', message: '该修订案已应用或已作废。' };
  }
  let proposed;
  try {
    proposed = JSON.parse(rev.proposed_json);
  } catch {
    return { ok: false, error: 'revision_json_corrupt' };
  }
  if (!Array.isArray(proposed) || proposed.length === 0) {
    return { ok: false, error: 'revision_empty' };
  }
  const now = new Date().toISOString();
  await db.prepare('DELETE FROM copilot_plan_steps WHERE plan_id=?').run(planId);
  const insert = await db.prepare(
    'INSERT INTO copilot_plan_steps(plan_id, n, title, hint, assignee, status, result, ts) VALUES (?,?,?,?,?,?,?,?)'
  );
  for (const s of proposed) {
    await insert.run(
      planId,
      s.n,
      s.title,
      s.hint || null,
      s.assignee || null,
      s.status || 'pending',
      s.result || null,
      now
    );
  }
  await db
    .prepare('UPDATE copilot_plan_revisions SET status=?, applied_at=? WHERE id=?')
    .run('applied', now, rev.id);
  await db.prepare('UPDATE copilot_plans SET updated_at=? WHERE id=?').run(now, planId);
  const steps = await db
    .prepare('SELECT * FROM copilot_plan_steps WHERE plan_id=? ORDER BY n ASC')
    .all(planId);
  return { ok: true, revNo, plan: { ...plan, steps } };
}

module.exports = {
  approvePlanDraft,
  applyPlanRevision,
  APPROVE_ACTIONS,
  ensurePlanBaseSchema,
  ensureBlock55PlanSchema,
};
