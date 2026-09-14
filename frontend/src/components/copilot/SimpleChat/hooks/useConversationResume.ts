// ============================================================
// useConversationResume — 会话恢复/对账簇（UI-305 P0.4）
//
// 从 SimpleChat.tsx 整簇平移（原 609-668 三个 effect + 两个 guard ref），
// 簇内 hook 相对顺序保持原样，零行为变化：
// 1. conversationId 变化 → 清空并从 SQLite 重载消息（loading 态同步）；
// 2. 已完结 run 在界面重新可见时从 SQLite 对账，防隐藏期完结丢消息；
// 3. T82 — 刷新/重启后按 localStorage resumable task 重连续跑 SSE。
// ============================================================
import { useEffect, useRef } from 'react';
import { getConversationMessages } from '../../copilotConversationsClient';
import {
  clearConversationRun,
  resumeConversationRun,
  shouldClearReconciledConversationRun,
} from '../../conversationRunStore';
import { findResumableAgentTask } from '../../copilotClient';
import { restoreSimpleMessage, type SimpleMessage } from '../types';

export function useConversationResume({
  conversationId,
  projectId,
  activeRun,
  refreshConversations,
  setMessages,
  setLoading,
}: {
  conversationId: string | null;
  projectId: string;
  activeRun: ReturnType<typeof import('../../conversationRunStore').useConversationRun>;
  refreshConversations: () => Promise<void>;
  setMessages: React.Dispatch<React.SetStateAction<SimpleMessage[]>>;
  setLoading: (value: boolean) => void;
}): { reconciledRunRef: React.MutableRefObject<string | null> } {
  // Load messages when conversationId changes
  useEffect(() => {
    setMessages([]);
    if (!conversationId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const msgs = await getConversationMessages(conversationId, 200);
      if (cancelled) return;
      const ui: SimpleMessage[] = msgs.map(restoreSimpleMessage);
      setMessages(ui);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [conversationId, setLoading, setMessages]);

  // A completed run may have settled while this conversation was hidden or
  // while the whole chat surface was unmounted. Reconcile from SQLite when it
  // becomes visible again; running/error snapshots remain available in the
  // shared store so switching views never loses live state.
  const reconciledRunRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId || !activeRun || activeRun.status === 'running' || !activeRun.completedAt) return;
    const reconciliationId = `${conversationId}:${activeRun.completedAt}`;
    if (reconciledRunRef.current === reconciliationId) return;
    let cancelled = false;
    (async () => {
      const persisted = await getConversationMessages(conversationId, 200);
      if (cancelled) return;
      reconciledRunRef.current = reconciliationId;
      setMessages(persisted.map(restoreSimpleMessage));
      // Cancellation is persisted by the backend just like successful
      // completion. Once SQLite has supplied that durable message, discard
      // the local snapshot so progress and tool blocks are not duplicated.
      if (shouldClearReconciledConversationRun(activeRun)) {
        clearConversationRun(conversationId);
      }
      await refreshConversations();
    })();
    return () => {
      cancelled = true;
    };
  }, [activeRun, conversationId, refreshConversations, setMessages]);

  // BLOCK-87 L2 — 多端消息实时镜像：手机投影（或协作成员）发的消息，
  // 桌面正开着该会话时 5 秒内出现。无本地活跃 run 时对账式整体重建
  // （与上方 completed-run 对账同写法）；有 run 时跳过（本地流式快照优先，
  // run 完结由上方 effect 对账）。无变化保持原引用避免无谓重渲染。
  useEffect(() => {
    if (!conversationId) return;
    if (activeRun && activeRun.status === 'running') return;
    const timer = setInterval(async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const persisted = await getConversationMessages(conversationId, 200);
        setMessages((current) => {
          const next = persisted.map(restoreSimpleMessage);
          const unchanged = next.length === current.length
            && next.every((m, i) => m.role === current[i]?.role && m.content === current[i]?.content);
          return unchanged ? current : next;
        });
      } catch { /* 单次轮询失败静默，下一轮继续 */ }
    }, 5000);
    return () => clearInterval(timer);
  }, [conversationId, activeRun, setMessages]);

  // T82 — recover an in-progress agent task after a refresh / Electron restart.
  // On conversation mount, if a prior run left a resumable task in localStorage
  // (findResumableAgentTask), reconnect its SSE and rebuild the live snapshot so
  // the user does not stare at a blank "running" state for the whole ~10+ min run.
  // Guarded so it only attempts once per conversationId (also survives StrictMode).
  const resumableCheckedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId) return;
    if (resumableCheckedRef.current === conversationId) return;
    resumableCheckedRef.current = conversationId;
    const record = findResumableAgentTask(conversationId, projectId);
    if (record) resumeConversationRun(record, conversationId, projectId);
  }, [conversationId, projectId]);

  // 供既有 useChatStream 复用（BLOCK-9.2 起的对账 guard 归本簇所有）。
  return { reconciledRunRef };
}
