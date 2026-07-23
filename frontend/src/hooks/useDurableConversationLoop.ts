import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationLoopState } from '@/components/copilot/conversationRunStore';
import {
  fetchLoopSessionSummary,
  type LoopIterationCompact,
  type LoopSessionSummary,
} from '@/lib/loop-client';

const EMPTY_SUMMARY: LoopSessionSummary = {
  run: null,
  iterations: [],
  activeCount: 0,
  backgroundCount: 0,
  usage: {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    estimatedCostCny: 0,
    unknownCostCalls: 0,
    failedCalls: 0,
    cacheHitRate: 0,
    costStatus: 'estimated',
  },
};

function toLoopState(summary: LoopSessionSummary): ConversationLoopState | null {
  if (!summary.run) return null;
  const conclusions = summary.iterations.filter((item) => item.publicConclusion?.trim());
  const latest = conclusions[conclusions.length - 1];
  return {
    loopRunId: summary.run.loopRunId,
    phase: summary.run.loopStatus,
    automationMode: summary.run.automationMode || undefined,
    executionIntent: summary.run.executionIntent || undefined,
    latestConclusion: latest?.publicConclusion || undefined,
    recoveryRequired: Boolean(summary.run.recoveryRequired),
    iterations: summary.iterations.map(toIterationEvent),
    lastDecision: latest?.decision,
  };
}

function toIterationEvent(iteration: LoopIterationCompact) {
  return {
    loopRunId: iteration.loopRunId,
    iterationId: iteration.iterationId,
    sequence: iteration.sequence,
    decision: iteration.decision,
    decisionReasonCode: iteration.decisionReasonCode,
    publicConclusion: iteration.publicConclusion || '',
    status: iteration.status,
    proposedActionKey: null,
    actionKeyHash: null,
  };
}

function mergeLoopState(
  durable: ConversationLoopState | null,
  live: ConversationLoopState | null | undefined
): ConversationLoopState | null {
  if (!live?.loopRunId) return durable;
  if (!durable || durable.loopRunId !== live.loopRunId) return live;
  const byId = new Map(durable.iterations.map((item) => [item.iterationId, item]));
  live.iterations.forEach((item) => byId.set(item.iterationId, item));
  const iterations = [...byId.values()].sort((a, b) => a.sequence - b.sequence);
  return {
    ...durable,
    ...live,
    latestConclusion: live.latestConclusion || durable.latestConclusion,
    recoveryRequired: live.recoveryRequired || durable.recoveryRequired,
    iterations,
    lastDecision: live.lastDecision || durable.lastDecision,
  };
}

/**
 * Rehydrates Loop truth whenever a conversation is opened. Live SSE is merged
 * over the same IDs, so restart/reopen and in-flight rendering share one
 * projection without inventing a second completion state.
 */
export function useDurableConversationLoop(
  projectId: string | null | undefined,
  conversationId: string | null | undefined,
  liveLoop?: ConversationLoopState | null
) {
  const [summary, setSummary] = useState<LoopSessionSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!projectId || !conversationId) {
      setSummary(EMPTY_SUMMARY);
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const next = await fetchLoopSessionSummary({ projectId, conversationId });
      if (requestRef.current !== requestId) return;
      setSummary(next);
      setError('');
    } catch (reason) {
      if (requestRef.current !== requestId) return;
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [conversationId, projectId]);

  useEffect(() => {
    void refresh();
    return () => {
      requestRef.current += 1;
    };
  }, [refresh]);

  const liveTerminal = liveLoop && ['completed', 'failed', 'cancelled', 'blocked'].includes(liveLoop.phase);
  useEffect(() => {
    if (!liveTerminal) return;
    const timer = window.setTimeout(() => void refresh(), 200);
    return () => window.clearTimeout(timer);
  }, [liveTerminal, liveLoop?.loopRunId, refresh]);

  const loop = useMemo(
    () => mergeLoopState(toLoopState(summary), liveLoop),
    [liveLoop, summary]
  );

  return { loop, summary, loading, error, refresh };
}
