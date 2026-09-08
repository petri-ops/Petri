// ============================================================
// useSummaryRetry — AI 总结重试状态簇（UI-305 P0.2）
//
// 从 SimpleChat.tsx 整簇平移（原 297-303 的 5 个 useState + retrySummary
// useCallback + UX1H 冷却 tick effect），簇内 hook 相对顺序保持原样，
// 零行为变化。重试走 retryToolSummary：成功追加 assistant 消息并清计数/
// 冷却，失败按 RETRY_BACKOFF_MS 退避，MAX_SUMMARY_RETRIES 次后放弃。
// retryTick 仅作冷却期重渲染触发器（让「冷却中 Ns」标签秒级刷新）。
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { retryToolSummary } from '../../copilotClient';
import { clearConversationRun } from '../../conversationRunStore';
import type { ChatModelPreset } from '@/hooks/useAiSettings';
import type { SimpleMessage } from '../types';

const MAX_SUMMARY_RETRIES = 3;
const RETRY_BACKOFF_MS = [2000, 4000, 8000];

export interface SummaryRetryController {
  retrySummary: (toolJobId: string) => Promise<void>;
  summaryRetryState: Record<string, 'running' | 'done'>;
  summaryRetryErrors: Record<string, string>;
  summaryRetryAttempts: Record<string, number>;
  summaryRetryCooldownUntil: Record<string, number>;
  MAX_SUMMARY_RETRIES: number;
  retryTick: number;
}

export function useSummaryRetry({
  conversationId,
  projectId,
  activeModel,
  activeModelId,
  refreshConversations,
  appendAssistantMessage,
}: {
  conversationId: string | null;
  projectId: string;
  activeModel: ChatModelPreset | null;
  activeModelId: string;
  refreshConversations: () => Promise<void>;
  appendAssistantMessage: (message: SimpleMessage) => void;
}): SummaryRetryController {
  const [summaryRetryState, setSummaryRetryState] = useState<Record<string, 'running' | 'done'>>({});
  const [summaryRetryErrors, setSummaryRetryErrors] = useState<Record<string, string>>({});
  const [summaryRetryAttempts, setSummaryRetryAttempts] = useState<Record<string, number>>({});
  const [summaryRetryCooldownUntil, setSummaryRetryCooldownUntil] = useState<Record<string, number>>({});
  const [retryTick, setRetryTick] = useState(0);

  const retrySummary = useCallback(async (toolJobId: string) => {
    const attempts = summaryRetryAttempts[toolJobId] ?? 0;
    if (!conversationId) return;
    if (summaryRetryState[toolJobId] === 'running') return;
    if (attempts >= MAX_SUMMARY_RETRIES) return;
    if (Date.now() < (summaryRetryCooldownUntil[toolJobId] ?? 0)) return;
    setSummaryRetryState((current) => ({ ...current, [toolJobId]: 'running' }));
    setSummaryRetryErrors((current) => {
      const next = { ...current };
      delete next[toolJobId];
      return next;
    });
    try {
      const content = await retryToolSummary({
        toolJobId,
        projectId,
        conversationId,
        modelPresetId: activeModel?.endpointProfileId || activeModelId,
      });
      appendAssistantMessage({
        role: 'assistant',
        content,
        ts: new Date().toISOString(),
      });
      clearConversationRun(conversationId);
      setSummaryRetryState((current) => ({ ...current, [toolJobId]: 'done' }));
      setSummaryRetryAttempts((current) => {
        const next = { ...current };
        delete next[toolJobId];
        return next;
      });
      setSummaryRetryCooldownUntil((current) => {
        const next = { ...current };
        delete next[toolJobId];
        return next;
      });
      await refreshConversations();
    } catch (error) {
      const nextAttempts = attempts + 1;
      setSummaryRetryAttempts((current) => ({ ...current, [toolJobId]: nextAttempts }));
      setSummaryRetryState((current) => {
        const next = { ...current };
        delete next[toolJobId];
        return next;
      });
      setSummaryRetryErrors((current) => ({
        ...current,
        [toolJobId]: error instanceof Error ? error.message : 'AI 总结仍不可用，请稍后重试',
      }));
      if (nextAttempts < MAX_SUMMARY_RETRIES) {
        const backoff = RETRY_BACKOFF_MS[nextAttempts - 1] ?? 8000;
        setSummaryRetryCooldownUntil((current) => ({ ...current, [toolJobId]: Date.now() + backoff }));
      }
    }
  }, [activeModel, activeModelId, appendAssistantMessage, conversationId, projectId, refreshConversations, summaryRetryState, summaryRetryAttempts, summaryRetryCooldownUntil]);

  // UX1H: tick while any summary-retry cooldown is active so the "冷却中 Ns"
  // label and re-enable update without a full external re-render.
  useEffect(() => {
    const now = Date.now();
    const active = Object.values(summaryRetryCooldownUntil).filter((until) => until > now);
    if (active.length === 0) return;
    const minUntil = Math.min(...active);
    const timer = window.setTimeout(() => setRetryTick((t) => t + 1), Math.max(250, minUntil - Date.now()));
    return () => window.clearTimeout(timer);
  }, [summaryRetryCooldownUntil, retryTick]);

  return {
    retrySummary,
    summaryRetryState,
    summaryRetryErrors,
    summaryRetryAttempts,
    summaryRetryCooldownUntil,
    MAX_SUMMARY_RETRIES,
    retryTick,
  };
}
