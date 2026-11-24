'use strict';

/**
 * helpers/automation-store.js — Q7（BLOCK-256）目标与定时任务的持久层。
 *
 * 单一真相：
 *   - goal 用量来自真实 ai_usage（goal 会话 + goal 关联的定时运行会话），不另造计数器；
 *   - schedule 只存计划与运行索引，真正执行仍走 POST /api/ai/agent（不建第二执行器）；
 *   - reminder 只写本地提醒行，由前端通知中心消费。
 *
 * 表在本模块加载时幂等创建；copilot_conversations.goal_id 是 additive 列。
 */

const crypto = require('node:crypto');
const dbMod = require('../db');
const cronSchedule = require('./cron-schedule');

let _sqlite = null;
function db() {
  if (!_sqlite) {
    _sqlite = typeof dbMod.getDatabase === 'function' ? dbMod.getDatabase() : dbMod.db;
  }
  if (!_sqlite) throw new Error('automation database unavailable');
  return _sqlite;
}

function ensureSchema() {
  const sqlite = db();
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_goals (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      project_id TEXT NOT NULL,
      conversation_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      budget_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_goals_project ON agent_goals(project_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS agent_schedules (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      project_id TEXT NOT NULL,
      goal_id TEXT,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'task',
      interval_minutes INTEGER NOT NULL DEFAULT 60,
      reminder_text TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at TEXT NOT NULL,
      last_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_schedules_due ON agent_schedules(enabled, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_agent_schedules_project ON agent_schedules(project_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS agent_schedule_runs (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL,
      task_id TEXT,
      conversation_id TEXT,
      status TEXT NOT NULL,
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_schedule_runs_schedule ON agent_schedule_runs(schedule_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS agent_schedule_reminders (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      message TEXT NOT NULL,
      due_at TEXT NOT NULL,
      acknowledged_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_schedule_reminders_due ON agent_schedule_reminders(project_id, acknowledged_at, due_at DESC);
  `);
  try { sqlite.exec('ALTER TABLE copilot_conversations ADD COLUMN goal_id TEXT'); } catch { /* exists */ }
  // NEXT-01 — workflow schedule 持久脚本/args；运行行关联 workflowRunId
  try { sqlite.exec('ALTER TABLE agent_schedules ADD COLUMN workflow_script TEXT'); } catch { /* exists */ }
  try { sqlite.exec('ALTER TABLE agent_schedules ADD COLUMN workflow_args_json TEXT'); } catch { /* exists */ }
  // BLOCK-514 — Q7 cron+时区+失败退避+overlap 可配置（additive；旧数据零迁移零行为变化）
  try { sqlite.exec('ALTER TABLE agent_schedules ADD COLUMN cron_expr TEXT'); } catch { /* exists */ }
  try { sqlite.exec('ALTER TABLE agent_schedules ADD COLUMN tz_offset_minutes INTEGER'); } catch { /* exists */ }
  try { sqlite.exec('ALTER TABLE agent_schedules ADD COLUMN retry_backoff TEXT'); } catch { /* exists */ }
  try { sqlite.exec('ALTER TABLE agent_schedules ADD COLUMN overlap_policy TEXT'); } catch { /* exists */ }
  try { sqlite.exec('ALTER TABLE agent_schedules ADD COLUMN auto_mode TEXT'); } catch { /* exists */ }
  try { sqlite.exec('ALTER TABLE agent_schedules ADD COLUMN auto_tool_allowlist TEXT'); } catch { /* exists */ }
  try { sqlite.exec('ALTER TABLE agent_schedules ADD COLUMN auto_budget_checked INTEGER'); } catch { /* exists */ }
  try { sqlite.exec('ALTER TABLE agent_schedule_runs ADD COLUMN workflow_run_id TEXT'); } catch { /* exists */ }
}

ensureSchema();

const GOAL_STATUSES = new Set(['active', 'paused', 'completed', 'blocked']);
const GOAL_TRANSITIONS = Object.freeze({
  active: new Set(['paused', 'completed', 'blocked']),
  paused: new Set(['active', 'completed']),
  blocked: new Set(['active', 'completed']),
  completed: new Set(['active']),
});
const SCHEDULE_KINDS = new Set(['task', 'reminder', 'workflow']);
const RUN_STATUSES = new Set(['queued', 'running', 'completed', 'failed', 'reminder', 'skipped_budget', 'skipped_goal']);

function nowIso() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function clampString(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function nonNegativeInt(value, max = 1_000_000_000) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(max, Math.round(number));
}
function parseRow(row) {
  return row ? { ...row } : null;
}

// ── Goals ─────────────────────────────────────────────────────
function usageTokensForGoal(goal) {
  if (!goal) return 0;
  const sqlite = db();
  const convIds = new Set();
  if (goal.conversation_id) convIds.add(goal.conversation_id);
  try {
    const linked = sqlite.prepare('SELECT id FROM copilot_conversations WHERE goal_id=?').all(goal.id);
    for (const row of linked) if (row && row.id) convIds.add(row.id);
  } catch { /* goal_id 列可能尚未迁移：退回 goal 会话口径 */ }
  if (convIds.size === 0) return 0;
  const ids = [...convIds];
  const placeholders = ids.map(() => '?').join(',');
  try {
    const row = sqlite.prepare(
      `SELECT COALESCE(SUM(prompt_tokens),0) + COALESCE(SUM(completion_tokens),0) AS tokens
         FROM ai_usage WHERE conversation_id IN (${placeholders})`,
    ).get(...ids);
    return nonNegativeInt(row && row.tokens);
  } catch {
    return 0;
  }
}

function goalView(goal) {
  if (!goal) return null;
  const usageTokens = usageTokensForGoal(goal);
  const budgetTokens = nonNegativeInt(goal.budget_tokens);
  const ratio = budgetTokens > 0 ? usageTokens / budgetTokens : 0;
  const created = Date.parse(goal.created_at);
  const ended = goal.completed_at ? Date.parse(goal.completed_at) : Date.now();
  return {
    ...goal,
    status: goal.status,
    usageTokens,
    budgetTokens,
    usagePct: budgetTokens > 0 ? Math.min(1, ratio) : 0,
    remainingTokens: budgetTokens > 0 ? Math.max(0, budgetTokens - usageTokens) : null,
    usageLimited: budgetTokens > 0 && ratio >= 0.8,
    budgetLimited: budgetTokens > 0 && usageTokens >= budgetTokens,
    elapsedMs: Number.isFinite(created) ? Math.max(0, ended - created) : 0,
  };
}

function createGoal({ userId = null, projectId, conversationId = null, title, description = '', budgetTokens = 0 } = {}) {
  const pid = clampString(projectId, 120);
  const goalTitle = clampString(title, 120);
  if (!pid) return { ok: false, error: 'missing_projectId', message: '目标必须绑定项目（projectId）。' };
  if (!goalTitle) return { ok: false, error: 'missing_title', message: '缺少目标标题。' };
  const id = newId('goal');
  const now = nowIso();
  db().prepare(`INSERT INTO agent_goals
    (id,user_id,project_id,conversation_id,title,description,status,budget_tokens,created_at,updated_at,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,NULL)`)
    .run(id, userId || null, pid, conversationId || null, goalTitle, clampString(description, 2000), 'active',
      nonNegativeInt(budgetTokens), now, now);
  return { ok: true, goal: goalView(getGoalRow(id)) };
}

function getGoalRow(id) {
  return parseRow(db().prepare('SELECT * FROM agent_goals WHERE id=?').get(String(id || '')));
}

function getGoal({ id, userId = null } = {}) {
  const row = getGoalRow(id);
  if (!row) return { ok: false, error: 'goal_not_found', message: '目标不存在。' };
  if (userId && row.user_id && row.user_id !== userId) return { ok: false, error: 'goal_not_found', message: '目标不存在。' };
  return { ok: true, goal: goalView(row) };
}

function listGoals({ projectId, userId = null, limit = 50 } = {}) {
  const pid = clampString(projectId, 120);
  if (!pid) return { ok: false, error: 'missing_projectId', message: '需要 projectId。' };
  const rows = userId
    ? db().prepare('SELECT * FROM agent_goals WHERE project_id=? AND (user_id IS NULL OR user_id=?) ORDER BY updated_at DESC LIMIT ?').all(pid, userId, Math.min(100, Math.max(1, Number(limit) || 50)))
    : db().prepare('SELECT * FROM agent_goals WHERE project_id=? ORDER BY updated_at DESC LIMIT ?').all(pid, Math.min(100, Math.max(1, Number(limit) || 50)));
  return { ok: true, goals: rows.map(goalView) };
}

function updateGoal({ id, userId = null, status, title, description, budgetTokens } = {}) {
  const row = getGoalRow(id);
  if (!row) return { ok: false, error: 'goal_not_found', message: '目标不存在。' };
  if (userId && row.user_id && row.user_id !== userId) return { ok: false, error: 'goal_not_found', message: '目标不存在。' };
  const sets = [];
  const values = [];
  if (status !== undefined) {
    const next = String(status || '');
    if (!GOAL_STATUSES.has(next)) return { ok: false, error: 'invalid_status', message: `status 必须是 ${[...GOAL_STATUSES].join(' / ')}。` };
    if (next !== row.status && !GOAL_TRANSITIONS[row.status]?.has(next)) {
      return { ok: false, error: 'invalid_transition', message: `目标不能从 ${row.status} 迁移到 ${next}。` };
    }
    sets.push('status=?'); values.push(next);
    if (next === 'completed') { sets.push('completed_at=?'); values.push(nowIso()); }
    if (next === 'active' && row.status === 'completed') { sets.push('completed_at=NULL'); }
  }
  if (title !== undefined) {
    const clean = clampString(title, 120);
    if (!clean) return { ok: false, error: 'missing_title', message: '标题不能为空。' };
    sets.push('title=?'); values.push(clean);
  }
  if (description !== undefined) { sets.push('description=?'); values.push(clampString(description, 2000)); }
  if (budgetTokens !== undefined) { sets.push('budget_tokens=?'); values.push(nonNegativeInt(budgetTokens)); }
  if (sets.length === 0) return { ok: true, goal: goalView(row) };
  sets.push('updated_at=?'); values.push(nowIso()); values.push(row.id);
  db().prepare(`UPDATE agent_goals SET ${sets.join(', ')} WHERE id=?`).run(...values);
  return { ok: true, goal: goalView(getGoalRow(row.id)) };
}

// ── Schedules ─────────────────────────────────────────────────
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 10080;

function scheduleView(row, { includeRuns = false } = {}) {
  if (!row) return null;
  const lastRun = db().prepare('SELECT * FROM agent_schedule_runs WHERE schedule_id=? ORDER BY started_at DESC LIMIT 1').get(row.id) || null;
  const goal = row.goal_id ? goalView(getGoalRow(row.goal_id)) : null;
  const { workflow_script: workflowScript, workflow_args_json: workflowArgsJson, ...publicRow } = row;
  const view = {
    ...parseRow(publicRow),
    hasWorkflowScript: Boolean(workflowScript),
    hasWorkflowArgs: Boolean(workflowArgsJson),
    enabled: Boolean(row.enabled),
    goal: goal ? { id: goal.id, title: goal.title, status: goal.status, budgetLimited: goal.budgetLimited, usageLimited: goal.usageLimited } : null,
    lastRun: lastRun ? { ...lastRun } : null,
  };
  if (includeRuns) {
    view.runs = listRunsForSchedule(row.id, 10);
  }
  return view;
}

function createSchedule({
  userId = null,
  projectId,
  goalId = null,
  title,
  prompt = '',
  kind = 'task',
  intervalMinutes = null,
  reminderText = '',
  workflowScript = '',
  workflowArgs = null,
  enabled = true,
  cronExpr = null,
  tzOffsetMinutes = 0,
  retryBackoff = 'none',
  overlapPolicy = 'skip',
  autoMode: autoModeParam = 'guided',
  autoToolAllowlist = null,
} = {}) {
  const pid = clampString(projectId, 120);
  if (!pid) return { ok: false, error: 'missing_projectId', message: '定时任务必须绑定项目（projectId）。' };
  const scheduleKind = String(kind || 'task');
  if (!SCHEDULE_KINDS.has(scheduleKind)) return { ok: false, error: 'invalid_kind', message: 'kind 必须是 task、reminder 或 workflow。' };
  // BLOCK-514 — cron 表达式（提供时二选一优先生效；interval 仍保留作退避基值）
  let cleanCronExpr = null;
  let tzMinutes = 0;
  if (cronExpr !== null && cronExpr !== undefined && String(cronExpr).trim() !== '') {
    const parsed = cronSchedule.parseCron(String(cronExpr));
    if (!parsed.ok) return { ok: false, error: parsed.code, message: parsed.message };
    cleanCronExpr = String(cronExpr).trim().replace(/\s+/g, ' ');
    tzMinutes = Number(tzOffsetMinutes) || 0;
    if (!Number.isInteger(tzMinutes) || tzMinutes < -840 || tzMinutes > 840) {
      return { ok: false, error: 'invalid_timezone', message: 'tzOffsetMinutes 必须是 -840–840 的整数分钟。' };
    }
  } else if (intervalMinutes === undefined || intervalMinutes === null) {
    // 无 cron 且未显式给 interval → 拒绝（二选一），不再静默回默认 60
    return { ok: false, error: 'missing_schedule', message: 'intervalMinutes 与 cronExpr 至少提供一个。' };
  }
  // BLOCK-515 — 唤醒 trusted 档校验（fail-closed）：①非空白名单 ②每个工具名都在
  // registry 内置声明面（未知拒绝）③绑定带预算的 active goal（预算硬顶=既有 goalGate，
  // 保守值复用已验证机制）；撤回=清空白名单/auto_mode 回 guided（显式可审计可撤回）。
  const autoMode = autoModeParam === 'trusted' ? 'trusted' : 'guided';
  let cleanAutoAllowlist = null;
  let autoBudgetChecked = 0;
  if (autoMode === 'trusted') {
    const allowlist = Array.isArray(autoToolAllowlist) ? autoToolAllowlist : null;
    if (!allowlist || allowlist.length === 0) {
      return { ok: false, error: 'auto_allowlist_missing', message: 'trusted 档必须提供非空 autoToolAllowlist（白名单外一律硬拒绝）。' };
    }
    const known = builtinToolNameSet();
    const unknown = allowlist.filter((n) => !known.has(String(n)));
    if (unknown.length > 0) {
      return { ok: false, error: 'unknown_tool_allowlist', message: '白名单含未注册工具名：' + unknown.join(', ') + '。' };
    }
    if (!goalId) {
      return { ok: false, error: 'auto_budget_missing', message: 'trusted 档必须绑定 goal（带预算）——预算硬顶由既有 goalGate 机制执行。' };
    }
    cleanAutoAllowlist = JSON.stringify(allowlist.map((n) => String(n)));
    autoBudgetChecked = 1;
  }
  const backoff = retryBackoff === 'exponential' ? 'exponential' : 'none';
  const overlap = overlapPolicy === 'queue' ? 'queue' : 'skip';
  const minutes = Number(intervalMinutes === undefined || intervalMinutes === null ? 60 : intervalMinutes);
  if (!Number.isFinite(minutes) || minutes < MIN_INTERVAL_MINUTES || minutes > MAX_INTERVAL_MINUTES) {
    return { ok: false, error: 'invalid_interval', message: `间隔必须在 ${MIN_INTERVAL_MINUTES}–${MAX_INTERVAL_MINUTES} 分钟。` };
  }
  const cleanPrompt = clampString(prompt, 8000);
  const cleanReminder = clampString(reminderText, 500);
  if (scheduleKind === 'task' && !cleanPrompt) return { ok: false, error: 'missing_prompt', message: '任务型定时计划需要 prompt。' };
  if (scheduleKind === 'reminder' && !cleanReminder) return { ok: false, error: 'missing_reminder', message: '提醒型计划需要 reminderText。' };
  let cleanWorkflowScript = '';
  let workflowArgsJson = null;
  if (scheduleKind === 'workflow') {
    cleanWorkflowScript = typeof workflowScript === 'string' ? workflowScript.trim() : '';
    if (!cleanWorkflowScript) return { ok: false, error: 'missing_workflow_script', message: 'workflow 型定时计划需要 workflowScript。' };
    if (cleanWorkflowScript.length > 256 * 1024) return { ok: false, error: 'workflow_script_too_large', message: 'workflowScript 超过 256KB。' };
    const loaded = require('./workflow-sandbox').loadWorkflowModule(cleanWorkflowScript, { host: {}, seed: 0 });
    if (!loaded.ok) return { ok: false, error: loaded.error, message: loaded.message || (loaded.diagnostics || []).join('; ') };
    try {
      const serialized = workflowArgs === null || workflowArgs === undefined ? null : JSON.stringify(workflowArgs);
      if (serialized && serialized.length > 32 * 1024) return { ok: false, error: 'workflow_args_too_large', message: 'workflowArgs 超过 32KB。' };
      workflowArgsJson = serialized;
    } catch {
      return { ok: false, error: 'workflow_args_invalid', message: 'workflowArgs 必须可序列化为 JSON。' };
    }
  }
  const goal = goalId ? getGoalRow(goalId) : null;
  if (goalId && !goal) return { ok: false, error: 'goal_not_found', message: '关联目标不存在。' };
  const id = newId('sch');
  const now = new Date();
  const next = new Date(now.getTime() + Math.round(minutes) * 60_000).toISOString();
  const titleClean = clampString(title, 120)
    || (scheduleKind === 'reminder' ? cleanReminder : scheduleKind === 'workflow' ? '工作流' : cleanPrompt).slice(0, 80)
    || '定时任务';
  db().prepare(`INSERT INTO agent_schedules
    (id,user_id,project_id,goal_id,title,prompt,kind,interval_minutes,reminder_text,workflow_script,workflow_args_json,enabled,next_run_at,last_run_at,created_at,updated_at,cron_expr,tz_offset_minutes,retry_backoff,overlap_policy,auto_mode,auto_tool_allowlist,auto_budget_checked)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?)`)
    .run(id, userId || null, pid, goal ? goal.id : null, titleClean, cleanPrompt, scheduleKind,
      Math.round(minutes), cleanReminder || null, cleanWorkflowScript || null, workflowArgsJson,
      enabled ? 1 : 0, enabled ? next : next, now.toISOString(), now.toISOString(),
      cleanCronExpr, cleanCronExpr ? tzMinutes : null, backoff, overlap,
      autoMode, cleanAutoAllowlist, autoBudgetChecked);
  return { ok: true, schedule: scheduleView(getScheduleRow(id)) };
}

function getScheduleRow(id) {
  return parseRow(db().prepare('SELECT * FROM agent_schedules WHERE id=?').get(String(id || '')));
}

function getSchedule(id) {
  return getScheduleRow(id);
}

function listSchedules({ projectId, userId = null } = {}) {
  const pid = clampString(projectId, 120);
  if (!pid) return { ok: false, error: 'missing_projectId', message: '需要 projectId。' };
  const rows = userId
    ? db().prepare('SELECT * FROM agent_schedules WHERE project_id=? AND (user_id IS NULL OR user_id=?) ORDER BY updated_at DESC LIMIT 100').all(pid, userId)
    : db().prepare('SELECT * FROM agent_schedules WHERE project_id=? ORDER BY updated_at DESC LIMIT 100').all(pid);
  return { ok: true, schedules: rows.map((row) => scheduleView(row)) };
}

function setScheduleEnabled({ id, enabled, userId = null } = {}) {
  const row = getScheduleRow(id);
  if (!row) return { ok: false, error: 'schedule_not_found', message: '定时计划不存在。' };
  if (userId && row.user_id && row.user_id !== userId) return { ok: false, error: 'schedule_not_found', message: '定时计划不存在。' };
  const nextEnabled = Boolean(enabled);
  const nextRun = nextEnabled && !row.enabled
    ? new Date(Date.now() + row.interval_minutes * 60_000).toISOString()
    : row.next_run_at;
  db().prepare('UPDATE agent_schedules SET enabled=?, next_run_at=?, updated_at=? WHERE id=?')
    .run(nextEnabled ? 1 : 0, nextRun, nowIso(), row.id);
  return { ok: true, schedule: scheduleView(getScheduleRow(row.id)) };
}

function runScheduleNow({ id, userId = null } = {}) {
  const row = getScheduleRow(id);
  if (!row) return { ok: false, error: 'schedule_not_found', message: '定时计划不存在。' };
  if (userId && row.user_id && row.user_id !== userId) return { ok: false, error: 'schedule_not_found', message: '定时计划不存在。' };
  db().prepare('UPDATE agent_schedules SET next_run_at=?, updated_at=? WHERE id=?')
    .run(nowIso(), nowIso(), row.id);
  return { ok: true, queued: true, schedule: scheduleView(getScheduleRow(row.id)) };
}

/**
 * BLOCK-515 — 唤醒 trusted 授予/撤回的显式变更口（可审计：每次变更走本函数留 updated_at）。
 * guided=撤回（清空白名单）；trusted=按 createSchedule 同一 fail-closed 矩阵校验。
 */
function setScheduleAuto({ id, autoMode, autoToolAllowlist = null, userId = null } = {}) {
  const row = getScheduleRow(id);
  if (!row) return { ok: false, error: 'schedule_not_found', message: '定时计划不存在。' };
  if (userId && row.user_id && row.user_id !== userId) return { ok: false, error: 'schedule_not_found', message: '定时计划不存在。' };
  const mode = autoMode === 'trusted' ? 'trusted' : 'guided';
  if (mode === 'guided') {
    db().prepare('UPDATE agent_schedules SET auto_mode=?, auto_tool_allowlist=NULL, auto_budget_checked=0, updated_at=? WHERE id=?')
      .run('guided', nowIso(), row.id);
    return { ok: true, schedule: scheduleView(getScheduleRow(row.id)) };
  }
  const allowlist = Array.isArray(autoToolAllowlist) ? autoToolAllowlist : null;
  if (!allowlist || allowlist.length === 0) {
    return { ok: false, error: 'auto_allowlist_missing', message: 'trusted 档必须提供非空 autoToolAllowlist。' };
  }
  const known = builtinToolNameSet();
  const unknown = allowlist.filter((n) => !known.has(String(n)));
  if (unknown.length > 0) {
    return { ok: false, error: 'unknown_tool_allowlist', message: '白名单含未注册工具名：' + unknown.join(', ') + '。' };
  }
  const goal = row.goal_id ? getGoalRow(row.goal_id) : null;
  if (!goal || goal.status !== 'active' || !(Number(goal.budget_tokens) > 0)) {
    return { ok: false, error: 'auto_budget_missing', message: 'trusted 档必须绑定带预算的 active goal（预算硬顶）。' };
  }
  db().prepare('UPDATE agent_schedules SET auto_mode=?, auto_tool_allowlist=?, auto_budget_checked=1, updated_at=? WHERE id=?')
    .run('trusted', JSON.stringify(allowlist.map((n) => String(n))), nowIso(), row.id);
  return { ok: true, schedule: scheduleView(getScheduleRow(row.id)) };
}

function deleteSchedule({ id, userId = null } = {}) {
  const row = getScheduleRow(id);
  if (!row) return { ok: false, error: 'schedule_not_found', message: '定时计划不存在。' };
  if (userId && row.user_id && row.user_id !== userId) return { ok: false, error: 'schedule_not_found', message: '定时计划不存在。' };
  db().prepare('DELETE FROM agent_schedule_runs WHERE schedule_id=?').run(row.id);
  db().prepare('DELETE FROM agent_schedule_reminders WHERE schedule_id=?').run(row.id);
  db().prepare('DELETE FROM agent_schedules WHERE id=?').run(row.id);
  return { ok: true };
}

function listDueSchedules(now = nowIso()) {
  return db().prepare('SELECT * FROM agent_schedules WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at ASC LIMIT 20').all(now).map(parseRow);
}

function advanceSchedule(id, runAt = Date.now()) {
  const row = getScheduleRow(id);
  if (!row) return null;
  // BLOCK-514 — 失败退避自 runs 推导（最近 runs 前导 failed 段 >0 即视为失败推进），
  // 无需调用方传旗标；成功 run 落库后 streak 清零自然回 interval。
  const inferredFailed = consecutiveFailures(row.id) > 0;
  const backoffActive = inferredFailed && row.retry_backoff === 'exponential';
  let nextMs;
  if (row.cron_expr) {
    // BLOCK-514 — cron 调度：按固定偏移钟面求下一次触发
    nextMs = cronSchedule.nextFireMs({
      cron: row.cron_expr,
      fromMs: runAt,
      tzOffsetMinutes: row.tz_offset_minutes || 0,
    });
    if (backoffActive) nextMs = Math.min(runAt + backoffMs(row), nextMs);
  } else if (backoffActive) {
    // 失败指数退避：interval × 2^连续失败次数，封顶 24h
    nextMs = runAt + backoffMs(row);
  } else {
    nextMs = runAt + row.interval_minutes * 60_000;
  }
  const next = new Date(nextMs).toISOString();
  db().prepare('UPDATE agent_schedules SET next_run_at=?, last_run_at=?, updated_at=? WHERE id=?')
    .run(next, new Date(runAt).toISOString(), nowIso(), row.id);
  return getScheduleRow(id);
}

const MAX_BACKOFF_MS = 24 * 60 * 60_000;

/** 连续失败次数（最近 runs 的前导 failed 段长度）。 */
function builtinToolNames() {
  return [...builtinToolNameSet()];
}

// BLOCK-515 — registry 内置名单惰性读取（顶层 require 会与 goal-tools 形成环：
// store→agent-tools/registry→goal-tools→store，循环内 store.createGoal 尚未导出）。
function builtinToolNameSet() {
  const { listBuiltinToolNames } = require('../agent-tools/registry');
  return new Set(listBuiltinToolNames());
}

function consecutiveFailures(scheduleId) {
  const runs = db().prepare('SELECT status FROM agent_schedule_runs WHERE schedule_id=? ORDER BY started_at DESC, rowid DESC LIMIT 20')
    .all(scheduleId);
  let streak = 0;
  for (const run of runs) {
    if (run.status === 'failed') streak += 1;
    else break;
  }
  return streak;
}

/** 指数退避毫数：interval × 2^连续失败，封顶 24h。 */
function backoffMs(row) {
  const streak = consecutiveFailures(row.id);
  const base = Math.max(1, Number(row.interval_minutes) || 60) * 60_000;
  const raw = base * (2 ** Math.min(streak, 10));
  return Math.min(raw, MAX_BACKOFF_MS);
}

function createRun({
  scheduleId,
  taskId = null,
  conversationId = null,
  workflowRunId = null,
  status,
  error = null,
  startedAt = nowIso(),
} = {}) {
  const runStatus = String(status || 'queued');
  if (!RUN_STATUSES.has(runStatus)) throw new Error(`invalid run status: ${runStatus}`);
  const id = newId('run');
  db().prepare(`INSERT INTO agent_schedule_runs
    (id,schedule_id,task_id,conversation_id,workflow_run_id,status,error,started_at,finished_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, scheduleId, taskId, conversationId, workflowRunId, runStatus, error, startedAt,
      ['completed', 'failed', 'reminder', 'skipped_budget', 'skipped_goal'].includes(runStatus) ? startedAt : null);
  return db().prepare('SELECT * FROM agent_schedule_runs WHERE id=?').get(id);
}

function updateRun(id, { status, taskId, conversationId, workflowRunId, error } = {}) {
  const sets = [];
  const values = [];
  if (status !== undefined) {
    if (!RUN_STATUSES.has(status)) throw new Error(`invalid run status: ${status}`);
    sets.push('status=?'); values.push(status);
    if (['completed', 'failed', 'reminder', 'skipped_budget', 'skipped_goal'].includes(status)) {
      sets.push('finished_at=?'); values.push(nowIso());
    }
  }
  if (taskId !== undefined) { sets.push('task_id=?'); values.push(taskId); }
  if (conversationId !== undefined) { sets.push('conversation_id=?'); values.push(conversationId); }
  if (workflowRunId !== undefined) { sets.push('workflow_run_id=?'); values.push(workflowRunId); }
  if (error !== undefined) { sets.push('error=?'); values.push(error); }
  if (sets.length === 0) return;
  values.push(id);
  db().prepare(`UPDATE agent_schedule_runs SET ${sets.join(', ')} WHERE id=?`).run(...values);
}

function listRunsForSchedule(scheduleId, limit = 10) {
  return db().prepare('SELECT * FROM agent_schedule_runs WHERE schedule_id=? ORDER BY started_at DESC LIMIT ?')
    .all(scheduleId, Math.max(1, Math.min(50, Number(limit) || 10)));
}

function listOpenRuns(limit = 50) {
  return db().prepare("SELECT * FROM agent_schedule_runs WHERE status IN ('queued','running') ORDER BY started_at ASC LIMIT ?")
    .all(Math.max(1, Math.min(200, Number(limit) || 50)));
}

function listOpenRunsForSchedule(scheduleId) {
  return db().prepare("SELECT * FROM agent_schedule_runs WHERE schedule_id=? AND status IN ('queued','running') ORDER BY started_at ASC LIMIT 5")
    .all(scheduleId);
}

function listRuns({ projectId, limit = 30 } = {}) {
  const pid = clampString(projectId, 120);
  if (!pid) return [];
  return db().prepare(`SELECT r.*, s.title AS schedule_title, s.kind AS schedule_kind
    FROM agent_schedule_runs r JOIN agent_schedules s ON s.id=r.schedule_id
    WHERE s.project_id=? ORDER BY r.started_at DESC LIMIT ?`)
    .all(pid, Math.max(1, Math.min(100, Number(limit) || 30)));
}

function linkConversationToGoal(conversationId, goalId) {
  if (!conversationId || !goalId) return;
  try { db().prepare('UPDATE copilot_conversations SET goal_id=? WHERE id=?').run(goalId, conversationId); } catch { /* column may be absent on legacy DB */ }
}

// ── Reminders ─────────────────────────────────────────────────
function createReminder({ scheduleId, projectId, message, dueAt = nowIso() } = {}) {
  const id = newId('rem');
  db().prepare('INSERT INTO agent_schedule_reminders (id,schedule_id,project_id,message,due_at,acknowledged_at) VALUES (?,?,?,?,?,NULL)')
    .run(id, scheduleId, projectId, clampString(message, 500), dueAt);
  return db().prepare('SELECT * FROM agent_schedule_reminders WHERE id=?').get(id);
}

function listReminders({ projectId, unacknowledged = false, limit = 50 } = {}) {
  const pid = clampString(projectId, 120);
  if (!pid) return [];
  const sql = unacknowledged
    ? 'SELECT * FROM agent_schedule_reminders WHERE project_id=? AND acknowledged_at IS NULL ORDER BY due_at DESC LIMIT ?'
    : 'SELECT * FROM agent_schedule_reminders WHERE project_id=? ORDER BY due_at DESC LIMIT ?';
  return db().prepare(sql).all(pid, Math.max(1, Math.min(100, Number(limit) || 50)));
}

function listAllUnacknowledgedReminders(limit = 50) {
  return db().prepare('SELECT * FROM agent_schedule_reminders WHERE acknowledged_at IS NULL ORDER BY due_at DESC LIMIT ?')
    .all(Math.max(1, Math.min(100, Number(limit) || 50)));
}

function acknowledgeReminder(id) {
  db().prepare('UPDATE agent_schedule_reminders SET acknowledged_at=? WHERE id=?').run(nowIso(), id);
  return { ok: true };
}

// ── Snapshot ──────────────────────────────────────────────────
function getAutomationSnapshot({ projectId, userId = null } = {}) {
  const schedules = listSchedules({ projectId, userId });
  if (!schedules.ok) return schedules;
  const goals = listGoals({ projectId, userId });
  if (!goals.ok) return goals;
  return {
    ok: true,
    schedules: schedules.schedules,
    goals: goals.goals,
    runs: listRuns({ projectId, limit: 30 }),
    reminders: listReminders({ projectId, unacknowledged: true, limit: 20 }),
  };
}

module.exports = {
  ensureSchema,
  createGoal,
  getGoal,
  listGoals,
  updateGoal,
  goalView,
  createSchedule,
  listSchedules,
  getSchedule,
  setScheduleEnabled,
  setScheduleAuto,
  builtinToolNames,
  runScheduleNow,
  deleteSchedule,
  listDueSchedules,
  advanceSchedule,
  createRun,
  updateRun,
  listRunsForSchedule,
  listRuns,
  listOpenRuns,
  listOpenRunsForSchedule,
  linkConversationToGoal,
  createReminder,
  listReminders,
  listAllUnacknowledgedReminders,
  acknowledgeReminder,
  getAutomationSnapshot,
  GOAL_STATUSES,
  GOAL_TRANSITIONS,
  SCHEDULE_KINDS,
  RUN_STATUSES,
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
};
