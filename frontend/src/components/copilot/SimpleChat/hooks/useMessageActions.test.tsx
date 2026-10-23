// BLOCK-246 C4 — 宿主动作簇：加入上下文产单列表条目；评价乐观更新 + 失败回滚。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

type RatingCall = { messageKey: string; rating: 'up' | 'down' | null; conversationId: string | null; projectId: string | null };

const setMessageRating = vi.fn<(input: RatingCall) => Promise<null>>();
vi.mock('@/lib/messageRatingClient', () => ({
  setMessageRating: (input: RatingCall) => setMessageRating(input),
}));

import { useMessageActions } from './useMessageActions';
import type { ComposerContextItem } from '../contextItems';

afterEach(() => {
  cleanup();
  setMessageRating.mockReset();
});

function setup(overrides: Partial<Parameters<typeof useMessageActions>[0]> = {}) {
  const addItem = vi.fn<(item: ComposerContextItem) => void>();
  const onNotice = vi.fn<(message: string | null) => void>();
  const hook = renderHook(() => useMessageActions({
    conversationId: 'conv_1',
    projectId: 'proj_1',
    addItem,
    onNotice,
    ...overrides,
  }));
  return { addItem, onNotice, hook };
}

describe('useMessageActions', () => {
  it('quoting a reply produces a reference-group context item', () => {
    const { addItem, hook } = setup();
    act(() => { hook.result.current.rowProps('k1').onQuoteToContext('k1', '这是上一条回复'); });
    expect(addItem).toHaveBeenCalledTimes(1);
    const item = addItem.mock.calls[0][0];
    expect(item.kind).toBe('message');
    expect(item.group).toBe('reference');
    expect(item.dedupeKey).toBe('message|k1');
    expect(item.lines.join('\n')).toContain('这是上一条回复');
  });

  it('rates optimistically, persists, and toggles off on second click', async () => {
    setMessageRating.mockResolvedValue(null);
    const { hook } = setup();
    act(() => { hook.result.current.rowProps('k1').onRateMessage('k1', 'up'); });
    expect(hook.result.current.rowProps('k1').messageRating).toBe('up');
    expect(setMessageRating).toHaveBeenCalledWith({
      messageKey: 'k1',
      rating: 'up',
      conversationId: 'conv_1',
      projectId: 'proj_1',
    });
    await act(() => Promise.resolve());

    act(() => { hook.result.current.rowProps('k1').onRateMessage('k1', 'up'); });
    expect(hook.result.current.rowProps('k1').messageRating).toBeNull();
    expect(setMessageRating).toHaveBeenLastCalledWith(expect.objectContaining({ rating: null }));
  });

  it('rolls back and surfaces a notice when persistence fails', async () => {
    setMessageRating.mockRejectedValue(new Error('评价失败（HTTP 500）'));
    const { hook, onNotice } = setup();
    act(() => { hook.result.current.rowProps('k9').onRateMessage('k9', 'down'); });
    await act(() => Promise.resolve());
    expect(hook.result.current.rowProps('k9').messageRating).toBeNull();
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('HTTP 500'));
  });
});
