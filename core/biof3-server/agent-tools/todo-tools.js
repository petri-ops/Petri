'use strict';

/**
 * agent-tools/todo-tools.js — BLOCK-97 P1 任务清单（todo）维护工具
 *
 * todo_write：整单幂等写入（全量替换，无增量 diff 并发序问题）。纯状态写入：
 * 不落业务表、不触发 LLM 推理。清单快照经 agent-runner 的 emitToolResult
 * 包裹点以专用 task_todo 事件广播，随 task_events 持久化——事件重放即持久化
 * （BLOCK-97 D1/D2 定案），重启后前端经 afterSeq=0 重放可重建清单。
 *
 * 不做 ctx.userId 门：清单是任务运行内的临时 UI 态（生命周期=单次任务运行，
 * 非用户数据写入），访客会话同样可用；纪律约束由 system prompt 注入承担。
 */

const TODO_STATUSES = Object.freeze(['pending', 'in_progress', 'completed']);
const MAX_ITEMS = 20;
const MAX_CONTENT_LENGTH = 300;
const MAX_ID_LENGTH = 64;

function normalizeTodoItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: 'missing_args', message: '需要非空 items 数组（1-20 条）' };
  }
  if (rawItems.length > MAX_ITEMS) {
    return { error: 'too_many_items', message: `清单最多 ${MAX_ITEMS} 条` };
  }
  const items = [];
  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { error: 'invalid_item', message: `items[${i}] 必须是对象` };
    }
    const content = typeof raw.content === 'string' ? raw.content.trim() : '';
    if (!content) {
      return { error: 'invalid_item', message: `items[${i}].content 不能为空` };
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return {
        error: 'invalid_item',
        message: `items[${i}].content 超过 ${MAX_CONTENT_LENGTH} 字符`,
      };
    }
    if (!TODO_STATUSES.includes(raw.status)) {
      return {
        error: 'invalid_status',
        message: `items[${i}].status 必须是 ${TODO_STATUSES.join('/')}`,
      };
    }
    const id =
      typeof raw.id === 'string' && raw.id.trim()
        ? raw.id.trim().slice(0, MAX_ID_LENGTH)
        : String(i + 1);
    items.push({ id, content, status: raw.status });
  }
  return { items };
}

async function tool_todo_write(args) {
  const normalized = normalizeTodoItems(args && args.items);
  if (normalized.error) {
    return { ok: false, error: normalized.error, message: normalized.message };
  }
  const items = normalized.items;
  const completed = items.filter((item) => item.status === 'completed').length;
  const inProgress = items.filter((item) => item.status === 'in_progress').length;
  return {
    ok: true,
    items,
    total: items.length,
    completed,
    inProgress,
    message: `清单已更新（共 ${items.length} 条，完成 ${completed}，进行中 ${inProgress}）`,
  };
}

/**
 * task_todo 专用事件发射判定（BLOCK-97 D2 定案）：todo_write 成功回执后
 * 把整单快照广播给前端。agent-runner 的 emitToolResult 包裹点调用；
 * 返回是否发射，供契约测试断言。
 */
function maybeEmitTaskTodo(evt, emit) {
  if (typeof emit !== 'function' || !evt || evt.event !== 'tool_result') return false;
  if (evt.name !== 'todo_write') return false;
  const envelope = evt.toolResult;
  if (!envelope || envelope.status !== 'success') return false;
  const data = envelope.data;
  if (!data || !Array.isArray(data.items)) return false;
  emit({ event: 'task_todo', items: data.items });
  return true;
}

module.exports = {
  TODO_STATUSES,
  MAX_ITEMS,
  MAX_CONTENT_LENGTH,
  normalizeTodoItems,
  tool_todo_write,
  maybeEmitTaskTodo,
};
