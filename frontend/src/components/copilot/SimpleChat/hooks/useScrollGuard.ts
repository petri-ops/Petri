import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { ChatMessage } from '@/components/copilot/copilotClient';
import { useConversationResume } from './useConversationResume';
import { useConversationRun } from '../../conversationRunStore';
import { useDurableConversationLoop } from '@/hooks/useDurableConversationLoop';

/** BLOCK-95 A1+A3 — 会话区滚动守卫：距顶 <360px 触发向上补页（prepend 后恢复视口）、
 *  跟随态（atBottom）与回底浮标（>600px 显现）。
 *  BLOCK-92 三波拆分 — 自 SimpleChat.tsx 591-642 连续段原样平移（调用点原位保持
 *  hook 顺序；atBottomRef 仍由组件持有——send 路径也写它，经参数注入）。 */
export function useScrollGuard({
  scrollRef,
  atBottomRef,
  older,
  activeRun,
  durableLoop,
  messages,
  conversationId,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  atBottomRef: { current: boolean };
  older: ReturnType<typeof useConversationResume>['older'];
  activeRun: ReturnType<typeof useConversationRun>;
  durableLoop: ReturnType<typeof useDurableConversationLoop>;
  messages: ChatMessage[];
  conversationId: string | null | undefined;
}): {
  showJumpToBottom: boolean;
  setShowJumpToBottom: Dispatch<SetStateAction<boolean>>;
  scrollToBottom: (smooth?: boolean) => void;
  handleMessagesScroll: () => void;
} {
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  // BLOCK-95 A1 — 向上补页时记录滚动高度，prepend 渲染后恢复视口位置。
  const prependAnchorRef = useRef<number | null>(null);
  // older 每次渲染都是新对象，onScroll 高频路径经 ref 读取。
  const olderRef = useRef(older);
  olderRef.current = older;

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = true;
    setShowJumpToBottom(false);
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  useEffect(() => {
    if (scrollRef.current && atBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeRun, durableLoop.loop, messages]);

  // 切换会话：重置跟随态（新会话加载完成后自动滚到底）。
  useEffect(() => {
    atBottomRef.current = true;
    setShowJumpToBottom(false);
  }, [conversationId]);

  // BLOCK-95 A1+A3 — 会话区滚动：距顶 <360px 触发向上补页（prepend 后恢复视口），
  // 同时更新跟随态与回底浮标。
  const handleMessagesScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = distToBottom < 120;
    setShowJumpToBottom(distToBottom > 600);
    const olderState = olderRef.current;
    if (el.scrollTop < 360 && olderState.hasMore && !olderState.loadingMore) {
      prependAnchorRef.current = el.scrollHeight;
      void olderState.loadOlder();
    }
  }, []);

  // BLOCK-95 A1 — prepend 后恢复视口：useLayoutEffect 在 DOM commit 后、绘制前
  // 同步执行（rAF 会早于 commit，delta 恒 0）；非补页路径 anchor 为 null 零开销。
  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    if (anchor == null) return;
    const el = scrollRef.current;
    if (!el) return;
    prependAnchorRef.current = null;
    el.scrollTop += el.scrollHeight - anchor;
  }, [messages, scrollRef]);

  return { showJumpToBottom, setShowJumpToBottom, scrollToBottom, handleMessagesScroll };
}
