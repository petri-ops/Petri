// BLOCK-255 C4 — 实时「本轮 usage 合计」订阅。
//
// UI-523 的 useRunUsage 只保留最近一次调用；统计面板要的是本轮累计。
// 这里按 conversationId + runStartedAt 归零：新 run 开始即清空，事件只累加
// 本会话且不早于本轮开始的调用（5s 容差防本机时钟抖动）。落库后以 meta.usage 为准。
import { useEffect, useState } from 'react';
import { petriEvents, type RunUsageDetail } from '@/lib/events';
import { accumulateMessageUsage } from '../messageStats';
import type { MessageUsage } from '../types';

interface TotalsState {
  key: string;
  usage: MessageUsage | null;
}

export function useRunUsageTotals(
  conversationId: string | null | undefined,
  runStartedAt: number | null | undefined,
): MessageUsage | null {
  const active = runStartedAt != null;
  const key = `${conversationId ?? ''}:${runStartedAt ?? ''}`;
  const [state, setState] = useState<TotalsState>({ key, usage: null });

  if (state.key !== key) {
    setState({ key, usage: null });
  }

  useEffect(() => {
    if (!active) return undefined;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<RunUsageDetail>).detail;
      if (!detail) return;
      if (conversationId && detail.conversationId && detail.conversationId !== conversationId) return;
      const at = Date.parse(detail.at);
      if (runStartedAt != null && Number.isFinite(at) && at < runStartedAt - 5000) return;
      setState((current) => (
        current.key === key ? { key, usage: accumulateMessageUsage(current.usage, detail) } : current
      ));
    };
    window.addEventListener(petriEvents.runUsage, handler);
    return () => window.removeEventListener(petriEvents.runUsage, handler);
  }, [active, conversationId, key, runStartedAt]);

  return active && state.key === key ? state.usage : null;
}
