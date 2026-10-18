// UI-523 — 会话用量聚合 hook：成功取值、失败保留旧值（不伪造 0）、切会话归零、refreshKey 重取。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/components/copilot/copilotClient', () => ({
  getApiPrefix: () => '/api',
  getAuthHeader: () => ({ Authorization: 'Bearer test' }),
}));

import { useConversationUsage } from './useConversationUsage';

const OK_BODY = {
  status: 'ok',
  conversationId: 'conv_a',
  calls: 2,
  inputTokens: 300,
  outputTokens: 150,
  cacheReadTokens: 200,
  cacheHitRate: 2 / 3,
  latencyMs: 1000,
  tokensPerSecond: 150,
};

function okResponse(body: unknown = OK_BODY): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useConversationUsage', () => {
  it('取到会话累计并按字段映射（含 tokensPerSecond）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useConversationUsage('conv_a'));
    await waitFor(() => expect(result.current?.calls).toBe(2));
    expect(result.current?.inputTokens).toBe(300);
    expect(result.current?.outputTokens).toBe(150);
    expect(result.current?.tokensPerSecond).toBe(150);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/ai/usage-conversation?conversationId=conv_a');
  });

  it('网络失败保留旧值：不把不可算写成 0', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse())
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      ({ refreshKey }: { refreshKey: string }) => useConversationUsage('conv_a', refreshKey),
      { initialProps: { refreshKey: 'running' } },
    );
    await waitFor(() => expect(result.current?.calls).toBe(2));

    rerender({ refreshKey: 'done' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current?.calls).toBe(2); // 旧值仍在
  });

  it('401 不写入任何数据（未授权时不显示假读数）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const { result } = renderHook(() => useConversationUsage('conv_a'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current).toBeNull();
  });

  it('会话切换立即归零，且只接受新会话响应', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
    const { result, rerender } = renderHook(({ id }: { id: string }) => useConversationUsage(id), {
      initialProps: { id: 'conv_a' },
    });
    await waitFor(() => expect(result.current?.calls).toBe(2));

    rerender({ id: 'conv_b' });
    expect(result.current).toBeNull();
  });

  it('无会话 id 不发请求（新会话空态零网络）', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useConversationUsage(null));
    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
