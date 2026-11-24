import { useEffect, useRef, useState } from 'react';
import type { QueuedPrompt } from './useChatStream';

const QUEUE_STORAGE_KEY = 'petri:chat-queue:v1';

/**
 * BLOCK-511 S1.4 — 排队消息队列的状态/水合/回写/清空单一源。
 *
 * 修复前：SimpleChat 挂载 effect 无守卫地 setQueuedPrompts([])，紧随水合把
 * localStorage 队列清空（刷新后排队追问丢失）。参照 project-workspace.tsx
 * 的 prevRef 守卫：只在 conversationId 或 projectId 真正「变化」时清空，
 * 挂载（首次 effect）不清空。newConversation 的显式清空仍由调用方触发。
 */
export function usePromptQueue(conversationId: string | null, projectId: string | null) {
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>(() => {
    try {
      const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as QueuedPrompt[]) : [];
    } catch {
      return [];
    }
  });

  // 回写：队列变化即持久化（归属标记由 BLOCK-102 语义维护）
  useEffect(() => {
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queuedPrompts));
    } catch {
      /* 忽略：隐私模式/配额满时不影响交互 */
    }
  }, [queuedPrompts]);

  // 会话/项目切换才清空；挂载不清空（保住刷新后的排队追问）
  const prevScopeRef = useRef({ conversationId, projectId });
  useEffect(() => {
    const prev = prevScopeRef.current;
    if (prev.conversationId === conversationId && prev.projectId === projectId) return;
    prevScopeRef.current = { conversationId, projectId };
    setQueuedPrompts([]);
  }, [conversationId, projectId]);

  return { queuedPrompts, setQueuedPrompts };
}
