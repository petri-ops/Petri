'use strict';

/**
 * M1 / BLOCK-427 — 独立 no-tool goal verifier（闭合「以目标为输入」人设）。
 *
 * 设计红线：
 *   - **no-tool**：签名不含任何工具执行能力，只接受「已存在的证据」做纯判定，
 *     因此不可能被模型的自报文本绕过，也不会产生新的副作用。
 *   - 终止由「产物/证据存在性 + todo 全终态 + 后台任务全部 settle」三者共同决定，
 *     不是模型 final answer 单方自报。
 *   - **不改产品契约**：本函数供状态机驱动终止时调用；接线到主循环属 M6-A，
 *     不在本包提前改 `loop-orchestrator.js` 的控制流。
 *   - 每条拒绝都有具名 `reasonCode`（不静默、不返回空 `{}` 假成功）。
 *
 * 纯新增、零依赖、零副作用。
 */

const TERMINAL_TODO_STATUSES = Object.freeze(['done', 'cancelled', 'failed', 'skipped']);

/**
 * @param {object} input
 * @param {object} input.goal              会话级目标
 * @param {Array}  input.artifacts         已落盘产物（至少要有 path 且 bytes > 0）
 * @param {Array}  input.todos             任务清单
 * @param {Array}  input.backgroundTasks   后台任务（须全部 settled）
 * @returns {{ok: boolean, reasons: Array<{code: string, detail: string}>, verdict: string}}
 */
function verifyGoalCompletion({ goal, artifacts = [], todos = [], backgroundTasks = [] } = {}) {
  const reasons = [];

  const usable = (artifacts || []).filter(
    (a) => a && typeof a.path === 'string' && a.path.length > 0 && Number(a.bytes) > 0,
  );
  if (usable.length === 0) {
    reasons.push({ code: 'ARTIFACTS_ABSENT', detail: '无可核验产物：模型自报完成不构成证据' });
  }

  const openTodos = (todos || []).filter(
    (t) => !TERMINAL_TODO_STATUSES.includes(String(t && t.status)),
  );
  if (openTodos.length > 0) {
    reasons.push({
      code: 'TODO_NOT_TERMINAL',
      detail: `${openTodos.length} 项 todo 未终态（允许终态=${[...TERMINAL_TODO_STATUSES].join('/')}）`,
    });
  }

  const unsettled = (backgroundTasks || []).filter((t) => !t || t.settled !== true);
  if (unsettled.length > 0) {
    reasons.push({
      code: 'BACKGROUND_TASKS_UNSETTLED',
      detail: `${unsettled.length} 个后台任务未 settle，完成判定须 defer`,
    });
  }

  if (goal && goal.status === 'blocked') {
    reasons.push({ code: 'GOAL_BLOCKED', detail: '目标处于 blocked，不得判完成' });
  }

  return {
    ok: reasons.length === 0,
    reasons,
    verdict: reasons.length === 0 ? 'verified' : 'deferred',
    evidence: { artifacts: usable.length, todos: (todos || []).length, backgroundTasks: (backgroundTasks || []).length },
  };
}

module.exports = { TERMINAL_TODO_STATUSES, verifyGoalCompletion };
