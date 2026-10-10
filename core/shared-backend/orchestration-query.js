'use strict';

/**
 * shared-backend/orchestration-query.js — 编排查询门面（BLOCK-163 W3 P2/ORC-4 第一刀）。
 *
 * 两条编排链——run_tool 工作流计划（projectWorkflowPlan 恢复投影）与 spawn 派生
 * 子任务（agentTaskStore 子任务清单）——此前各自持有恢复语义词汇
 * （terminal/recoverable/resumeFrom…）。本门面把「恢复语义」收敛为单一出处：
 *   - summarizeWorkflow(plan, jobs)：工作流恢复投影（learning.js op=status/next 消费）
 *   - summarizeChildAgents(children)：子任务恢复投影（list_agents additive recovery 块）
 * 二者共用同一组判定词表（TERMINAL/RESUMABLE）。血缘 DAG 渲染继续共用既有
 * /lineage 端点，不另起。
 */

const TERMINAL_CHILD_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const RESUMABLE_CHILD_STATUSES = new Set(['failed', 'interrupted']);

function childRecoveryEntry(task) {
  const status = task.status;
  const terminal = TERMINAL_CHILD_STATUSES.has(status);
  const resumable = !terminal || RESUMABLE_CHILD_STATUSES.has(status);
  return {
    agentId: task.taskId,
    status,
    terminal,
    resumable,
    resumeHint: resumable
      ? (task.status === 'interrupted'
        ? 'POST /api/ai/agent/task/:id/resume 续跑（同会话新 task 带 resumeOfTaskId）'
        : '重新 spawn 同任务（子任务无状态续跑）')
      : null,
    finishedAt: task.finishedAt || null,
    error: task.error || null,
  };
}

/**
 * 子任务恢复投影（spawn 侧）。children = agentTaskStore.listChildAgentTasks(parentTaskId)。
 * 返回 { children, runningCount, terminalCount, allTerminal }——additive 消费（list_agents
 * 既有字段零变化）。
 */
function summarizeChildAgents(children) {
  const list = Array.isArray(children) ? children : [];
  const entries = list.map(childRecoveryEntry);
  return {
    children: entries,
    runningCount: entries.filter((e) => !e.terminal).length,
    terminalCount: entries.filter((e) => e.terminal).length,
    allTerminal: entries.length > 0 && entries.every((e) => e.terminal),
  };
}

/**
 * 工作流恢复投影（run_tool 侧）。单点委托 projectWorkflowPlan——learning.js
 * op=status/next 均改走本函数（恢复语义单源），行为等价。
 */
function summarizeWorkflow(projectWorkflowPlan, scopedPlan, jobs) {
  return projectWorkflowPlan(scopedPlan, jobs);
}

module.exports = {
  TERMINAL_CHILD_STATUSES,
  RESUMABLE_CHILD_STATUSES,
  summarizeChildAgents,
  summarizeWorkflow,
};
