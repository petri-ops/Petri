// BLOCK-255 C4 — 实时本轮 usage 合计：累加、会话过滤、run 归零、早于本轮事件丢弃。
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { dispatchPetriEvent, petriEvents, type RunUsageDetail } from '@/lib/events';
import { useRunUsageTotals } from './useRunUsageTotals';

afterEach(cleanup);

const STARTED = Date.parse('2026-10-25T00:00:00.000Z');

function detail(over: Partial<RunUsageDetail> = {}): RunUsageDetail {
  return {
    conversationId: 'conv_a',
    iteration: 1,
    attempt: 1,
    model: 'deepseek-chat',
    promptTokens: 100,
    completionTokens: 10,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    durationMs: 1000,
    at: '2026-10-25T00:00:01.000Z',
    ...over,
  };
}

describe('useRunUsageTotals', () => {
  it('累加本会话事件（不是只保留最近一次）', () => {
    const { result } = renderHook(() => useRunUsageTotals('conv_a', STARTED));
    expect(result.current).toBeNull();
    act(() => dispatchPetriEvent(petriEvents.runUsage, detail({ promptTokens: 100, completionTokens: 10 })));
    act(() => dispatchPetriEvent(petriEvents.runUsage, detail({ promptTokens: 200, completionTokens: 20 })));
    expect(result.current?.calls).toBe(2);
    expect(result.current?.promptTokens).toBe(300);
    expect(result.current?.completionTokens).toBe(30);
    expect(result.current?.models).toEqual(['deepseek-chat']);
  });

  it('忽略他会话事件与早于本轮开始的事件', () => {
    const { result } = renderHook(() => useRunUsageTotals('conv_a', STARTED));
    act(() => dispatchPetriEvent(petriEvents.runUsage, detail({ conversationId: 'conv_b', promptTokens: 999 })));
    act(() => dispatchPetriEvent(petriEvents.runUsage, detail({
      promptTokens: 888,
      at: '2026-10-24T23:00:00.000Z',
    })));
    expect(result.current).toBeNull();
  });

  it('新 run 开始归零', () => {
    const { result, rerender } = renderHook(
      ({ startedAt }: { startedAt: number }) => useRunUsageTotals('conv_a', startedAt),
      { initialProps: { startedAt: STARTED } },
    );
    act(() => dispatchPetriEvent(petriEvents.runUsage, detail()));
    expect(result.current?.calls).toBe(1);
    rerender({ startedAt: STARTED + 10_000 });
    expect(result.current).toBeNull();
  });

  it('无 run 时不累计', () => {
    const { result } = renderHook(() => useRunUsageTotals('conv_a', null));
    act(() => dispatchPetriEvent(petriEvents.runUsage, detail({ at: '2026-10-25T00:00:20.000Z' })));
    expect(result.current).toBeNull();
  });
});
