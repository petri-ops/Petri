import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelPreferencePanel } from './ChannelPreferencePanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockFetchRoute(handler: (url: string, init?: RequestInit) => unknown) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const body = handler(url, init);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    } as Response);
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
      if (url.includes('/speech-access')) {
        return { status: 'ok', speechAccess: { effective: { enabled: false, provider: 'none', ttsVoice: 'stella', ttsFormat: 'wav', filterMarkdown: true, timeoutMs: 60000 } } };
      }
      return {};
    });
    render(<ChannelPreferencePanel />);
    // 默认折叠：先展开再断言（与真实交互一致）
    fireEvent.click(screen.getByTestId('channel-panel-toggle'));
    await waitFor(() => expect(screen.getByTestId('channel-search-provider')).toBeTruthy());
    const searchSelect = screen.getByTestId('channel-search-provider');
    expect((searchSelect as HTMLSelectElement).value).toBe('searxng');
    expect(screen.getByTestId('channel-ocr-provider')).toBeTruthy();
    expect(screen.getByTestId('channel-speech-provider')).toBeTruthy();
    expect(screen.getByTestId('channel-panel').textContent).toContain('SearXNG');
  });

  it('改检索后端为 deepseek → PUT /api/web-access；改 OCR 渠道 → PUT /api/ocr-access', async () => {
    const fetchMock = mockFetchRoute((url) => {
      if (url.includes('/web-access')) {
        return { status: 'ok', webAccess: { effective: { enabled: true, provider: 'searxng', searxngBaseUrl: '' }, capabilities: { search: true, fetch: true } } };
      }
      if (url.includes('/speech-access')) {
        return { status: 'ok', speechAccess: { effective: { enabled: false, provider: 'none', ttsVoice: 'stella', ttsFormat: 'wav', filterMarkdown: true, timeoutMs: 60000 } } };
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
      const webBody = put?.[1]?.body as string | undefined;
      expect(typeof webBody === 'string' && (JSON.parse(webBody) as { provider?: string }).provider).toBe('deepseek');
    });
    fireEvent.change(screen.getByTestId('channel-ocr-provider'), { target: { value: 'deepseek' } });
    await waitFor(() => {
      const putOcr = fetchMock.mock.calls.find(([u, init]) => String(u).includes('/ocr-access') && init?.method === 'PUT');
      expect(putOcr).toBeTruthy();
      const ocrBody = putOcr?.[1]?.body as string | undefined;
      expect(typeof ocrBody === 'string' && (JSON.parse(ocrBody) as { provider?: string }).provider).toBe('deepseek');
    });
    // 语音渠道开关 → PUT /api/speech-access
    fireEvent.change(screen.getByTestId('channel-speech-provider'), { target: { value: 'deepseek' } });
    await waitFor(() => {
      const putSpeech = fetchMock.mock.calls.find(([u, init]) => String(u).includes('/speech-access') && init?.method === 'PUT');
      expect(putSpeech).toBeTruthy();
      const speechBody = putSpeech?.[1]?.body as string | undefined;
      expect(typeof speechBody === 'string' && (JSON.parse(speechBody) as { enabled?: boolean }).enabled).toBe(true);
    });
  });

  it('渠道面板默认折叠，可展开（不占 models 主屏焦点）', async () => {
    mockFetchRoute((url) => {
      if (url.includes('/speech-access')) {
        return { status: 'ok', speechAccess: { effective: { enabled: false, provider: 'none', ttsVoice: 'stella', ttsFormat: 'wav', filterMarkdown: true, timeoutMs: 60000 } } };
      }
      return { status: 'ok', ocrAccess: { effective: { enabled: false, provider: 'none', purpose: 'rich_layout_recognition' } } };
    });
    render(<ChannelPreferencePanel />);
    const toggle = screen.getByTestId('channel-panel-toggle');
    expect(screen.queryByTestId('channel-search-provider')).toBeNull();
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByTestId('channel-search-provider')).toBeTruthy());
  });
});
