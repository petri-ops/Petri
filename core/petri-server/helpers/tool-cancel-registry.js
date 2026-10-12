'use strict';

/**
 * helpers/tool-cancel-registry.js — 运行内工具协作取消注册表（BLOCK-171 CP-1）。
 *
 * 背景：77 个工具契约统一 cancellable:false（P7-B 诚实标注），在途长工具
 * （workspace_search 等）无法被 Stop/取消请求中断，loop 只能等工具自然返回
 * 后在轮边界收尾。本注册表给「声明可取消」的工具提供协作取消原语：
 *   - loop 侧每笔可取消调用 register(callId, tool) 取得 AbortSignal 注入
 *     toolCtx.toolCancelSignal，handler 在自己的循环/等待片上检查；
 *   - 取消侧（HTTP tool-cancel 路由 / 任务级联取消）cancel({ callId? }) 触发
 *     abort，handler 抛 AbortError('tool_cancel_requested')；
 *   - executeToolCall 将该错误归类为 error:'tool_cancelled'（诚实入 envelope）。
 *
 * 生命周期：runLoop 开始 createToolCancellation(taskId)，单返回点 release；
 * 注册表按 taskId 锚定（前端 run 快照 taskId 与路由参数同源）。
 * 铁律=协作取消（handler 主动检查），不做任何强杀——与「搬移不改写」同级
 * 的诚实边界：不可取消的调用（cancellable:false）不注册、不受影响。
 */

const registries = new Map(); // taskId -> registry

function createToolCancellation(taskId) {
  if (!taskId) return null;
  const calls = new Map(); // callId -> { tool, controller, startedAt }
  const registry = {
    register(callId, tool) {
      const controller = new AbortController();
      calls.set(String(callId), { tool: String(tool || ''), controller, startedAt: Date.now() });
      return controller.signal;
    },
    release(callId) {
      calls.delete(String(callId));
    },
    cancel({ callId } = {}) {
      const cancelled = [];
      for (const [id, entry] of calls) {
        if (callId && id !== String(callId)) continue;
        if (!entry.controller.signal.aborted) {
          entry.controller.abort(new Error('tool_cancel_requested'));
          cancelled.push(id);
        }
        // 取消即出表（结算侧 release 幂等；list() 只反映仍在途的调用）
        calls.delete(id);
      }
      return { ok: true, cancelled };
    },
    list() {
      return [...calls.keys()];
    },
  };
  registries.set(taskId, registry);
  return registry;
}

function getToolCancellation(taskId) {
  return taskId ? registries.get(taskId) || null : null;
}

function releaseToolCancellation(taskId) {
  if (taskId) registries.delete(taskId);
}

module.exports = {
  createToolCancellation,
  getToolCancellation,
  releaseToolCancellation,
};
