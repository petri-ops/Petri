// ============================================================
// BLOCK-68 / UI-317 —— useAutoFileReferenceRefresh 单测：
// 订阅 projectWorkspaceChanged → debounce → 清缓存 + 回调；多次
// 触发防抖合并；卸载清理（不再触发）。真实计时器 + 小 debounce 参数。
// ============================================================
import { cleanup, renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { gewuEvents, dispatchGewuEvent } from '@/lib/events';
import { useAutoFileReferenceRefresh } from './useAutoFileReferenceRefresh';

const { resetCacheMock } = vi.hoisted(() => ({ resetCacheMock: vi.fn() }));

vi.mock('@/lib/chat-file-references', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/chat-file-references')>();
  return {
    ...actual,
    __resetFileReferenceCache: resetCacheMock,
  };
});

const CHANGED = { projectId: 'p_test', source: 'agent' } as const;

function fireChanged() {
  act(() => {
    dispatchGewuEvent(gewuEvents.projectWorkspaceChanged, CHANGED);
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('useAutoFileReferenceRefresh (BLOCK-68 / UI-317)', () => {
  it('debounces workspace-changed events then resets cache and fires callback once', async () => {
    const onRefresh = vi.fn();
    renderHook(() => useAutoFileReferenceRefresh(onRefresh, 40));

    fireChanged();
    fireChanged();
    fireChanged();
    await delay(30);
    // debounce 窗口内不触发
    expect(onRefresh).not.toHaveBeenCalled();
    expect(resetCacheMock).not.toHaveBeenCalled();

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(resetCacheMock).toHaveBeenCalledTimes(1);
  });

  it('stops firing after unmount', async () => {
    const onRefresh = vi.fn();
    const { unmount } = renderHook(() => useAutoFileReferenceRefresh(onRefresh, 40));
    fireChanged();
    unmount();
    await delay(150);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(resetCacheMock).not.toHaveBeenCalled();
  });
});
