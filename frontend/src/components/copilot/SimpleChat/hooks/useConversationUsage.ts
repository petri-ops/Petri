// UI-523 — 会话级用量聚合（GET /api/ai/usage-conversation）。
//
// 数据源是本地 ai_usage（SQLite），后端只做只读投影 ⇒ 同一数字可在
// 设置→用量面复盘（本地可审计，不是云端统计）。
//
// 刷新时机：打开/切换会话、运行结束（refreshKey 变化）、运行中每条
// run-usage 事件触发但 2s 节流（57 步不会打成 57 个请求）。
// 失败语义：网络/401/解析失败一律保留旧值，**不写 0**（不可算 ≠ 0）。
import { useEffect, useRef, useState } from 'react';
import { getApiPrefix, getAuthHeader } from '@/components/copilot/copilotClient';
import { petriEvents } from '@/lib/events';

export interface ConversationUsageSnapshot {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** 0–1；inputTokens=0 时为 0（不可算由消费方按 calls 判定） */
  cacheHitRate: number;
  latencyMs: number;
  /** 端到端平均输出速率；latencyMs=0 时 null（不可算） */
  tokensPerSecond: number | null;
}

interface ConversationUsageState {
  conversationId: string | null;
  data: ConversationUsageSnapshot | null;
}

const REFRESH_THROTTLE_MS = 2000;

function toNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function useConversationUsage(
  conversationId: string | null | undefined,
  refreshKey?: string | number | null,
): ConversationUsageSnapshot | null {
  const id = conversationId ?? null;
  const [state, setState] = useState<ConversationUsageState>({ conversationId: id, data: null });
  const [tick, setTick] = useState(0);
  const lastRefreshRef = useRef(0);

  // 会话切换：render 期归零（旧会话读数不得带到新会话）
  if (state.conversationId !== id) {
    setState({ conversationId: id, data: null });
  }

  // 运行中刷新：run-usage 事件 2s 节流（关闭页面后无定时器残留）
  useEffect(() => {
    const handler = () => {
      const now = Date.now();
      if (now - lastRefreshRef.current < REFRESH_THROTTLE_MS) return;
      lastRefreshRef.current = now;
      setTick((value) => value + 1);
    };
    window.addEventListener(petriEvents.runUsage, handler);
    return () => window.removeEventListener(petriEvents.runUsage, handler);
  }, []);

  useEffect(() => {
    if (!id) return undefined;
    lastRefreshRef.current = Date.now();
    const controller = new AbortController();
    void (async () => {
      try {
        const resp = await fetch(
          `${getApiPrefix()}/ai/usage-conversation?conversationId=${encodeURIComponent(id)}`,
          { headers: getAuthHeader(), signal: controller.signal },
        );
        if (!resp.ok) return;
        const json = (await resp.json()) as Partial<ConversationUsageSnapshot> & { status?: string };
        if (!json || json.status !== 'ok') return;
        setState((current) => (current.conversationId === id
          ? {
            conversationId: id,
            data: {
              calls: toNumber(json.calls),
              inputTokens: toNumber(json.inputTokens),
              outputTokens: toNumber(json.outputTokens),
              cacheReadTokens: toNumber(json.cacheReadTokens),
              cacheHitRate: toNumber(json.cacheHitRate),
              latencyMs: toNumber(json.latencyMs),
              tokensPerSecond: typeof json.tokensPerSecond === 'number' ? json.tokensPerSecond : null,
            },
          }
          : current));
      } catch {
        /* 取消失败/网络失败：保留旧值，不伪造 0 */
      }
    })();
    return () => controller.abort();
  }, [id, tick, refreshKey]);

  return state.conversationId === id ? state.data : null;
}
