// ============================================================
// useConversationResume — 会话恢复/对账簇（UI-305 P0.4）
//
// 从 SimpleChat.tsx 整簇平移（原 609-668 三个 effect + 两个 guard ref），
// 簇内 hook 相对顺序保持原样：
// 1. conversationId 变化 → 清空并从 SQLite 重载消息（loading 态同步）；
// 2. 已完结 run 在界面重新可见时从 SQLite 对账，防隐藏期完结丢消息；
// 3. T82 — 刷新/重启后按 localStorage resumable task 重连续跑 SSE。
//
// BLOCK-95 A1 — 历史加载游标化：主加载改「最新窗口优先」（修复旧语义
// ASC+LIMIT 拿最旧 200 条导致长会话看不到最近消息），暴露 hasMore/
// nextBefore/loadOlder 供会话区「向上滚动补页」；对账与镜像两条重建链
// 保留已加载的更旧前缀，避免轮询重建把用户翻出的旧页丢掉。
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getConversationMessages,
  getConversationMessagesPage,
  type ConversationCompactionInfo,
} from '../../copilotConversationsClient';
import {
  clearConversationRun,
  resumeConversationRun,
  shouldClearReconciledConversationRun,
} from '../../conversationRunStore';
import { findResumableAgentTask } from '../../copilotClient';
import { restoreSimpleMessage, type SimpleMessage } from '../types';

export interface OlderMessagesState {
  hasMore: boolean;
  nextBefore: number | null;
  /** 本窗口最旧一条在全量消息中的 0-based 序号（fork-from-message 全量定位用）。 */
  windowOffset: number;
  loadingMore: boolean;
  loadOlder: () => Promise<boolean>;
}

/** 重建（对账/镜像）时保留 current 中比 persisted 窗口更旧的已加载前缀。 */
export function mergeKeepOlderPrefix(
  current: SimpleMessage[],
  persisted: SimpleMessage[]
): SimpleMessage[] {
  if (persisted.length === 0 || current.length === 0) return persisted;
  const boundary = persisted[0].ts;
  if (!boundary) return persisted;
  const persistedIds = new Set(persisted.map((m) => m.id).filter(Boolean) as string[]);
  const olderPrefix = current.filter(
    (m) => m.ts && m.ts < boundary && !(m.id && persistedIds.has(m.id))
  );
  if (olderPrefix.length === 0) return persisted;
  return [...olderPrefix, ...persisted];
}

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
}): {
  reconciledRunRef: React.MutableRefObject<string | null>;
  older: OlderMessagesState;
  /** BLOCK-95 B2/A5 — 会话压缩留痕（诚实可见；null=未压缩）。 */
  compaction: ConversationCompactionInfo | null;
} {
  // A1 — 分页游标 state（conversationId 切换时由主加载重置）。
  const [olderMeta, setOlderMeta] = useState<{ hasMore: boolean; nextBefore: number | null; windowOffset: number }>(
    { hasMore: false, nextBefore: null, windowOffset: 0 }
  );
  // B2/A5 — 会话压缩留痕（信封字段；null=未压缩）。
  const [compaction, setCompaction] = useState<ConversationCompactionInfo | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  // Load messages when conversationId changes
  // A1 — deps 收窄为 [conversationId]：本 effect 现在会写 olderMeta state，
  // 若 deps 含调用方 setter（可能为不稳定引用），effect 重跑 → setState → 重渲染
  // → effect 重跑……构成死循环。setter 经 ref 读取，语义仍是「会话切换时重载」。
  const setMessagesRef = useRef(setMessages);
  setMessagesRef.current = setMessages;
  const setLoadingRef = useRef(setLoading);
  setLoadingRef.current = setLoading;

  useEffect(() => {
    setMessagesRef.current([]);
    setOlderMeta({ hasMore: false, nextBefore: null, windowOffset: 0 });
    setCompaction(null);
    if (!conversationId) {
      setLoadingRef.current(false);
      return;
    }
    let cancelled = false;
    setLoadingRef.current(true);
    (async () => {
      const page = await getConversationMessagesPage(conversationId, 200);
      if (cancelled) return;
      const msgs = page ? page.messages : [];
      const ui: SimpleMessage[] = msgs.map(restoreSimpleMessage);
      setMessagesRef.current(ui);
      setOlderMeta({
        hasMore: page ? page.hasMore : false,
        nextBefore: page ? page.nextBefore : null,
        windowOffset: page ? page.windowOffset : 0,
      });
      setCompaction(page ? page.compaction || null : null);
      setLoadingRef.current(false);
    })();
    return () => { cancelled = true; };
  }, [conversationId]);

  // A1 — 向上补页：拉更旧一页并 prepend。返回是否真的加载了内容。
  const loadOlder = useCallback(async (): Promise<boolean> => {
    if (!conversationId) return false;
    if (loadingMoreRef.current) return false;
    const before = olderMetaRef.current.nextBefore;
    if (before == null) return false;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await getConversationMessagesPage(conversationId, 200, before);
      if (!page || page.messages.length === 0) {
        setOlderMeta((m) => ({ ...m, hasMore: false, nextBefore: null }));
        return false;
      }
      const olderUi = page.messages.map(restoreSimpleMessage);
      setMessages((current) => {
        // 幂等去重：镜像轮询可能已重建窗口，与旧页重叠时按 id 去重。
        const currentIds = new Set(current.map((m) => m.id).filter(Boolean) as string[]);
        const fresh = olderUi.filter((m) => !(m.id && currentIds.has(m.id)));
        return [...fresh, ...current];
      });
      setOlderMeta({
        hasMore: page.hasMore,
        nextBefore: page.nextBefore,
        windowOffset: page.windowOffset,
      });
      return true;
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [conversationId]);

  // loadOlder 读最新游标而不重建回调引用（onScroll 高频路径用 ref）。
  const olderMetaRef = useRef(olderMeta);
  olderMetaRef.current = olderMeta;

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
      setMessages((current) => mergeKeepOlderPrefix(current, persisted.map(restoreSimpleMessage)));
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
  // A1 — 重建时保留已加载的更旧前缀（mergeKeepOlderPrefix）。
  useEffect(() => {
    if (!conversationId) return;
    if (activeRun && activeRun.status === 'running') return;
    const timer = setInterval(async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const persisted = await getConversationMessages(conversationId, 200);
        setMessages((current) => {
          const next = persisted.map(restoreSimpleMessage);
          const unchanged = current.length === next.length
            && next.every((m, i) => m.role === current[i]?.role && m.content === current[i]?.content);
          return unchanged ? current : mergeKeepOlderPrefix(current, next);
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
  return {
    reconciledRunRef,
    older: {
      hasMore: olderMeta.hasMore,
      nextBefore: olderMeta.nextBefore,
      windowOffset: olderMeta.windowOffset,
      loadingMore,
      loadOlder,
    },
    compaction,
  };
}
