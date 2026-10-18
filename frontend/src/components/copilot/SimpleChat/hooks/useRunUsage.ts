// UI-523 — 「最近一次模型调用」实测用量订阅（petri:run-usage）。
//
// 只做一件事：把后端 loop 侧发的单次调用读数交给 composer 计量条。
// 事件带 conversationId：只接受本会话（后端未标注会话时放行），
// 避免两个会话同时流式时读数串台（tokenBudget 事件的历史形态无此字段，本包不改它）。
// 会话切换用 render 期 adjust-state 归零（沿用 repo 既有先例，避免 effect 内同步 setState）。
import { useEffect, useState } from 'react';
import { petriEvents, type RunUsageDetail } from '@/lib/events';

interface RunUsageState {
  conversationId: string | null;
  usage: RunUsageDetail | null;
}

export function useRunUsage(conversationId: string | null | undefined): RunUsageDetail | null {
  const id = conversationId ?? null;
  const [state, setState] = useState<RunUsageState>({ conversationId: id, usage: null });

  if (state.conversationId !== id) {
    setState({ conversationId: id, usage: null });
  }

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<RunUsageDetail>).detail;
      if (!detail) return;
      if (id && detail.conversationId && detail.conversationId !== id) return;
      setState((current) => (current.conversationId === id ? { conversationId: id, usage: detail } : current));
    };
    window.addEventListener(petriEvents.runUsage, handler);
    return () => window.removeEventListener(petriEvents.runUsage, handler);
  }, [id]);

  return state.conversationId === id ? state.usage : null;
}
