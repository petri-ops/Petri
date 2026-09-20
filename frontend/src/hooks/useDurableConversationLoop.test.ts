import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLoopSessionSummary } from '@/lib/loop-client';
import { useDurableConversationLoop } from './useDurableConversationLoop';

vi.mock('@/lib/loop-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/loop-client')>();
  return { ...actual, fetchLoopSessionSummary: vi.fn() };
});

const fetchSummaryMock = vi.mocked(fetchLoopSessionSummary);

function summary() {
  return {
    run: {
      loopRunId: 'loop-1',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      taskSpecRef: 'spec',
      automationMode: 'trusted',
      executionIntent: 'task_execute' as const,
      loopStatus: 'running' as const,
      hash: 'hash',
      isPartial: false,
      partialReason: null,
      recoveryRequired: false,
      recoveryReason: null,
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:01:00.000Z',
    },
    iterations: [{
      iterationId: 'iteration-1',
      loopRunId: 'loop-1',
      sequence: 1,
      decision: 'continue',
      decisionReasonCode: 'TOOL_SUCCEEDED',
      status: 'succeeded',
      publicConclusion: '质控完成',
      createdAt: '2026-07-24T00:01:00.000Z',
    }],
    activeCount: 2,
    backgroundCount: 1,
    usage: {
      calls: 2,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 50,
      cacheCreationTokens: 0,
      estimatedCostCny: 0.01,
      unknownCostCalls: 0,
      failedCalls: 0,
      cacheHitRate: 0.5,
      costStatus: 'estimated' as const,
    },
  };
}

describe('useDurableConversationLoop', () => {
  beforeEach(() => {
    fetchSummaryMock.mockReset();
    fetchSummaryMock.mockResolvedValue(summary());
  });

  it('rehydrates the latest public loop state and session metrics', async () => {
    const { result } = renderHook(() =>
      useDurableConversationLoop('project-1', 'conversation-1')
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchSummaryMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      conversationId: 'conversation-1',
    });
    expect(result.current.loop).toMatchObject({
      loopRunId: 'loop-1',
      phase: 'running',
      automationMode: 'trusted',
      executionIntent: 'task_execute',
      latestConclusion: '质控完成',
    });
    expect(result.current.summary.backgroundCount).toBe(1);
    expect(result.current.summary.usage.inputTokens).toBe(100);
  });

  it('merges live SSE by iteration id over the durable replay', async () => {
    const live = {
      loopRunId: 'loop-1',
      phase: 'running',
      recoveryRequired: false,
      iterations: [{
        loopRunId: 'loop-1',
        iterationId: 'iteration-1',
        sequence: 1,
        decision: 'retry',
        decisionReasonCode: 'TRANSIENT_RUNTIME_RETRY',
        publicConclusion: '自动修复后重试',
        status: 'failed',
        proposedActionKey: null,
        actionKeyHash: null,
      }],
      latestConclusion: '自动修复后重试',
      lastDecision: 'retry',
    };
    const { result } = renderHook(() =>
      useDurableConversationLoop('project-1', 'conversation-1', live)
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loop?.iterations).toHaveLength(1);
    expect(result.current.loop?.iterations[0].decision).toBe('retry');
    expect(result.current.loop?.latestConclusion).toBe('自动修复后重试');
  });

  it('clears stale state when no conversation is selected', async () => {
    const { result, rerender } = renderHook(
      ({ conversationId }) =>
        useDurableConversationLoop('project-1', conversationId),
      { initialProps: { conversationId: 'conversation-1' } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => rerender({ conversationId: null }));
    await waitFor(() => expect(result.current.loop).toBeNull());
  });
});
