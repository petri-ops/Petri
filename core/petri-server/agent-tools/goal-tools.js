'use strict';

/**
 * agent-tools/goal-tools.js — Q7（BLOCK-256）目标工具执行层。
 *
 * 三工具：create_goal / get_goal / update_goal。项目隔离 fail-closed；
 * 状态机迁移由 automation-store 单一实现；用量/预算由 store 从真实 ai_usage 投影。
 */

const store = require('../helpers/automation-store');

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveContext(args = {}, ctx = {}) {
  return {
    projectId: readString(args.projectId) || readString(ctx.projectId),
    conversationId: readString(args.conversationId) || readString(ctx.conversationId) || null,
    userId: readString(ctx.userId) || null,
  };
}

async function tool_create_goal(args = {}, ctx = {}) {
  const { projectId, conversationId, userId } = resolveContext(args, ctx);
  const result = store.createGoal({
    userId,
    projectId,
    conversationId,
    title: args.title,
    description: args.description,
    budgetTokens: args.budgetTokens,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    goal: result.goal,
    message: `已创建目标「${result.goal.title}」（${result.goal.status}）。用 update_goal 暂停/完成，预算按 token 计。`,
  };
}

async function tool_get_goal(args = {}, ctx = {}) {
  const { projectId, userId } = resolveContext(args, ctx);
  const goalId = readString(args.goalId);
  if (goalId) {
    const result = store.getGoal({ id: goalId, userId });
    return result.ok ? { ok: true, goal: result.goal } : result;
  }
  const result = store.listGoals({ projectId, userId, limit: args.limit });
  return result.ok ? { ok: true, goals: result.goals, count: result.goals.length } : result;
}

async function tool_update_goal(args = {}, ctx = {}) {
  const { userId } = resolveContext(args, ctx);
  const goalId = readString(args.goalId);
  if (!goalId) return { ok: false, error: 'missing_goalId', message: '需要 goalId。' };
  const result = store.updateGoal({
    id: goalId,
    userId,
    status: args.status,
    title: args.title,
    description: args.description,
    budgetTokens: args.budgetTokens,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    goal: result.goal,
    message: result.goal.budgetLimited
      ? '目标已更新；当前已到预算上限，关联定时任务会跳过提交。'
      : `目标已更新（${result.goal.status}）。`,
  };
}

module.exports = { tool_create_goal, tool_get_goal, tool_update_goal };
