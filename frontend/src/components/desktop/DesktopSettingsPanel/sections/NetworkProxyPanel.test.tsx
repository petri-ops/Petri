import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkProxyPanel } from './NetworkProxyPanel';

const SNAPSHOT = {
  configured: { httpProxy: '', httpsProxy: '', noProxy: '', caFile: '' },
  applied: null,
  noProxyEffective: 'localhost,127.0.0.1,::1',
  restartRequired: false,
  diagnostics: [],
};

type JsonBody = Record<string, unknown>;

function response(body: JsonBody, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({ status: 'ok', network: SNAPSHOT }))));
});

describe('NetworkProxyPanel', () => {
  it('加载后显示四项配置与回环豁免说明', async () => {
    render(<NetworkProxyPanel />);
    await waitFor(() => expect(screen.getByTestId('network-http-proxy')).toBeTruthy());
    expect((screen.getByTestId('network-http-proxy') as unknown as HTMLInputElement).value).toBe('');
    expect(screen.getByText((content) => content.includes('生效值') && content.includes('localhost'))).toBeTruthy();
  });

  it('保存后提示「需重启后端生效」，不谎称即时生效', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).endsWith('/network')) {
        return Promise.resolve(response({
          status: 'ok',
          network: {
            ...SNAPSHOT,
            configured: { ...SNAPSHOT.configured, httpProxy: 'http://127.0.0.1:7890' },
            restartRequired: true,
          },
        }));
      }
      return Promise.resolve(response({ status: 'ok' }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<NetworkProxyPanel />);
    await waitFor(() => expect(screen.getByTestId('network-http-proxy')).toBeTruthy());
    fireEvent.change(screen.getByTestId('network-http-proxy'), { target: { value: 'http://127.0.0.1:7890' } });
    fireEvent.click(screen.getByText('保存网络配置'));
    await waitFor(() => expect(screen.getByTestId('network-notice').textContent).toContain('需重启后端生效'));
    expect(screen.getByTestId('network-restart-required')).toBeTruthy();
  });

  it('400 诊断原样展示（不洗成成功）', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/network') && init?.method === 'PUT') {
        return Promise.resolve(response({ status: 'error', diagnostics: [{ path: 'httpProxy', message: '语法不符' }] }, 400));
      }
      return Promise.resolve(response({ status: 'ok', network: SNAPSHOT }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<NetworkProxyPanel />);
    await waitFor(() => expect(screen.getByTestId('network-http-proxy')).toBeTruthy());
    fireEvent.click(screen.getByText('保存网络配置'));
    await waitFor(() => expect(screen.getByTestId('network-diagnostics').textContent).toContain('语法不符'));
  });
});
