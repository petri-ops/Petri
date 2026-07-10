import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useConversations,
  useOtherConversations,
  __resetConversationsCacheForTests,
} from '@/hooks/useConversations';
import * as cc from '@/components/copilot/copilotConversationsClient';

vi.mock('@/components/copilot/copilotConversationsClient', () => ({
  listConversations: vi.fn(),
  createConversation: vi.fn(),
  getConversationMessages: vi.fn(),
  deleteConversation: vi.fn(),
}));

const mockedList = cc.listConversations as unknown as ReturnType<typeof vi.fn>;
const mockedCreate = cc.createConversation as unknown as ReturnType<typeof vi.fn>;

function makeConv(id: string, title: string, projectId: string | null = 'p-1') {
  return {
    id,
    title,
    status: 'active' as const,
    last_page: null,
    message_count: 0,
    created_at: '2026-07-10T00:00:00Z',
    updated_at: '2026-07-10T00:00:00Z',
    project_id: projectId,
  };
}

beforeEach(() => {
  __resetConversationsCacheForTests();
  mockedList.mockReset();
  mockedCreate.mockReset();
});

describe('useConversations', () => {
  it('loads on mount', async () => {
    mockedList.mockResolvedValueOnce([makeConv('c-1', 'hello')]);
    const { result } = renderHook(() => useConversations('p-1'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.list).toHaveLength(1);
    expect(result.current.list[0].id).toBe('c-1');
  });

  it('seeds from the shared cache on remount (no duplicate fetch)', async () => {
    mockedList.mockResolvedValueOnce([makeConv('c-1', 'hello')]);
    const first = renderHook(() => useConversations('p-1'));
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    // Second mount of the same projectId must not refetch.
    const second = renderHook(() => useConversations('p-1'));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(second.result.current.list).toHaveLength(1);
  });

  it('refresh forces a re-fetch', async () => {
    mockedList.mockResolvedValueOnce([makeConv('c-1', 'hello')]);
    const { result } = renderHook(() => useConversations('p-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockedList.mockResolvedValueOnce([
      makeConv('c-1', 'hello'),
      makeConv('c-2', 'world'),
    ]);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.list).toHaveLength(2);
  });

  it('create prepends to the shared cache', async () => {
    mockedList.mockResolvedValueOnce([makeConv('c-1', 'hello')]);
    const first = renderHook(() => useConversations('p-1'));
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    mockedCreate.mockResolvedValueOnce(makeConv('c-2', 'new', 'p-1'));
    const created = await act(async () => {
      return await first.result.current.create('new');
    });
    expect(created?.id).toBe('c-2');
    expect(first.result.current.list.map((c) => c.id)).toEqual(['c-2', 'c-1']);
  });

  it('handles projectId change by resetting + reloading', async () => {
    mockedList.mockResolvedValueOnce([makeConv('c-1', 'hello')]);
    const { result, rerender } = renderHook(
      ({ pid }: { pid: string }) => useConversations(pid),
      { initialProps: { pid: 'p-1' } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockedList.mockResolvedValueOnce([makeConv('c-9', 'other')]);
    rerender({ pid: 'p-2' });
    await waitFor(() => expect(result.current.list.map((c) => c.id)).toEqual(['c-9']));
  });

  it('null projectId returns empty list without fetching', () => {
    mockedList.mockClear();
    const { result } = renderHook(() => useConversations(null));
    expect(result.current.list).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(mockedList).not.toHaveBeenCalled();
  });

  it('surfaces fetch errors', async () => {
    mockedList.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useConversations('p-1'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBe('boom');
  });
});

describe('useOtherConversations', () => {
  it('lazily loads each expanded project exactly once', async () => {
    mockedList.mockImplementation(async (status, pid) => {
      if (pid === 'p-a') return [makeConv('a-1', 'a', 'p-a')];
      if (pid === 'p-b') return [makeConv('b-1', 'b', 'p-b')];
      return [];
    });
    const { result } = renderHook(() =>
      useOtherConversations(new Set(['p-a', 'p-b']), 'p-current')
    );
    await waitFor(() => {
      expect(Object.keys(result.current.byProjectId).sort()).toEqual(['p-a', 'p-b']);
    });
    expect(mockedList).toHaveBeenCalledTimes(2);
    expect(result.current.byProjectId['p-a']).toHaveLength(1);
    expect(result.current.byProjectId['p-b']).toHaveLength(1);
  });

  it('excludes the current projectId', async () => {
    mockedList.mockResolvedValue([]);
    const { result } = renderHook(() =>
      useOtherConversations(new Set(['p-current', 'p-other']), 'p-current')
    );
    await waitFor(() => {
      expect(result.current.byProjectId['p-current']).toBeUndefined();
    });
    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(mockedList).toHaveBeenCalledWith('active', 'p-other');
  });

  it('seeds from the shared cache without re-fetching', async () => {
    // Prime the shared cache by mounting useConversations first.
    mockedList.mockResolvedValueOnce([makeConv('a-1', 'a')]);
    const first = renderHook(() => useConversations('p-a'));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    mockedList.mockClear();
    // p-b needs a default mock value now (mockClear empties the queue).
    mockedList.mockResolvedValueOnce([makeConv('b-1', 'b')]);

    const second = renderHook(() =>
      useOtherConversations(new Set(['p-a', 'p-b']), 'p-current')
    );
    await waitFor(() => {
      expect(second.result.current.byProjectId['p-a']).toBeDefined();
      expect(second.result.current.byProjectId['p-b']).toBeDefined();
    });
    // p-a was already cached, so only p-b needs to fetch.
    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(mockedList).toHaveBeenCalledWith('active', 'p-b');
  });
});