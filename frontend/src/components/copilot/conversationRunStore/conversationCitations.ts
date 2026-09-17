import type { KnowledgeCitation } from '../copilotClient/types';

// BLOCK-94 / UI-402 — 知识溯源按会话保留末次注入快照。run 终态后的对账会清掉
// run 快照（与 BLOCK-97 任务清单同款困境：溯源条若只挂在 run 上，回答完成后
// 立即消失，用户无法对照「这段结论哪来的」）。改为会话级独立存储：
// knowledge_citations 事件到达即写入；run 终态/对账不清；下一次 run 开始时
// 清除（生命周期=单次 agent 任务运行）。写入通过订阅回调驱动摘要卡实时更新。
const lastCitations = new Map<string, KnowledgeCitation[]>();
const listeners = new Map<string, Set<() => void>>();

// useSyncExternalStore 以 Object.is 比较快照：空态必须返回同一引用，
// 每次 new [] 会导致「Maximum update depth exceeded」无限重渲染（BLOCK-97 P3 同款教训）。
const EMPTY_CITATIONS: KnowledgeCitation[] = [];

/** 当前会话的知识溯源末次快照（无注入返回空数组）。 */
export function getConversationCitations(
  conversationId: string | null | undefined
): KnowledgeCitation[] {
  return (conversationId && lastCitations.get(conversationId)) || EMPTY_CITATIONS;
}

export function setConversationCitations(
  conversationId: string,
  citations: KnowledgeCitation[]
): void {
  lastCitations.set(conversationId, citations);
  listeners.get(conversationId)?.forEach((fn) => fn());
}

/** 新 run 开始时清除上一轮溯源（生命周期=单次任务运行）。 */
export function clearConversationCitations(conversationId: string): void {
  if (!lastCitations.delete(conversationId)) return;
  listeners.get(conversationId)?.forEach((fn) => fn());
}

export function subscribeConversationCitations(
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

export function clearConversationCitationsForTests(): void {
  lastCitations.clear();
  listeners.clear();
}
