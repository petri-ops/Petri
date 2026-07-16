/**
 * helpers/plans.js — PLAN_TOOL_v1 (active plan helpers)
 *
 * Extracted from server.js. Pure module: depends only on ../db.
 *
 * Public API:
 *   syncPlanStepStatusFromAnalysis(analysisId, newStatus, errorText)
 *   syncPlanStepStatusFromToolJob(toolJobId, newStatus, errorText)   方案 C：bulk 工具
 *   getActivePlanForUserAsync(userId, conversationId) → Promise<plan|null>  (with .steps)
 *   getActivePlanForUser(userId, conversationId)      → plan|null  (sync fallback)
 *   renderActivePlanForPrompt(plan) → string
 *
 * 2026-06-09: async DB (getAsyncDbForLegacyModules) — no deasync on ECS platform.
 */

const dbMod = require('../db');

// Local sqlite reference for sync methods
let _sqlite = null;
function _getSqlite() {
  if (!_sqlite) _sqlite = dbMod.getSqliteForLegacyModules();
  return _sqlite;
}

// PLAN_STEP_LINK_v1 migration (idempotent)
try {
  _getSqlite().exec('ALTER TABLE copilot_plan_steps ADD COLUMN analysis_id TEXT');
} catch {}
// PLAN_CONV_LINK_v1 migration
try {
  _getSqlite().exec('ALTER TABLE copilot_plans ADD COLUMN conversation_id TEXT');
} catch {}
// PLAN_TOOL_JOB_LINK_v1 migration（方案 C：bulk 工具走 tool_jobs，平行 analysis_id）
try {
  _getSqlite().exec('ALTER TABLE copilot_plan_steps ADD COLUMN tool_job_id TEXT');
} catch {}

function syncPlanStepStatusFromAnalysis(analysisId, newStatus, errorText) {
  if (!analysisId) return;
  let stepStatus = null;
  if (newStatus === 'done') stepStatus = 'done';
  else if (newStatus === 'failed') stepStatus = 'failed';
  else if (newStatus === 'running' || newStatus === 'pending' || newStatus === 'queued')
    stepStatus = 'running';
  if (!stepStatus) return;
  const sqlite = _getSqlite();
  try {
    const rows = sqlite
      .prepare('SELECT plan_id, n FROM copilot_plan_steps WHERE analysis_id=?')
      .all(analysisId);
    for (const r of rows) {
      const result =
        stepStatus === 'failed' && errorText
          ? '任务失败：' + String(errorText).slice(0, 300)
          : stepStatus === 'done'
            ? '任务完成'
            : null;
      if (result) {
        sqlite
          .prepare('UPDATE copilot_plan_steps SET status=?, result=?, ts=? WHERE plan_id=? AND n=?')
          .run(stepStatus, result, new Date().toISOString(), r.plan_id, r.n);
      } else {
        sqlite
          .prepare('UPDATE copilot_plan_steps SET status=?, ts=? WHERE plan_id=? AND n=?')
          .run(stepStatus, new Date().toISOString(), r.plan_id, r.n);
      }
      sqlite
        .prepare('UPDATE copilot_plans SET updated_at=? WHERE id=?')
        .run(new Date().toISOString(), r.plan_id);
      const cnt = sqlite
        .prepare(
          `SELECT COUNT(*) AS total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done FROM copilot_plan_steps WHERE plan_id=?`
        )
        .get(r.plan_id);
      if (cnt && cnt.total > 0 && cnt.total === cnt.done) {
        sqlite
          .prepare('UPDATE copilot_plans SET status=?, updated_at=? WHERE id=?')
          .run('completed', new Date().toISOString(), r.plan_id);
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * 方案 C（agent-led Task 2）：bulk 工具走 tool_jobs 表，plan step 关联 tool_job_id。
 * 镜像 syncPlanStepStatusFromAnalysis，查 tool_job_id 列同步 step 状态。
 * tool_jobs.status 值：running/completed/failed → 映射 step: running/done/failed。
 */
function syncPlanStepStatusFromToolJob(toolJobId, newStatus, errorText) {
  if (!toolJobId) return;
  let stepStatus = null;
  if (newStatus === 'completed') stepStatus = 'done';
  else if (newStatus === 'failed') stepStatus = 'failed';
  else if (newStatus === 'running' || newStatus === 'pending') stepStatus = 'running';
  if (!stepStatus) return;
  const sqlite = _getSqlite();
  try {
    const rows = sqlite
      .prepare('SELECT plan_id, n FROM copilot_plan_steps WHERE tool_job_id=?')
      .all(toolJobId);
    for (const r of rows) {
      const result =
        stepStatus === 'failed' && errorText
          ? '任务失败：' + String(errorText).slice(0, 300)
          : stepStatus === 'done'
            ? '任务完成'
            : null;
      if (result) {
        sqlite
          .prepare('UPDATE copilot_plan_steps SET status=?, result=?, ts=? WHERE plan_id=? AND n=?')
          .run(stepStatus, result, new Date().toISOString(), r.plan_id, r.n);
      } else {
        sqlite
          .prepare('UPDATE copilot_plan_steps SET status=?, ts=? WHERE plan_id=? AND n=?')
          .run(stepStatus, new Date().toISOString(), r.plan_id, r.n);
      }
      sqlite
        .prepare('UPDATE copilot_plans SET updated_at=? WHERE id=?')
        .run(new Date().toISOString(), r.plan_id);
      const cnt = sqlite
        .prepare(
          `SELECT COUNT(*) AS total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done FROM copilot_plan_steps WHERE plan_id=?`
        )
        .get(r.plan_id);
      if (cnt && cnt.total > 0 && cnt.total === cnt.done) {
        sqlite
          .prepare('UPDATE copilot_plans SET status=?, updated_at=? WHERE id=?')
          .run('completed', new Date().toISOString(), r.plan_id);
      }
    }
  } catch {
    /* ignore */
  }
}

/** Async version — preferred on ECS platform. */
async function getActivePlanForUserAsync(userId, conversationId) {
  if (!userId) return null;
  const adb = dbMod.getAsyncDbForLegacyModules();
  try {
    let plan = null;
    if (conversationId) {
      plan = await adb
        .prepare(
          `SELECT * FROM copilot_plans WHERE user_id = $1 AND conversation_id = $2 AND status IN ('active','paused') ORDER BY updated_at DESC LIMIT 1`
        )
        .get(userId, conversationId);
    }
    if (!plan) {
      plan = await adb
        .prepare(
          `SELECT * FROM copilot_plans WHERE user_id = $1 AND (conversation_id IS NULL OR conversation_id = $2) AND status IN ('active','paused') ORDER BY updated_at DESC LIMIT 1`
        )
        .get(userId, conversationId || '');
    }
    if (!plan) return null;
    const steps = await adb
      .prepare('SELECT * FROM copilot_plan_steps WHERE plan_id = $1 ORDER BY n ASC')
      .all(plan.id);
    return { ...plan, steps };
  } catch (e) {
    console.log('[plans] getActivePlanForUserAsync err:', e.message);
    return null;
  }
}

/** Sync fallback — used on Dell (non-PG path). */
function getActivePlanForUser(userId, conversationId) {
  const sqlite = _getSqlite();
  let plan = null;
  if (conversationId) {
    plan = sqlite
      .prepare(
        `SELECT * FROM copilot_plans WHERE user_id=? AND conversation_id=? AND status IN ('active','paused') ORDER BY updated_at DESC LIMIT 1`
      )
      .get(userId, conversationId);
  }
  if (!plan) {
    plan = sqlite
      .prepare(
        `SELECT * FROM copilot_plans WHERE user_id=? AND (conversation_id IS NULL OR conversation_id=?) AND status IN ('active','paused') ORDER BY updated_at DESC LIMIT 1`
      )
      .get(userId, conversationId || '');
  }
  if (!plan) return null;
  const steps = sqlite
    .prepare('SELECT * FROM copilot_plan_steps WHERE plan_id=? ORDER BY n ASC')
    .all(plan.id);
  return { ...plan, steps };
}

function renderActivePlanForPrompt(plan) {
  if (!plan) return '';
  const stepLines = (plan.steps || [])
    .map((s) => {
      const mark =
        s.status === 'done'
          ? '✓'
          : s.status === 'running'
            ? '▶'
            : s.status === 'failed'
              ? '✗'
              : s.status === 'skipped'
                ? '⊘'
                : '○';
      let line = '  ' + mark + ' ' + s.n + '. ' + s.title;
      if (s.hint) line += '  [hint: ' + s.hint.slice(0, 80) + ']';
      if (s.result) line += '  → ' + s.result.slice(0, 80);
      return line;
    })
    .join('\n');
  return (
    '\n\n=== 当前进行中的 Plan ===' +
    '\n标题: ' +
    plan.title +
    (plan.goal ? '\n目标: ' + plan.goal : '') +
    '\n状态: ' +
    plan.status +
    '\n步骤:\n' +
    stepLines +
    '\n\n注：用户可能直接要求"继续"或"做下一步"——这时找到第一个 status=pending 的步骤推进，' +
    '完成后用 plan(op=update_step, planId, stepN, stepStatus="done", stepResult="...") 更新状态。'
  );
}

async function syncPlanStepStatusFromAnalysisAsync(analysisId, newStatus, errorText) {
  if (!analysisId) return;
  let stepStatus = null;
  if (newStatus === 'done') stepStatus = 'done';
  else if (newStatus === 'failed') stepStatus = 'failed';
  else if (newStatus === 'running' || newStatus === 'pending' || newStatus === 'queued')
    stepStatus = 'running';
  if (!stepStatus) return;
  const adb = dbMod.getAsyncDbForLegacyModules();
  try {
    const rows = await adb
      .prepare('SELECT plan_id, n FROM copilot_plan_steps WHERE analysis_id=?')
      .all(analysisId);
    for (const r of rows) {
      const result =
        stepStatus === 'failed' && errorText
          ? '任务失败：' + String(errorText).slice(0, 300)
          : stepStatus === 'done'
            ? '任务完成'
            : null;
      if (result) {
        await adb
          .prepare('UPDATE copilot_plan_steps SET status=?, result=?, ts=? WHERE plan_id=? AND n=?')
          .run(stepStatus, result, new Date().toISOString(), r.plan_id, r.n);
      } else {
        await adb
          .prepare('UPDATE copilot_plan_steps SET status=?, ts=? WHERE plan_id=? AND n=?')
          .run(stepStatus, new Date().toISOString(), r.plan_id, r.n);
      }
      await adb
        .prepare('UPDATE copilot_plans SET updated_at=? WHERE id=?')
        .run(new Date().toISOString(), r.plan_id);
      const cnt = await adb
        .prepare(
          `SELECT COUNT(*) AS total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done FROM copilot_plan_steps WHERE plan_id=?`
        )
        .get(r.plan_id);
      if (cnt && cnt.total > 0 && cnt.total === cnt.done) {
        await adb
          .prepare('UPDATE copilot_plans SET status=?, updated_at=? WHERE id=?')
          .run('completed', new Date().toISOString(), r.plan_id);
      }
    }
  } catch {
    /* ignore */
  }
}

/** Async version of syncPlanStepStatusFromToolJob — preferred on ECS platform. */
async function syncPlanStepStatusFromToolJobAsync(toolJobId, newStatus, errorText) {
  if (!toolJobId) return;
  let stepStatus = null;
  if (newStatus === 'completed') stepStatus = 'done';
  else if (newStatus === 'failed') stepStatus = 'failed';
  else if (newStatus === 'running' || newStatus === 'pending') stepStatus = 'running';
  if (!stepStatus) return;
  const adb = dbMod.getAsyncDbForLegacyModules();
  try {
    const rows = await adb
      .prepare('SELECT plan_id, n FROM copilot_plan_steps WHERE tool_job_id=?')
      .all(toolJobId);
    for (const r of rows) {
      const result =
        stepStatus === 'failed' && errorText
          ? '任务失败：' + String(errorText).slice(0, 300)
          : stepStatus === 'done'
            ? '任务完成'
            : null;
      if (result) {
        await adb
          .prepare('UPDATE copilot_plan_steps SET status=?, result=?, ts=? WHERE plan_id=? AND n=?')
          .run(stepStatus, result, new Date().toISOString(), r.plan_id, r.n);
      } else {
        await adb
          .prepare('UPDATE copilot_plan_steps SET status=?, ts=? WHERE plan_id=? AND n=?')
          .run(stepStatus, new Date().toISOString(), r.plan_id, r.n);
      }
      await adb
        .prepare('UPDATE copilot_plans SET updated_at=? WHERE id=?')
        .run(new Date().toISOString(), r.plan_id);
      const cnt = await adb
        .prepare(
          `SELECT COUNT(*) AS total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done FROM copilot_plan_steps WHERE plan_id=?`
        )
        .get(r.plan_id);
      if (cnt && cnt.total > 0 && cnt.total === cnt.done) {
        await adb
          .prepare('UPDATE copilot_plans SET status=?, updated_at=? WHERE id=?')
          .run('completed', new Date().toISOString(), r.plan_id);
      }
    }
  } catch {
    /* ignore */
  }
}

module.exports = {
  syncPlanStepStatusFromAnalysis,
  syncPlanStepStatusFromAnalysisAsync,
  syncPlanStepStatusFromToolJob,
  syncPlanStepStatusFromToolJobAsync,
  getActivePlanForUserAsync,
  getActivePlanForUser,
  renderActivePlanForPrompt,
};
