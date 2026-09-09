// BLOCK-69 / UI-318 — KnowledgeSpacePanel 组件定向测试
// fetch 全 mock（不发真实网络）；验证诚实空态 / 开关 / 文档清单 / 检索测试框。

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeSpacePanel } from './KnowledgeSpacePanel';
import type { KnowledgeSpaceState } from '@/lib/knowledgeClient';

function spaceState(overrides: Partial<KnowledgeSpaceState> = {}): KnowledgeSpaceState {
  return {
    status: 'ok',
    space: { id: 'ks_default', name: '默认知识空间', enabled: false, embeddingModel: 'text-embedding-v3' },
    documents: [],
    embeddingAvailable: true,
    knowledgeDir: 'C:/data/knowledge',
    queueDepth: 0,
    ...overrides,
  };
}

function mockFetchSequence(responses: Array<{ match: RegExp; body: unknown; status?: number }>) {
  const impl = (url: string, init?: RequestInit) => {
    void init;
    const first = responses.find((r) => r.match.test(url));
    if (!first) return Promise.resolve(new Response(JSON.stringify({ status: 'error', error: 'unmocked ' + url }), { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify(first.body), { status: first.status ?? 200 }));
  };
  const fetchMock = vi.fn(impl as typeof fetch);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BLOCK-69 KnowledgeSpacePanel', () => {
  it('无 DashScope key 时渲染诚实空态并禁用开关（D7）', async () => {
    mockFetchSequence([{ match: /knowledge\/space/, body: spaceState({ embeddingAvailable: false }) }]);
    render(<KnowledgeSpacePanel />);
    await waitFor(() => expect(screen.getByTestId('knowledge-panel')).toBeTruthy());
    expect(screen.getByTestId('knowledge-embed-unavailable').textContent).toContain('DashScope');
    const toggle = screen.getByTestId('knowledge-toggle') as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
  });

  it('文档列表渲染状态与块数；删除按钮存在', async () => {
    mockFetchSequence([
      {
        match: /knowledge\/space/,
        body: spaceState({
          space: { id: 'ks_default', name: '默认知识空间', enabled: true, embeddingModel: 'text-embedding-v3' },
          documents: [
            {
              id: 'kdoc_a', name: '基因笔记.md', kind: 'markdown', size: 2048,
              status: 'ready', error: null, chunkCount: 4,
              createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z',
            },
            {
              id: 'kdoc_b', name: 'bad.pdf', kind: 'text', size: 10,
              status: 'failed', error: 'knowledge_parser_planned_not_implemented:.pdf（该格式解析属 P3/P4，本期未实现）',
              chunkCount: 0, createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z',
            },
          ],
        }),
      },
    ]);
    render(<KnowledgeSpacePanel />);
    await waitFor(() => expect(screen.getAllByTestId('knowledge-doc-row').length).toBe(2));
    expect(screen.getByText(/基因笔记\.md/)).toBeTruthy();
    expect(screen.getByText(/就绪 · 4 块/)).toBeTruthy();
    expect(screen.getByText(/失败 · knowledge_parser_planned_not_implemented/)).toBeTruthy();
  });

  it('检索测试框：输入查询命中结果渲染；无命中诚实提示', async () => {
    const responses = [
      {
        match: /knowledge\/search/,
        body: {
          status: 'ok',
          hits: [
            {
              docId: 'kdoc_a', docName: '基因笔记.md', seq: 0, score: 0.028,
              channels: { vector: 0.82, fts: 1 }, text: 'TP53 参与细胞凋亡调控。',
            },
          ],
          readyChunks: 4,
          embeddingAvailable: true,
          embeddingError: null,
        },
      },
      { match: /knowledge\/space/, body: spaceState() },
    ];
    mockFetchSequence(responses);
    render(<KnowledgeSpacePanel />);
    await waitFor(() => expect(screen.getByTestId('knowledge-search-input')).toBeTruthy());
    fireEvent.change(screen.getByTestId('knowledge-search-input'), { target: { value: 'TP53 凋亡' } });
    fireEvent.click(screen.getByTestId('knowledge-search-btn'));
    await waitFor(() => expect(screen.getByTestId('knowledge-search-hits')).toBeTruthy());
    expect(screen.getByText(/基因笔记\.md · 第 1 块/)).toBeTruthy();
    expect(screen.getByText(/TP53 参与细胞凋亡调控/)).toBeTruthy();

    // 第二次：无命中 → 诚实提示
    responses[0] = { ...responses[0], body: { ...responses[0].body as object, hits: [], readyChunks: 4 } };
    fireEvent.change(screen.getByTestId('knowledge-search-input'), { target: { value: '别的查询' } });
    fireEvent.click(screen.getByTestId('knowledge-search-btn'));
    await waitFor(() => expect(screen.getByText('两条检索通道均无命中。')).toBeTruthy());
  });

  it('清空空间走两步确认（BLOCK-64 先例）', async () => {
    const responses = [
      { match: /knowledge\/space/, body: spaceState({ documents: [{
        id: 'kdoc_a', name: 'a.txt', kind: 'text', size: 10, status: 'ready', error: null,
        chunkCount: 1, createdAt: '', updatedAt: '',
      }] }) },
    ];
    const fetchMock = mockFetchSequence(responses);
    render(<KnowledgeSpacePanel />);
    await waitFor(() => expect(screen.getByTestId('knowledge-clear')).toBeTruthy());
    fireEvent.click(screen.getByTestId('knowledge-clear'));
    // 第一步：只改按钮文案，不发请求
    expect(screen.getByTestId('knowledge-clear').textContent).toContain('确认清空');
    const calls = (fetchMock.mock.calls as unknown[][]).filter((call) => String(call[0]).includes('clear'));
    expect(calls.length).toBe(0);
    // 第二步：确认后才发
    fireEvent.click(screen.getByTestId('knowledge-clear'));
    await waitFor(() => {
      const calls2 = (fetchMock.mock.calls as unknown[][]).filter((call) => String(call[0]).includes('clear'));
      expect(calls2.length).toBe(1);
    });
  });
});
