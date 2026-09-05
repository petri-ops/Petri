/**
 * BLOCK-57 — 会话级执行目标注入（UI-290 收尾：composer 目标选择器）
 *
 * 用户在输入框旁选择的执行目标（ctx.executionTargetId）随 send context 进入
 * 后端；本助手在**自动执行分支**把它并入 params（保留键，handleToolRun 剥离
 * 入库）。规则：
 *   - params 已带 executionTargetId（模型/确认卡显式指定）→ 不覆盖；
 *   - 目标在注册表中不存在 → 丢弃（fail-closed，不中断对话）；
 *   - ctx 无目标 → 原样返回（本机默认，零变化）。
 */

function withSessionExecutionTargetSync(params, ctx) {
  const tid = ctx && ctx.executionTargetId;
  if (!tid || typeof tid !== 'string' || !params || typeof params !== 'object' || Array.isArray(params)) {
    return params;
  }
  if ('executionTargetId' in params) return params;
  return { ...params, executionTargetId: tid };
}

/**
 * 异步版本：注入前校验目标存在性（isKnownTarget 由调用方注入，通常是
 * execution_targets 表查询）。
 */
async function withSessionExecutionTarget(params, ctx, isKnownTarget) {
  const tid = ctx && ctx.executionTargetId;
  if (!tid || typeof tid !== 'string') return params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
  if ('executionTargetId' in params) return params;
  if (typeof isKnownTarget !== 'function') return params;
  let known = false;
  try {
    known = Boolean(await isKnownTarget(tid));
  } catch {
    known = false;
  }
  if (!known) return params;
  return { ...params, executionTargetId: tid };
}

module.exports = { withSessionExecutionTarget, withSessionExecutionTargetSync };
