// UI-523 — petri:run-usage 订阅语义：最近一次调用、会话过滤、切会话归零。
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { dispatchPetriEvent, petriEvents, type RunUsageDetail } from '@/lib/events';
import { useRunUsage } from './useRunUsage';

afterEach(cleanup);

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
    at: '2026-10-18T00:00:00.000Z',
    ...over,
  };
}

describe('useRunUsage', () => {
  it('接受本会话事件，保留最近一次（不是累加）', () => {
    const { result } = renderHook(() => useRunUsage('conv_a'));
    expect(result.current).toBeNull();

    act(() => dispatchPetriEvent(petriEvents.runUsage, detail({ completionTokens: 10 })));
    expect(result.current?.completionTokens).toBe(10);

    act(() => dispatchPetriEvent(petriEvents.runUsage, detail({ completionTokens: 99, iteration: 4 })));
    expect(result.current?.completionTokens).toBe(99);
    expect(result.current?.iteration).toBe(4);
  });

  it('忽略他会话事件（双会话同时流式不串号）', () => {
    const { result } = renderHook(() => useRunUsage('conv_a'));
    act(() => dispatchPetriEvent(petriEvents.runUsage, detail({ conversationId: 'conv_b', completionTokens: 42 })));
    expect(result.current).toBeNull();
  });

  it('会话切换归零：上一会话读数不得带到新会话', () => {
    const { result, rerender } = renderHook(({ id }: { id: string }) => useRunUsage(id), {
      initialProps: { id: 'conv_a' },
    });
    act(() => dispatchPetriEvent(petriEvents.runUsage, detail({ conversationId: 'conv_a' })));
    expect(result.current).not.toBeNull();

    rerender({ id: 'conv_b' });
    expect(result.current).toBeNull();
  });

  it('后端未标 conversationId 的事件放行（兼容旧后端/无会话调用）', () => {
    const { result } = renderHook(() => useRunUsage('conv_a'));
    act(() => dispatchPetriEvent(petriEvents.runUsage, detail({ conversationId: null, completionTokens: 7 })));
    expect(result.current?.completionTokens).toBe(7);
  });
});
