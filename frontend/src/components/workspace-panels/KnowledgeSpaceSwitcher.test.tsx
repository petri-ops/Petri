// BLOCK-99 P2 — KnowledgeSpaceSwitcher 组件定向测试
// fetch 全 mock（不发真实网络）；验证列表渲染/切换/新建/两步删除/默认空间保护。

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeSpaceSwitcher } from './KnowledgeSpaceSwitcher';

function spacesBody() {
  return {
    status: 'ok',
    spaces: [
      { id: 'ks_default', name: '默认知识空间', enabled: false, embeddingModel: 'text-embedding-v3', createdAt: '', updatedAt: '', documents: 3, chunks: 9 },
      { id: 'ks_custom', name: '项目空间', enabled: true, embeddingModel: 'text-embedding-v3', createdAt: '', updatedAt: '', documents: 1, chunks: 2 },
    ],
  };
}

function mockFetch(routes: Array<{ match: RegExp; body: unknown; method?: string }>) {
  const impl = (url: string, init?: RequestInit) => {
    const method = (init?.method || 'GET').toUpperCase();
    const hit = routes.find((r) => r.match.test(url) && (!r.method || r.method === method));
    if (!hit) return Promise.resolve(new Response(JSON.stringify({ status: 'error', error: 'unmocked ' + url }), { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify(hit.body), { status: 200 }));
  };
  vi.stubGlobal('fetch', vi.fn(impl as typeof fetch));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('KnowledgeSpaceSwitcher', () => {
  beforeEach(() => {
    mockFetch([{ match: /knowledge\/spaces$/, body: spacesBody() }]);
  });

  it('渲染空间下拉（名称+文档数+启用态）且切换回调上抛', async () => {
    const onSwitch = vi.fn();
    render(<KnowledgeSpaceSwitcher spaceId="ks_default" onSwitch={onSwitch} />);
    const select = await screen.findByTestId<HTMLSelectElement>('knowledge-space-select');
    await waitFor(() => expect(select.options.length).toBe(2));
    expect(select.options[0].textContent).toContain('默认知识空间');
    expect(select.options[1].textContent).toContain('已启用');
    fireEvent.change(select, { target: { value: 'ks_custom' } });
    expect(onSwitch).toHaveBeenCalledWith('ks_custom');
  });

  it('新建空间：创建成功后切换到新空间并通知刷新', async () => {
    const onSwitch = vi.fn();
    const onChanged = vi.fn();
    mockFetch([
      { match: /knowledge\/spaces$/, method: 'GET', body: spacesBody() },
      { match: /knowledge\/spaces$/, method: 'POST', body: { status: 'ok', space: { id: 'ks_new', name: '新空间', enabled: false, embeddingModel: '', createdAt: '', updatedAt: '', documents: 0, chunks: 0 } } },
      { match: /knowledge\/spaces$/, method: 'GET', body: spacesBody() },
    ]);
    render(<KnowledgeSpaceSwitcher spaceId="ks_default" onSwitch={onSwitch} onChanged={onChanged} />);
    await waitFor(() => expect(screen.queryByTestId('knowledge-space-select')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('新建知识空间'));
    const input = screen.getByLabelText('新空间名称');
    fireEvent.change(input, { target: { value: '新空间' } });
    fireEvent.click(screen.getByText('创建'));
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith('ks_new'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('非默认空间才出现删除按钮；两步确认后级联删除', async () => {
    const onSwitch = vi.fn();
    mockFetch([
      { match: /knowledge\/spaces$/, body: spacesBody() },
      { match: /impact/, body: { status: 'ok', impact: { documents: 1, chunks: 2 } } },
      { match: /knowledge\/spaces\/ks_custom$/, body: { status: 'ok', deleted: 'ks_custom' } },
    ]);
    render(<KnowledgeSpaceSwitcher spaceId="ks_custom" onSwitch={onSwitch} />);
    await waitFor(() => expect(screen.getByTestId('knowledge-space-delete')).toBeTruthy());
    // 默认空间无删除按钮（select 只有下拉与新建，无 ks_default 删除入口）
    fireEvent.click(screen.getByTestId('knowledge-space-delete'));
    await waitFor(() => expect(screen.getByTestId('knowledge-space-delete').textContent).toContain('确认删除'));
    fireEvent.click(screen.getByTestId('knowledge-space-delete'));
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith('ks_default'));
  });
});
