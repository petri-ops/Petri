/**
 * BLOCK-323 — PolicyReviewBridge 契约：≥阈值推一条 review_available 通知，
 * 同一批观察（最新 id 不变）不重复提醒；复盘后新观察（更大 id）再触发。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';

const pushNotice = vi.fn<(input: { kind: string; title: string; body: string }) => unknown>();

vi.mock('@/lib/notification-center', () => ({
  pushNotice: (...args: [{ kind: string; title: string; body: string }]) => pushNotice(...args),
}));

const { PolicyReviewBridge } = await import('./PolicyReviewBridge');

function observationsResponse(count: number, maxId: number) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      status: 'ok',
      unreviewedCount: count,
      unreviewed: Array.from({ length: count }, (_, i) => ({ id: maxId - i })),
    }),
  } as unknown as Response;
}

describe('PolicyReviewBridge（BLOCK-323 复盘通知）', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    pushNotice.mockClear();
  });

  it('未复盘 ≥3：推一条 review_available；同 id 不重复', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fetchMock = vi.fn().mockResolvedValue(observationsResponse(5, 9));
      vi.stubGlobal('fetch', fetchMock);
      render(<PolicyReviewBridge />);
      await vi.advanceTimersByTimeAsync(0);
      await waitFor(() => expect(pushNotice).toHaveBeenCalledTimes(1));
      const first = pushNotice.mock.calls[0]?.[0] as { kind: string; body: string };
      expect(first).toMatchObject({ kind: 'review_available' });
      expect(first.body).toContain('5');
      // 同一批观察（最新 id 仍 9）：60s 后再轮询不重复提醒
      await vi.advanceTimersByTimeAsync(60_000);
      expect(pushNotice).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('低于阈值不提醒；新观察（更大 id）再触发', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(observationsResponse(1, 3))
        .mockResolvedValue(observationsResponse(4, 12));
      vi.stubGlobal('fetch', fetchMock);
      render(<PolicyReviewBridge />);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_000);
      await waitFor(() => expect(pushNotice).toHaveBeenCalledTimes(1));
      const first = pushNotice.mock.calls[0]?.[0] as { kind: string; body: string };
      expect(first.body).toContain('4');
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
