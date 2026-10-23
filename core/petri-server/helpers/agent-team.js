'use strict';

/**
 * helpers/agent-team.js — BLOCK-249（Q4a）团队投影与停止回执。
 *
 * 只读投影：leader + members 全部来自 `tasks`/`task_events`/`copilot_messages`，
 * 不建第二套任务真源。停止回执按**逐成员**判定（请求取消 / 本就已结束 / 未取消），
 * 部分成功如实呈现，不说成"全部停止"。
 */

const journal = require('./agent-journal');
const { getAssistantMessageByTaskId } = require('./conversations');
const { parseJsonFromText, validateSubset } = require('./json-schema-subset');

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function headOf(text, max = 120) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function taskHead(task) {
  const content = task && task.params && task.params.messages && task.params.messages[0]
    ? task.params.messages[0].content
    : '';
  return headOf(content, 120);
}

/** 结构化输出评估（无 schema → null；有 schema → 终态正文解析 + 子集校验）。 */
function evaluateStructured(task, { attempts } = {}) {
  const schema = task && task.params && task.params.structuredSchema;
  if (!schema) return null;
  const message = getAssistantMessageByTaskId(task.taskId);
  const parsed = parseJsonFromText(message && message.content);
  const errors = parsed.ok ? validateSubset(parsed.value, schema) : [parsed.error];
  const attemptCount = Number.isFinite(Number(attempts))
    ? Number(attempts)
    : (Number(task.params.structuredAttempts) || 0);
  return {
    required: true,
    ok: errors.length === 0,
    errors: errors.slice(0, 8),
    ...(parsed.ok && errors.length === 0 ? { value: parsed.value } : {}),
    attempts: attemptCount,
  };
}

function memberView(task, store) {
  return {
    agentId: task.taskId,
    role: (task.params && task.params.role) || null,
    status: task.status,
    agentStatus: task.agentStatus || null,
    conversationId: (task.params && task.params.conversationId) || null,
    taskHead: taskHead(task),
    createdAt: task.createdAt,
    finishedAt: task.finishedAt || null,
    error: task.error || null,
    lastEventAt: store.getAgentTaskLastEventAt(task.taskId),
    structured: evaluateStructured(task),
  };
}

/** 子代理视角自动上溯到 leader（面板在成员上打开时也能看到整个团队）。 */
function resolveLeaderTaskId(store, taskId) {
  const task = store.getAgentTask(taskId);
  if (!task) return taskId;
  const params = task.params || {};
  if (params.kind === 'subagent' && params.parentTaskId) return String(params.parentTaskId);
  return taskId;
}

function buildTeamView({ store, leaderTaskId, userId }) {
  const resolvedLeaderId = resolveLeaderTaskId(store, leaderTaskId);
  const leader = store.getAgentTask(resolvedLeaderId);
  if (!leader) return { ok: false, status: 404, error: 'leader_not_found' };
  if (leader.userId && leader.userId !== userId) return { ok: false, status: 403, error: 'forbidden' };
  const members = store.listChildAgentTasks(resolvedLeaderId).map((task) => memberView(task, store));
  const counts = { total: members.length, running: 0, finished: 0, structuredInvalid: 0 };
  for (const member of members) {
    if (TERMINAL_STATUSES.has(member.status)) counts.finished += 1;
    else counts.running += 1;
    if (member.structured && member.structured.ok === false) counts.structuredInvalid += 1;
  }
  return {
    ok: true,
    leader: {
      agentId: leader.taskId,
      status: leader.status,
      agentStatus: leader.agentStatus || null,
      conversationId: (leader.params && leader.params.conversationId) || null,
      taskHead: taskHead(leader),
      createdAt: leader.createdAt,
      finishedAt: leader.finishedAt || null,
    },
    ...(resolvedLeaderId !== leaderTaskId ? { viewedFrom: leaderTaskId } : {}),
    members,
    counts,
    journalAvailable: journal.hasJournal(resolvedLeaderId),
  };
}

/** 整体停止：级联取消 + 逐成员回执（部分成功如实）。 */
function stopTeam({ store, dbMod, leaderTaskId, userId }) {
  const view = buildTeamView({ store, leaderTaskId, userId });
  if (!view.ok) return view;
  const leaderId = view.leader.agentId;
  const before = new Map(view.members.map((member) => [member.agentId, member.status]));
  let cancelledTaskIds = [];
  try {
    const result = store.cancelAgentTaskCascade(leaderId, { dbMod });
    cancelledTaskIds = Array.isArray(result && result.cancelledTaskIds) ? result.cancelledTaskIds : [];
  } catch (error) {
    return { ok: false, status: 500, error: 'stop_failed', message: String(error && error.message || error) };
  }
  // 暂停中的成员必须先解冻，否则取消要等到下一次轮询才被看见。
  try {
    const agentPause = require('./agent-pause');
    for (const id of cancelledTaskIds) agentPause.resumeTask(id);
  } catch { /* 暂停登记不可用不影响取消 */ }
  const after = buildTeamView({ store, leaderTaskId, userId });
  const members = (after.ok ? after.members : []).map((member) => {
    const wasTerminal = TERMINAL_STATUSES.has(before.get(member.agentId));
    const outcome = cancelledTaskIds.includes(member.agentId)
      ? 'cancel_requested'
      : (wasTerminal ? 'already_finished' : 'not_cancelled');
    return { agentId: member.agentId, outcome, status: member.status, agentStatus: member.agentStatus };
  });
  return {
    ok: true,
    leader: { agentId: leaderId, outcome: cancelledTaskIds.includes(leaderId) ? 'cancel_requested' : 'not_cancelled' },
    members,
    summary: {
      requested: members.filter((member) => member.outcome === 'cancel_requested').length,
      alreadyFinished: members.filter((member) => member.outcome === 'already_finished').length,
      notCancelled: members.filter((member) => member.outcome === 'not_cancelled').length,
    },
    team: after.ok ? after : null,
  };
}

/** 子代理终态 → journal 一行（best-effort；失败不影响收口）。 */
function recordMemberJournal(task) {
  if (!task || !task.params || task.params.kind !== 'subagent') return { ok: false, error: 'not_member' };
  const leaderTaskId = task.params.parentTaskId;
  if (!leaderTaskId) return { ok: false, error: 'no_leader' };
  const message = getAssistantMessageByTaskId(task.taskId);
  const structured = evaluateStructured(task);
  const startedAt = task.createdAt || null;
  const finishedAt = task.finishedAt || null;
  const durationMs = startedAt && finishedAt
    ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
    : null;
  return journal.appendJournalEntry({
    at: new Date().toISOString(),
    leaderTaskId,
    agentId: task.taskId,
    parentTaskId: leaderTaskId,
    role: task.params.role || null,
    status: task.status,
    agentStatus: task.agentStatus || null,
    startedAt,
    finishedAt,
    ...(Number.isFinite(durationMs) ? { durationMs } : {}),
    resultHead: headOf(message && message.content, 400),
    ...(structured
      ? { structured: { ok: structured.ok, errors: structured.errors.slice(0, 4), attempts: structured.attempts } }
      : {}),
    ...(task.error ? { error: String(task.error).slice(0, 240) } : {}),
  });
}

module.exports = {
  TERMINAL_STATUSES,
  evaluateStructured,
  buildTeamView,
  stopTeam,
  recordMemberJournal,
  taskHead,
};
