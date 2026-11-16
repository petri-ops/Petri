import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelPreferencePanel } from './ChannelPreferencePanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockFetchRoute(handler: (url: string, init?: RequestInit) => unknown) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = handler(url, init);
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('UI-704 — models「能力渠道」折叠块（BLOCK-454 渠道槽位显化）', () => {
  it('渲染检索后端与 OCR 渠道两个选择器；SearXNG 为默认标注（本地主权）', async () => {
    mockFetchRoute((url) => {
      if (url.includes('/web-access')) {
        return { status: 'ok', webAccess: { effective: { enabled: true, provider: 'searxng', searxngBaseUrl: 'http://127.0.0.1:8080' }, capabilities: { search: true, fetch: true } } };
      }
      if (url.includes('/ocr-access')) {
        return { status: 'ok', ocrAccess: { effective: { enabled: false, provider: 'none', purpose: 'rich_layout_recognition' } } };
      }
      return {};
    });
    render(<ChannelPreferencePanel />);
    // 默认折叠：先展开再断言（与真实交互一致）
    fireEvent.click(screen.getByTestId('channel-panel-toggle'));
    await waitFor(() => expect(screen.getByTestId('channel-search-provider')).toBeTruthy());
    const searchSelect = screen.getByTestId('channel-search-provider') as HTMLSelectElement;
    expect(searchSelect.value).toBe('searxng');
    expect(screen.getByTestId('channel-ocr-provider')).toBeTruthy();
    expect(screen.getByTestId('channel-panel').textContent).toContain('SearXNG');
  });

  it('改检索后端为 deepseek → PUT /api/web-access；改 OCR 渠道 → PUT /api/ocr-access', async () => {
    const fetchMock = mockFetchRoute((url) => {
      if (url.includes('/web-access')) {
        return { status: 'ok', webAccess: { effective: { enabled: true, provider: 'searxng', searxngBaseUrl: '' }, capabilities: { search: true, fetch: true } } };
      }
      return { status: 'ok', ocrAccess: { effective: { enabled: false, provider: 'none', purpose: 'rich_layout_recognition' } } };
    });
    render(<ChannelPreferencePanel />);
    fireEvent.click(screen.getByTestId('channel-panel-toggle'));
    await waitFor(() => expect(screen.getByTestId('channel-search-provider')).toBeTruthy());
    fireEvent.change(screen.getByTestId('channel-search-provider'), { target: { value: 'deepseek' } });
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([u, init]) => String(u).includes('/web-access') && init?.method === 'PUT');
      expect(put).toBeTruthy();
      expect(JSON.parse(String(put?.[1]?.body)).provider).toBe('deepseek');
    });
    fireEvent.change(screen.getByTestId('channel-ocr-provider'), { target: { value: 'deepseek' } });
    await waitFor(() => {
      const putOcr = fetchMock.mock.calls.find(([u, init]) => String(u).includes('/ocr-access') && init?.method === 'PUT');
      expect(putOcr).toBeTruthy();
      expect(JSON.parse(String(putOcr?.[1]?.body)).provider).toBe('deepseek');
    });
  });

  it('渠道面板默认折叠，可展开（不占 models 主屏焦点）', async () => {
    mockFetchRoute(() => ({ status: 'ok', ocrAccess: { effective: { enabled: false, provider: 'none' } } }));
    render(<ChannelPreferencePanel />);
    const toggle = screen.getByTestId('channel-panel-toggle');
    expect(screen.queryByTestId('channel-search-provider')).toBeNull();
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByTestId('channel-search-provider')).toBeTruthy());
  });
});
