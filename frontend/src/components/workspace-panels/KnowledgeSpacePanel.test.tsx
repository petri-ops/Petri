// BLOCK-69 / UI-318 — KnowledgeSpacePanel 组件定向测试
// fetch 全 mock（不发真实网络）；验证诚实空态 / 开关 / 文档清单 / 检索测试框。
// BLOCK-103：面板新增 useNavigate（去设置动作卡）→ 渲染统一包 MemoryRouter；
// 检索预览移入独立页签（检索用例先点 knowledge-tab-search）；行为基线八项语义保留。

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { KnowledgeSpacePanel } from './KnowledgeSpacePanel';
import type { KnowledgeSpaceState } from '@/lib/knowledgeClient';

function renderPanel(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <KnowledgeSpacePanel />
    </MemoryRouter>
  );
}

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
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('knowledge-panel')).toBeTruthy());
    expect(screen.getByTestId('knowledge-embed-unavailable').textContent).toContain('DashScope');
    const toggle = screen.getByTestId<HTMLButtonElement>('knowledge-toggle');
    expect(toggle.disabled).toBe(true);
    // BLOCK-103 D3 — hero 空态 + 缺 key 附「去设置」动作卡
    expect(screen.getByTestId('knowledge-empty-hero')).toBeTruthy();
    expect(screen.getByTestId('knowledge-open-settings')).toBeTruthy();
  });

  it('BLOCK-103 D1 — 双页签往返：默认文档库（hero/列表），切检索预览回文档库', async () => {
    mockFetchSequence([{ match: /knowledge\/space/, body: spaceState() }]);
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('knowledge-empty-hero')).toBeTruthy());
    fireEvent.click(screen.getByTestId('knowledge-tab-search'));
    await waitFor(() => expect(screen.getByTestId('knowledge-search-input')).toBeTruthy());
    expect(screen.queryByTestId('knowledge-empty-hero')).toBeNull();
    fireEvent.click(screen.getByTestId('knowledge-tab-docs'));
    await waitFor(() => expect(screen.getByTestId('knowledge-empty-hero')).toBeTruthy());
    expect(screen.queryByTestId('knowledge-search-input')).toBeNull();
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
              id: 'kdoc_b', name: 'bad.docx', kind: 'text', size: 10,
              status: 'failed', error: 'knowledge_parser_planned_not_implemented:.docx（该格式解析属 P4 线，本期未实现）',
              chunkCount: 0, createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z',
            },
          ],
        }),
      },
    ]);
    renderPanel();
    await waitFor(() => expect(screen.getAllByTestId('knowledge-doc-row').length).toBe(2));
    // BLOCK-94 F5 起：ready 文档名同时出现在文档按钮与检索过滤下拉 → 用 testid 断言
    expect(screen.getAllByTestId('knowledge-doc-name')[0].textContent).toContain('基因笔记.md');
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
    renderPanel();
    // BLOCK-103 D1 — 检索预览移入独立页签：先切页签再断言输入框
    await waitFor(() => expect(screen.getByTestId('knowledge-tab-search')).toBeTruthy());
    fireEvent.click(screen.getByTestId('knowledge-tab-search'));
    await waitFor(() => expect(screen.getByTestId('knowledge-search-input')).toBeTruthy());
    fireEvent.change(screen.getByTestId('knowledge-search-input'), { target: { value: 'TP53 凋亡' } });
    fireEvent.click(screen.getByTestId('knowledge-search-btn'));
    await waitFor(() => expect(screen.getByTestId('knowledge-search-hits')).toBeTruthy());
    expect(screen.getByText(/基因笔记\.md · 第 1 块/)).toBeTruthy();
    // F5 命中高亮会把文本拆分为多个 <mark>/文本片段 → 用容器 textContent 断言
    const hitsText = screen.getByTestId('knowledge-search-hits').textContent || '';
    expect(hitsText).toContain('TP53');
    expect(hitsText).toContain('参与细胞凋亡调控');

    // 第二次：无命中 → 诚实提示
    responses[0] = {
      ...responses[0],
      body: {
        status: 'ok',
        hits: [],
        readyChunks: 4,
        embeddingAvailable: true,
        embeddingError: null,
      },
    };
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
    renderPanel();
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

  it('BLOCK-94 F3：上传逐文件错误聚合（部分失败不再只显示第一个）', async () => {
    const responses = [
      {
        match: /knowledge\/documents$/,
        body: {
          status: 'ok',
          accepted: [{ document: { id: 'kdoc_ok', name: 'ok.txt', kind: 'text', size: 5, status: 'uploaded', error: null, chunkCount: 0, createdAt: '', updatedAt: '' } }],
          rejected: [
            { name: 'bad1.exe', error: 'knowledge_parser_unsupported:.exe（P1 文本族 + PDF 之外）' },
            { name: 'bad2.docx', error: 'knowledge_parser_planned_not_implemented:.docx（该格式解析属 P4 线，本期未实现）' },
          ],
        },
      },
      { match: /knowledge\/space/, body: spaceState() },
    ];
    mockFetchSequence(responses);
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('knowledge-upload')).toBeTruthy());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const file1 = new File(['x'], 'bad1.exe');
    const file2 = new File(['y'], 'ok.txt');
    const file3 = new File(['z'], 'bad2.docx');
    fireEvent.change(input, { target: { files: [file1, file2, file3] } });
    await waitFor(() => expect(screen.getByTestId('knowledge-upload-report')).toBeTruthy());
    const report = screen.getByTestId('knowledge-upload-report').textContent || '';
    expect(report).toContain('1 个成功');
    expect(report).toContain('2 个被拒绝');
    expect(report).toContain('bad1.exe');
    expect(report).toContain('bad2.docx');
    expect(report).toContain('knowledge_parser_unsupported:.exe');
  });

  it('BLOCK-94 F3：粘贴文本入库（开箱/输入/提交/关箱）', async () => {
    const responses = [
      {
        match: /knowledge\/documents\/paste/,
        body: { status: 'ok', document: { id: 'kdoc_paste', name: '笔记.txt', kind: 'text', size: 12, status: 'uploaded', error: null, chunkCount: 0, createdAt: '', updatedAt: '' } },
      },
      { match: /knowledge\/space/, body: spaceState() },
    ];
    const fetchMock = mockFetchSequence(responses);
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('knowledge-paste-toggle')).toBeTruthy());
    fireEvent.click(screen.getByTestId('knowledge-paste-toggle'));
    expect(screen.getByTestId('knowledge-paste-box')).toBeTruthy();
    fireEvent.change(screen.getByTestId('knowledge-paste-name'), { target: { value: '笔记' } });
    fireEvent.change(screen.getByTestId('knowledge-paste-text'), { target: { value: '粘贴的知识内容，讨论 TP53。' } });
    fireEvent.click(screen.getByTestId('knowledge-paste-submit'));
    await waitFor(() => {
      const calls = (fetchMock.mock.calls as unknown[][]).filter((call) => String(call[0]).includes('/paste'));
      expect(calls.length).toBe(1);
    });
    const pasteCall = (fetchMock.mock.calls as unknown[][]).find((call) => String(call[0]).includes('/paste'));
    const init = (pasteCall ? pasteCall[1] : undefined) as RequestInit | undefined;
    const body = JSON.parse(String((init && init.body) || '{}')) as { name: string; text: string };
    expect(body.name).toBe('笔记');
    expect(body.text).toContain('TP53');
    // 成功后收起粘贴箱
    await waitFor(() => expect(screen.queryByTestId('knowledge-paste-box')).toBeNull());
  });

  it('BLOCK-94 F4：批量选择与批量删除（ids 上报、逐项诚实）', async () => {
    const doc = (id: string, name: string) => ({
      id, name, kind: 'text', size: 10, status: 'ready' as const, error: null,
      chunkCount: 1, createdAt: '', updatedAt: '',
    });
    const responses = [
      {
        match: /batch-delete/,
        body: { status: 'ok', deleted: ['kdoc_a', 'kdoc_b'], missing: [] },
      },
      {
        match: /knowledge\/space/,
        body: spaceState({ documents: [doc('kdoc_a', 'a.txt'), doc('kdoc_b', 'b.txt')] }),
      },
    ];
    const fetchMock = mockFetchSequence(responses);
    renderPanel();
    await waitFor(() => expect(screen.getAllByTestId('knowledge-doc-check').length).toBe(2));
    fireEvent.click(screen.getByTestId('knowledge-select-all'));
    expect(screen.getByTestId('knowledge-batch-delete').textContent).toContain('2');
    fireEvent.click(screen.getByTestId('knowledge-batch-delete'));
    await waitFor(() => {
      const calls = (fetchMock.mock.calls as unknown[][]).filter((call) => String(call[0]).includes('batch-delete'));
      expect(calls.length).toBe(1);
    });
    const call = (fetchMock.mock.calls as unknown[][]).find((c) => String(c[0]).includes('batch-delete'));
    const init = (call ? call[1] : undefined) as RequestInit | undefined;
    const body = JSON.parse(String((init && init.body) || '{}')) as { ids: string[] };
    expect(body.ids.sort()).toEqual(['kdoc_a', 'kdoc_b']);
  });

  it('BLOCK-94 F4：点击文档名展开全文预览（分块渲染 + 打开原文件入口）', async () => {
    const doc = {
      id: 'kdoc_a', name: '基因笔记.md', kind: 'markdown', size: 2048,
      status: 'ready' as const, error: null, chunkCount: 2, createdAt: '', updatedAt: '',
    };
    const responses = [
      {
        match: /preview/,
        body: {
          status: 'ok',
          document: doc,
          chunks: [
            { seq: 0, text: 'TP53 参与细胞凋亡调控。' },
            { seq: 1, text: 'BRCA1 与同源重组修复相关。' },
          ],
          rawPath: '/tmp/knowledge/kdoc_a/基因笔记.md',
          rawAvailable: true,
        },
      },
      { match: /knowledge\/space/, body: spaceState({ documents: [doc] }) },
    ];
    mockFetchSequence(responses);
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('knowledge-doc-name')).toBeTruthy());
    fireEvent.click(screen.getByTestId('knowledge-doc-name'));
    await waitFor(() => expect(screen.getByTestId('knowledge-doc-preview')).toBeTruthy());
    expect(screen.getByText(/TP53 参与细胞凋亡调控/)).toBeTruthy();
    expect(screen.getByText(/BRCA1 与同源重组修复相关/)).toBeTruthy();
    expect(screen.getByText(/索引全文（2 块）/)).toBeTruthy();
    expect(screen.getByTestId('knowledge-doc-open-raw')).toBeTruthy();
  });
});
