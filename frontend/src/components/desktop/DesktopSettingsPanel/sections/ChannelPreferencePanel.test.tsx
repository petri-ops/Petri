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

describe('item 40 语音独立分区四块（v2 视觉稿；无外层折叠）', () => {
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

  it('语音独立页常驻四块在场，旧检索/OCR 两块不在；无外层折叠开关', async () => {
    mockSpeech(false);
    render(<ChannelPreferencePanel />);
    await waitFor(() => expect(screen.getByTestId('channel-speech-language')).toBeTruthy());
    const panel = screen.getByTestId('channel-panel');
    for (const text of ['语音渠道', 'ASR 语言', '本地模型', 'Whisper', 'TTS 声音']) {
      expect(panel.textContent).toContain(text);
    }
    expect(screen.queryByTestId('channel-search-provider')).toBeNull();
    expect(screen.queryByTestId('channel-ocr-provider')).toBeNull();
    expect(screen.queryByTestId('channel-panel-toggle')).toBeNull();
  });

  it('本地/云端/本地优先三态切换 + 语言自动检测写入 speech-access', async () => {
    const fetchMock = mockSpeech(false);
    render(<ChannelPreferencePanel />);
    await waitFor(() => expect(screen.getByTestId('channel-speech-language')).toBeTruthy());
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
