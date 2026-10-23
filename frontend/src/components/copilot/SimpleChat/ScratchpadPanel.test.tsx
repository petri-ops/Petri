// BLOCK-246 C13 — 速记板面板：列表渲染 / 搜索 / 引用回调 / 删除 / 空态分流 / 失败可见。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ScratchpadPanel, type ScratchpadApi } from './ScratchpadPanel';
import type { ScratchpadEntry } from '@/lib/scratchpadClient';

afterEach(cleanup);

function entry(overrides: Partial<ScratchpadEntry> = {}): ScratchpadEntry {
  return {
    entryId: 'scr_1',
    contractVersion: 1,
    kind: 'text',
    title: 'PCA 笔记',
    body: '先 scale 再 subset',
    sourceKind: 'conversation',
    sourceRef: 'conv_1',
    projectId: 'proj_1',
    createdAt: '2026-10-23T00:00:00.000Z',
    updatedAt: '2026-10-23T00:00:00.000Z',
    ...overrides,
  };
}

function makeApi(entries: ScratchpadEntry[], overrides: Partial<ScratchpadApi> = {}): ScratchpadApi {
  return {
    list: vi.fn(async ({ query }: { query?: string } = {}) => ({
      entries: query ? entries.filter((item) => item.body.includes(query)) : entries,
      total: entries.length,
      limit: 20,
      offset: 0,
    })),
    remove: vi.fn(async () => true),
    ...overrides,
  };
}

describe('ScratchpadPanel', () => {
  it('renders entries with source meta and quotes one on click', async () => {
    const onQuote = vi.fn();
    const api = makeApi([entry(), entry({ entryId: 'scr_2', kind: 'image', title: '结果图', body: 'data:image/png;base64,AA' })]);
    render(<ScratchpadPanel onClose={vi.fn()} onQuote={onQuote} api={api} />);

    expect(await screen.findByText('PCA 笔记')).toBeTruthy();
    expect(screen.getByText('片段 · 会话 · conv_1')).toBeTruthy();
    expect(screen.getByText('图片 · 会话 · conv_1')).toBeTruthy();

    fireEvent.click(screen.getAllByTestId('sc-scratch-quote')[0]);
    expect(onQuote).toHaveBeenCalledWith(expect.objectContaining({ entryId: 'scr_1' }));
  });

  it('searches through the backend instead of filtering locally', async () => {
    const api = makeApi([entry(), entry({ entryId: 'scr_9', title: '另一条', body: 'DESeq2 阈值' })]);
    render(<ScratchpadPanel onClose={vi.fn()} onQuote={vi.fn()} api={api} />);
    await screen.findByText('PCA 笔记');

    fireEvent.change(screen.getByTestId('sc-scratch-search'), { target: { value: 'DESeq2' } });
    await waitFor(() => expect(api.list).toHaveBeenCalledWith({ query: 'DESeq2' }));
    await waitFor(() => expect(screen.queryByText('PCA 笔记')).toBeNull());
    expect(screen.getByText('另一条')).toBeTruthy();
  });

  it('shows a distinct empty state for "nothing yet" vs "no match"', async () => {
    const empty = makeApi([]);
    render(<ScratchpadPanel onClose={vi.fn()} onQuote={vi.fn()} api={empty} />);
    expect((await screen.findByTestId('sc-scratch-empty')).textContent).toContain('速记板还是空的');
  });

  it('removes an entry and reports failure visibly', async () => {
    const api = makeApi([entry()], { remove: vi.fn(async () => true) });
    render(<ScratchpadPanel onClose={vi.fn()} onQuote={vi.fn()} api={api} />);
    await screen.findByText('PCA 笔记');
    fireEvent.click(screen.getByTestId('sc-scratch-remove'));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('scr_1'));
    await waitFor(() => expect(screen.queryByTestId('sc-scratch-item')).toBeNull());

    cleanup();
    const failing = makeApi([entry()], { remove: vi.fn(async () => { throw new Error('删除速记失败（HTTP 500）'); }) });
    render(<ScratchpadPanel onClose={vi.fn()} onQuote={vi.fn()} api={failing} />);
    await screen.findByText('PCA 笔记');
    fireEvent.click(screen.getByTestId('sc-scratch-remove'));
    expect((await screen.findByTestId('sc-scratch-error')).textContent).toContain('HTTP 500');
  });

  it('surfaces load failures with a retry affordance', async () => {
    const api = makeApi([], { list: vi.fn(async () => { throw new Error('速记请求失败（HTTP 500）'); }) });
    render(<ScratchpadPanel onClose={vi.fn()} onQuote={vi.fn()} api={api} />);
    const error = await screen.findByTestId('sc-scratch-error');
    expect(error.textContent).toContain('HTTP 500');
    expect(screen.getByText('重试')).toBeTruthy();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<ScratchpadPanel onClose={onClose} onQuote={vi.fn()} api={makeApi([])} />);
    await screen.findByTestId('sc-scratch-empty');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
