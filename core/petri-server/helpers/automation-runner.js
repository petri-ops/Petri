'use strict';

/**
 * helpers/automation-runner.js — Q7（BLOCK-256）定时任务执行器。
 *
 * 纪律：
 *   - 不建第二执行器：任务型 schedule 只向本机 `POST /api/ai/agent` 提交，
 *     由既有 createAgentTask → runAgentLoop 链执行；
 *   - 复用既有任务存储对账（getAgentTask），不新造任务状态；
 *   - goal 用量预算在**提交前**检查；已运行的 loop 不硬熔断（如实登记 skip）。
 */

const store = require('./automation-store');

const DEFAULT_INTERVAL_MS = 10_000;
const AUTH_TOKEN = 'desktop-local';
const activeSchedules = new Set();

function defaultBaseUrl() {
  return `http://127.0.0.1:${process.env.R_SERVER_PORT || 3001}`;
}

async function fetchJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  let data = null;
  try { data = await response.json(); } catch { /* non-json */ }
  if (!response.ok) throw new Error((data && (data.error || data.message)) || `HTTP ${response.status}`);
  return data || {};
}

async function createRunConversation({ schedule, fetchImpl, baseUrl }) {
  const data = await fetchJson(fetchImpl, `${baseUrl}/api/ai/conversations?project_id=${encodeURIComponent(schedule.project_id)}`, {
    method: 'POST',
    body: JSON.stringify({ title: `[定时] ${schedule.title}`.slice(0, 100), project_id: schedule.project_id }),
  });
  const conversationId = data && data.conversation && data.conversation.id;
  if (!conversationId) throw new Error('conversation_create_failed');
  if (schedule.goal_id) store.linkConversationToGoal(conversationId, schedule.goal_id);
  return conversationId;
}

async function submitAgentTask({ schedule, conversationId, fetchImpl, baseUrl }) {
  const data = await fetchJson(fetchImpl, `${baseUrl}/api/ai/agent`, {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', content: schedule.prompt }],
      context: { page: 'desktop-project', projectId: schedule.project_id },
      conversationId,
    }),
  });
  if (!data || typeof data.taskId !== 'string' || !data.taskId) throw new Error('task_submit_failed');
  return data.taskId;
}

async function submitWorkflowSchedule({ schedule, fetchImpl, baseUrl }) {
  if (!schedule.workflow_script) throw new Error('workflow_script_missing');
  let args = null;
  try {
    args = schedule.workflow_args_json ? JSON.parse(schedule.workflow_args_json) : null;
  } catch {
    throw new Error('workflow_args_invalid');
  }
  const data = await fetchJson(fetchImpl, `${baseUrl}/api/ai/agent/workflow/run`, {
    method: 'POST',
    body: JSON.stringify({ script: schedule.workflow_script, args }),
  });
  if (!data || typeof data.runId !== 'string' || !data.runId) throw new Error('workflow_submit_failed');
  return { runId: data.runId, taskId: typeof data.taskId === 'string' ? data.taskId : null };
}

function goalGate(schedule) {
  if (!schedule.goal_id) return { ok: true };
  const result = store.getGoal({ id: schedule.goal_id });
  if (!result.ok) return { ok: false, status: 'skipped_goal', reason: 'goal_not_found' };
  if (result.goal.status !== 'active') return { ok: false, status: 'skipped_goal', reason: `goal_${result.goal.status}` };
  if (result.goal.budgetLimited) return { ok: false, status: 'skipped_budget', reason: 'goal_budget_limited' };
  return { ok: true, goal: result.goal };
}

async function executeSchedule(schedule, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const baseUrl = deps.baseUrl || defaultBaseUrl();
  const now = deps.now ? new Date(deps.now) : new Date();
  if (activeSchedules.has(schedule.id)) return { scheduleId: schedule.id, status: 'skipped_active' };
  const open = store.listOpenRunsForSchedule(schedule.id);
  if (open.length > 0) {
    store.advanceSchedule(schedule.id, now.getTime());
    return { scheduleId: schedule.id, status: 'skipped_running' };
  }
  activeSchedules.add(schedule.id);
  try {
    if (schedule.kind === 'reminder') {
      store.createReminder({
        scheduleId: schedule.id,
        projectId: schedule.project_id,
        message: schedule.reminder_text || schedule.title,
        dueAt: now.toISOString(),
      });
      store.createRun({ scheduleId: schedule.id, status: 'reminder', startedAt: now.toISOString() });
      store.advanceSchedule(schedule.id, now.getTime());
      return { scheduleId: schedule.id, status: 'reminder' };
    }

    const gate = goalGate(schedule);
    if (!gate.ok) {
      store.createRun({ scheduleId: schedule.id, status: gate.status, error: gate.reason, startedAt: now.toISOString() });
      store.advanceSchedule(schedule.id, now.getTime());
      return { scheduleId: schedule.id, status: gate.status, reason: gate.reason };
    }

    if (schedule.kind === 'workflow') {
      try {
        const workflow = await submitWorkflowSchedule({ schedule, fetchImpl, baseUrl });
        store.createRun({
          scheduleId: schedule.id,
          taskId: workflow.taskId,
          workflowRunId: workflow.runId,
          status: 'running',
          startedAt: now.toISOString(),
        });
        store.advanceSchedule(schedule.id, now.getTime());
        return {
          scheduleId: schedule.id,
          status: 'running',
          taskId: workflow.taskId,
          workflowRunId: workflow.runId,
        };
      } catch (error) {
        store.createRun({
          scheduleId: schedule.id,
          status: 'failed',
          error: error && error.message ? error.message : String(error),
          startedAt: now.toISOString(),
        });
        store.advanceSchedule(schedule.id, now.getTime());
        return { scheduleId: schedule.id, status: 'failed', error: error && error.message ? error.message : String(error) };
      }
    }

    let conversationId = null;
    try {
      conversationId = await createRunConversation({ schedule, fetchImpl, baseUrl });
      const taskId = await submitAgentTask({ schedule, conversationId, fetchImpl, baseUrl });
      store.createRun({
        scheduleId: schedule.id,
        taskId,
        conversationId,
        status: 'running',
        startedAt: now.toISOString(),
      });
      store.advanceSchedule(schedule.id, now.getTime());
      return { scheduleId: schedule.id, status: 'running', taskId, conversationId };
    } catch (error) {
      store.createRun({
        scheduleId: schedule.id,
        conversationId,
        status: 'failed',
        error: error && error.message ? error.message : String(error),
        startedAt: now.toISOString(),
      });
      store.advanceSchedule(schedule.id, now.getTime());
      return { scheduleId: schedule.id, status: 'failed', error: error && error.message ? error.message : String(error) };
    }
  } finally {
    activeSchedules.delete(schedule.id);
  }
}

async function reconcileOpenRuns({ getTask, getWorkflowRun, fetchImpl = fetch, baseUrl } = {}) {
  const lookup = typeof getTask === 'function'
    ? getTask
    : (taskId) => {
      try { return require('../agent-task-store').getAgentTask(taskId); } catch { return null; }
    };
  const workflowLookup = typeof getWorkflowRun === 'function'
    ? getWorkflowRun
    : async (runId) => {
      const data = await fetchJson(fetchImpl, `${baseUrl || defaultBaseUrl()}/api/ai/agent/workflow/runs/${encodeURIComponent(runId)}`);
      return data && data.run ? data.run : data;
    };
  const results = [];
  for (const run of store.listOpenRuns()) {
    if (run.workflow_run_id) {
      try {
        const detail = await workflowLookup(run.workflow_run_id);
        const status = String((detail && detail.status) || '');
        if (status === 'completed') {
          store.updateRun(run.id, { status: 'completed' });
          results.push({ runId: run.id, status: 'completed' });
        } else if (status === 'failed' || status === 'cancelled') {
          store.updateRun(run.id, { status: 'failed', error: (detail && detail.error) || status });
          results.push({ runId: run.id, status: 'failed' });
        } else if (status === 'running') {
          store.updateRun(run.id, { status: 'running' });
        }
      } catch { /* workflow detail unavailable: keep running, next tick retries */ }
      continue;
    }
    if (!run.task_id) continue;
    const task = lookup(run.task_id);
    if (!task) continue;
    const status = String(task.status || '');
    if (status === 'completed' || status === 'done') {
      store.updateRun(run.id, { status: 'completed' });
      results.push({ runId: run.id, status: 'completed' });
    } else if (status === 'failed' || status === 'cancelled' || status === 'stopped') {
      store.updateRun(run.id, { status: 'failed', error: task.error || status });
      results.push({ runId: run.id, status: 'failed' });
    } else if (status === 'running') {
      store.updateRun(run.id, { status: 'running' });
    }
  }
  return results;
}

async function runDueSchedulesOnce(deps = {}) {
  const now = deps.now ? new Date(deps.now) : new Date();
  const reconciled = await reconcileOpenRuns(deps);
  const due = store.listDueSchedules(now.toISOString());
  const executed = [];
  for (const schedule of due) {
    executed.push(await executeSchedule(schedule, { ...deps, now }));
  }
  return { reconciled, executed };
}

async function runScheduleById(id, deps = {}) {
  const schedule = store.getSchedule(id);
  if (!schedule) return { scheduleId: id, status: 'not_found' };
  return executeSchedule(schedule, deps);
}

function startScheduleRunner({ intervalMs = DEFAULT_INTERVAL_MS, baseUrl } = {}) {
  if (process.env.PETRI_DISABLE_AUTOMATION_RUNNER === '1') {
    return { started: false, reason: 'disabled', stop: () => {} };
  }
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    void runDueSchedulesOnce({ baseUrl }).catch((error) => {
      console.warn('[automation-runner] tick failed:', error && error.message ? error.message : error);
    });
  };
  const timer = setInterval(tick, Math.max(2000, Number(intervalMs) || DEFAULT_INTERVAL_MS));
  if (timer.unref) timer.unref();
  setImmediate(tick);
  return {
    started: true,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

module.exports = {
  runDueSchedulesOnce,
  runScheduleById,
  reconcileOpenRuns,
  startScheduleRunner,
  DEFAULT_INTERVAL_MS,
};
