import type { AgentTaskTodoItem } from '../copilotClient';

// BLOCK-97 / UI-398 — 任务清单按会话保留末次快照。run 终态后的对账会清掉
// run 快照（与 BLOCK-56 降级提示同款困境：清单若只挂在 run 上，「做完一条
// 勾一条」的完成态会在 done 后立即消失）。改为会话级独立存储：task_todo
// 到达即写入；run 终态/对账不清；下一次 run 开始时清除（生命周期=单次
// agent 任务运行，plan §3）。写入通过订阅回调驱动摘要卡实时勾选。
const lastTodos = new Map<string, AgentTaskTodoItem[]>();
const listeners = new Map<string, Set<() => void>>();

// useSyncExternalStore 以 Object.is 比较快照：空态必须返回同一引用，
// 每次 new [] 会导致「Maximum update depth exceeded」无限重渲染（P3 实机抓真）。
const EMPTY_TODOS: AgentTaskTodoItem[] = [];

/** 当前会话的任务清单末次快照（无清单返回空数组）。 */
export function getConversationTodoList(
  conversationId: string | null | undefined
): AgentTaskTodoItem[] {
  return (conversationId && lastTodos.get(conversationId)) || EMPTY_TODOS;
}

export function setConversationTodoList(conversationId: string, items: AgentTaskTodoItem[]): void {
  lastTodos.set(conversationId, items);
  listeners.get(conversationId)?.forEach((fn) => fn());
}

/** 新 run 开始时清除上一轮清单（生命周期=单次任务运行）。 */
export function clearConversationTodo(conversationId: string): void {
  if (!lastTodos.delete(conversationId)) return;
  listeners.get(conversationId)?.forEach((fn) => fn());
}

export function subscribeConversationTodo(
  conversationId: string | null | undefined,
  fn: () => void
): () => void {
  if (!conversationId) return () => {};
  let set = listeners.get(conversationId);
  if (!set) {
    set = new Set();
    listeners.set(conversationId, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
  };
}

export function clearConversationTodosForTests(): void {
  lastTodos.clear();
  listeners.clear();
}
