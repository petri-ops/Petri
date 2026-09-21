/**
 * helpers/agent-reconciliation.js — 主任务终态对账（纯函数）
 *
 * 「终态对账」候选落地（2026-09-21 用户裁决「要立终态对账机制……结果要符合的」）。
 * v1 口径（诚实边界）：任务清单是模型申报制，条目与子任务无结构化归属，故 v1 只做
 * **粗粒度不一致检测**——存在失败子任务而清单最后状态全部 completed 时判「未对账」，
 * 提示用户核对；不改写清单、不阻断终态。条目级归属对账待数据模型补 linkage 后另裁。
 */

/**
 * @param {Array<{status: string}>} todoItems 最后一次 todo_write 的清单项
 * @param {Array<{status: string}>} children 该主任务的全部子任务（listChildAgentTasks）
 * @returns {null | { kind: string, failedCount: number, cancelledCount: number, totalCount: number, message: string }}
 *          null = 一致（无需提示）
 */
function computeReconciliationNotice(todoItems, children) {
  if (!Array.isArray(todoItems) || todoItems.length === 0) return null;
  if (!Array.isArray(children) || children.length === 0) return null;
  const allCompleted = todoItems.every((t) => t && t.status === 'completed');
  if (!allCompleted) return null;
  // v1.5：cancelled 与 failed 同为「未清」——被取消的子任务一样构成清单失真
  const failed = children.filter((c) => c && c.status === 'failed');
  const cancelled = children.filter((c) => c && c.status === 'cancelled');
  const notClean = failed.length + cancelled.length;
  if (notClean === 0) return null;
  return {
    kind: 'failed_children_vs_completed_checklist',
    failedCount: failed.length,
    cancelledCount: cancelled.length,
    totalCount: children.length,
    message: `对账提示：${notClean}/${children.length} 个子智能体未正常完成（失败 ${failed.length}、取消 ${cancelled.length}），但任务清单已全部标记完成——结果可能不完整，请核对。`,
  };
}

module.exports = { computeReconciliationNotice };
