import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownResultViewer } from './MarkdownResultViewer';

/**
 * BLOCK-142（成果面切片 E·renderer 补课）MarkdownResultViewer 契约测试。
 *
 * 契约（docs/block-142-artifact-plane-renderers-plan.md §1.1）：
 *   - props { url, name }：fetch 产物 URL 文本 → react-markdown 渲染；
 *   - remarkPlugins 仅 [remarkGfm]（GFM 表格/删除线），**不加 rehype-raw**——
 *     raw HTML 不渲染为元素（XSS 安全默认）；
 *   - 文本获取失败如实显示错误（role=alert）。
 */

function mockFetchText(body: string, ok = true): ReturnType<typeof vi.fn> {
  return vi.fn(() => Promise.resolve({ ok, status: ok ? 200 : 404, text: () => Promise.resolve(body) }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MarkdownResultViewer（BLOCK-142 切片 E）', () => {
  it('fetch 产物文本并渲染 GFM 表格（remark-gfm 生效）', async () => {
    vi.stubGlobal('fetch', mockFetchText([
      '| 基因 | log2FC |',
      '| --- | --- |',
      '| TP53 | 2.4 |',
      '',
      '~~待复核~~ 与 **显著**',
    ].join('\n')));
    const { container, getByTestId } = render(
      <MarkdownResultViewer url="http://mock/deg.md" name="deg.md" />,
    );
    await waitFor(() => expect(getByTestId('markdown-viewer')).toBeTruthy());
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll('th')).toHaveLength(2);
    expect(table?.textContent).toContain('TP53');
    expect(table?.textContent).toContain('2.4');
    expect(container.textContent).toContain('待复核');
    expect(container.textContent).toContain('显著');
  });

  it('默认禁 raw HTML：内联 HTML 不渲染为元素（无 rehype-raw 的 XSS 安全默认）', async () => {
    vi.stubGlobal('fetch', mockFetchText(
      '前文\n\n<img src=x onerror="alert(1)">\n\n<script>window.pwned=1</script>\n\n后文',
    ));
    const { container, getByTestId } = render(
      <MarkdownResultViewer url="http://mock/evil.md" name="evil.md" />,
    );
    await waitFor(() => expect(getByTestId('markdown-viewer')).toBeTruthy());
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.textContent).toContain('后文');
  });

  it('url 变化时重新取数（产物切换）', async () => {
    const fetchMock = mockFetchText('# 第一份');
    vi.stubGlobal('fetch', fetchMock);
    const { rerender, getByTestId } = render(
      <MarkdownResultViewer url="http://mock/a.md" name="a.md" />,
    );
    await waitFor(() => expect(getByTestId('markdown-viewer')).toBeTruthy());
    rerender(<MarkdownResultViewer url="http://mock/b.md" name="b.md" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('http://mock/b.md');
  });

  it('fetch 失败如实显示错误（role=alert，不假渲染空壳）', async () => {
    vi.stubGlobal('fetch', mockFetchText('', false));
    const { getByTestId } = render(
      <MarkdownResultViewer url="http://mock/gone.md" name="gone.md" />,
    );
    await waitFor(() => expect(getByTestId('markdown-error')).toBeTruthy());
    expect(getByTestId('markdown-error').getAttribute('role')).toBe('alert');
  });
});
