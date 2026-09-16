import type { ChildFinishedNotice } from './types';

// BLOCK-56 P1 / UI-287 — 模型降级提示按会话保留。run 终态后的对账会清掉 run
// 快照（clearConversationRun），notice 若只挂在 run 上，在「降级后数秒内完成」
// 的场景存活 <300ms，用户不可见；持久化消息也不携带该字段。改为会话级独立
// 存储，附着到最后一条助手消息渲染，下一次 run 开始时清除。
const fallbackNotices = new Map<string, { message: string; ts: string }>();

/**
 * BLOCK-56 P1 / UI-287 — 当前会话待展示的降级提示（请求级 + 任务级共用）。
 * 无提示返回 null。run 清理 / 页面刷新后仍可读，直到下一次 run 开始。
 */
export function getConversationFallbackNotice(conversationId: string): string | null {
  return fallbackNotices.get(conversationId)?.message ?? null;
}

export function setFallbackNotice(conversationId: string, message: string): void {
  fallbackNotices.set(conversationId, { message, ts: new Date().toISOString() });
}

// BLOCK-49 加映 — proactive：子 agent 终态通知（会话级，下一次 run 开始清除）
const childFinishedNotices = new Map<string, ChildFinishedNotice[]>();

/** BLOCK-49 加映 — 当前会话累计的子 agent 终态通知（下一次 run 开始清除）。 */
export function getChildFinishedNotices(conversationId: string): ChildFinishedNotice[] {
  return childFinishedNotices.get(conversationId) ?? [];
}

export function pushChildFinishedNotice(conversationId: string, notice: ChildFinishedNotice): void {
  const list = childFinishedNotices.get(conversationId) ?? [];
  list.push(notice);
  // 上限保护：单会话累计最多 10 条（超出丢最旧）
  childFinishedNotices.set(conversationId, list.slice(-10));
}

/** 新 run 开始时清除上一轮会话级提示（BLOCK-56 降级提示 + BLOCK-49 子 agent 终态通知）。 */
export function clearConversationNotices(conversationId: string): void {
  fallbackNotices.delete(conversationId);
  childFinishedNotices.delete(conversationId);
}
