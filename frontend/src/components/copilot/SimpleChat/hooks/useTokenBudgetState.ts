// BLOCK-92 Wave A-3 — token 预算事件状态（自主组件平移，零行为变化）：
// 订阅 petri token_budget 事件（BLOCK-20），驱动 ContextBudgetButton。
import { useEffect, useState } from 'react';
import { petriEvents } from '@/lib/events';
import type { TokenBudget } from '../../ContextBudgetBar';

export function useTokenBudgetState(): TokenBudget | null {
  const [tokenBudget, setTokenBudget] = useState<TokenBudget | null>(null);

  // BLOCK-20: token budget event listener — updates ContextBudgetButton state
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<import('@/lib/events').TokenBudgetDetail>).detail;
      setTokenBudget({
        contextWindow: detail.contextWindow,
        messagesTokensUsed: detail.messagesTokensUsed,
        messagesKept: 0,
        messagesDropped: 0,
        pct: detail.pct,
        trimmed: detail.trimmed,
        knowledgeTokens: detail.knowledgeTokens,
        breakdown: detail.breakdown,
      });
    };
    window.addEventListener(petriEvents.tokenBudget, handler);
    return () => window.removeEventListener(petriEvents.tokenBudget, handler);
  }, []);

  return tokenBudget;
}
