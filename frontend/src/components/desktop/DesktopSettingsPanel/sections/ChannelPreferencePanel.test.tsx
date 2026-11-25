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

describe('BLOCK-519 语音本地模型设置段（按 WorkBuddy 截图形态）', () => {
  const MODEL = 'sensevoice-small-int8-2024-07-17';

  function bodyOf(init?: RequestInit): Record<string, unknown> {
    const body = init?.body;
    if (typeof body !== 'string') return {};
    try { return JSON.parse(body) as Record<string, unknown>; } catch { return {}; }
  }

  function mockSpeech(installed: boolean, currentModelId = MODEL) {
    return mockFetchRoute((url, init) => {
      if (url.includes('/speech/local-models')) {
        if (!init?.method || init.method === 'GET') {
          return { status: 'ok', models: [{ id: MODEL, label: 'SenseVoice-small（中/英/日/韩/粤）', installed, language: 'auto' }] };
        }
        return { status: 'ok', ok: true };
      }
      if (url.includes('/speech-access')) {
        return { status: 'ok', speechAccess: { effective: {
          enabled: true, provider: 'chain', provider_chain: ['local', 'deepseek'],
          local_model: { modelId: currentModelId, language: 'auto' },
          ttsVoice: 'stella', ttsFormat: 'wav', filterMarkdown: true, timeoutMs: 60000,
        } } };
      }
      return { status: 'ok', ocrAccess: { effective: { enabled: false, provider: 'none', purpose: 'rich_layout_recognition' } } };
    });
  }

  it('本地/云端/本地优先三态切换 + 语言自动检测写入 speech-access', async () => {
    const fetchMock = mockSpeech(false);
    render(<ChannelPreferencePanel />);
    fireEvent.click(screen.getByTestId('channel-panel-toggle'));
    await waitFor(() => expect(screen.getByTestId('channel-speech-provider')).toBeTruthy());
    const select = screen.getByTestId('channel-speech-provider');
    if (!(select instanceof HTMLSelectElement)) throw new Error('语音渠道应为 select');
    expect([...select.options].map((o) => o.value)).toEqual(expect.arrayContaining(['local', 'deepseek', 'chain']));
    expect(select.value).toBe('chain');

    fireEvent.change(select, { target: { value: 'local' } });
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([u, init]) => String(u).includes('/speech-access') && init?.method === 'PUT');
      expect(put).toBeTruthy();
      const body = bodyOf(put?.[1]);
      expect(body.provider).toBe('local');
    });

    const language = screen.getByTestId('channel-speech-language');
    if (!(language instanceof HTMLSelectElement)) throw new Error('ASR 语言应为 select');
    expect(language.value).toBe('auto');
    fireEvent.change(language, { target: { value: 'zh' } });
    await waitFor(() => {
      const puts = fetchMock.mock.calls.filter(([u, init]) => String(u).includes('/speech-access') && init?.method === 'PUT');
      const last = bodyOf(puts[puts.length - 1]?.[1]);
      expect((last.local_model as { language?: string } | undefined)?.language).toBe('zh');
    });
  });

  it('未下载模型只显示下载；已落盘才显示使用中/删除（真实状态为准）', async () => {
    const fetchMock = mockSpeech(false);
    render(<ChannelPreferencePanel />);
    fireEvent.click(screen.getByTestId('channel-panel-toggle'));
    await waitFor(() => expect(screen.getByTestId(`local-model-download-${MODEL}`)).toBeTruthy());
    expect(screen.queryByTestId(`local-model-use-${MODEL}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`local-model-download-${MODEL}`));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([u, init]) => String(u).includes('/speech/local-models') && init?.method === 'POST');
      expect(post).toBeTruthy();
    });
  });

  it('已落盘模型：使用中写入 local_model.modelId；删除走 DELETE', async () => {
    const fetchMock = mockSpeech(true, 'previous-model');
    render(<ChannelPreferencePanel />);
    fireEvent.click(screen.getByTestId('channel-panel-toggle'));
    await waitFor(() => expect(screen.getByTestId(`local-model-use-${MODEL}`)).toBeTruthy());
    fireEvent.click(screen.getByTestId(`local-model-use-${MODEL}`));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([u, init]) => String(u).includes('/speech-access') && init?.method === 'PUT' && 'local_model' in bodyOf(init));
      expect(put).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`local-model-delete-${MODEL}`));
    await waitFor(() => {
      const del = fetchMock.mock.calls.find(([u, init]) => String(u).includes('/speech/local-models') && init?.method === 'DELETE');
      expect(del).toBeTruthy();
    });
  });
});
