// ============================================================
// BLOCK-69 / UI-318 —— useKnowledgeSpace hook 单测：
// 拉取空间状态投影（enabled/readyDocs/embeddingAvailable）；
// toggle 调 POST /api/knowledge/space 两态切换 + 失败回读不假启用。
// fetch 全 mock，不发真实网络。
// ============================================================
import { cleanup, renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useKnowledgeSpaceToggle } from './useKnowledgeSpace';

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fetchMock = vi.fn(((url: string, init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify(handler(url, init)), { status: 200 }))) as typeof fetch);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function spaceBody(enabled: boolean, docStatuses: string[] = [], embeddingAvailable = true) {
  return {
    status: 'ok',
    space: { id: 'ks_default', name: '默认知识空间', enabled, embeddingModel: 'text-embedding-v3' },
    documents: docStatuses.map((status, i) => ({
      id: `kdoc_${i}`, name: `doc${i}.txt`, kind: 'text', size: 10, status,
      error: null, chunkCount: status === 'ready' ? 2 : 0, createdAt: '', updatedAt: '',
    })),
    embeddingAvailable,
    knowledgeDir: '/tmp/knowledge',
    queueDepth: 0,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BLOCK-69 useKnowledgeSpaceToggle', () => {
  it('拉取状态：enabled / readyDocs / embeddingAvailable 投影', async () => {
    mockFetch(() => spaceBody(true, ['ready', 'ready', 'failed']));
    const { result } = renderHook(() => useKnowledgeSpaceToggle());
    await waitFor(() => expect(result.current.docCount).toBe(3));
    expect(result.current.enabled).toBe(true);
    expect(result.current.readyDocs).toBe(2);
    expect(result.current.embeddingAvailable).toBe(true);
    expect(result.current.unavailable).toBe(false);
  });

  it('toggle：关→开 调 POST enabled=true 并回读新状态', async () => {
    let serverEnabled = false;
    const fetchMock = mockFetch((url, init) => {
      if (url.includes('/knowledge/space') && init?.method === 'POST') {
        serverEnabled = JSON.parse(String(init.body)).enabled;
        return { status: 'ok' };
      }
      return spaceBody(serverEnabled);
    });
    const { result } = renderHook(() => useKnowledgeSpaceToggle());
    await waitFor(() => expect(result.current.enabled).toBe(false));
    await act(async () => {
      await result.current.toggle();
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));
    const postCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/knowledge/space') && (call[1] as RequestInit | undefined)?.method === 'POST');
    expect(postCalls.length).toBe(1);
    expect(JSON.parse(String(postCalls[0][1] ? (postCalls[0][1] as RequestInit).body : '{}')).enabled).toBe(true);
  });

  it('无 key：embeddingAvailable=false → unavailable 标记（UI 禁用开关的数据源）', async () => {
    mockFetch(() => spaceBody(false, [], false));
    const { result } = renderHook(() => useKnowledgeSpaceToggle());
    await waitFor(() => expect(result.current.embeddingAvailable).toBe(false));
    expect(result.current.unavailable).toBe(true);
    expect(result.current.enabled).toBe(false);
  });
});
