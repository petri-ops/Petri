import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebAccessPanel } from './WebAccessPanel';

const SNAPSHOT = {
  effective: {
    enabled: false,
    provider: 'none',
    searxngBaseUrl: '',
    maxResults: 5,
    timeoutMs: 10000,
    fetchMaxBytes: 1048576,
    allowedHosts: '',
    blockedHosts: '',
  },
  stored: {},
  allowedHosts: [],
  blockedHosts: [],
  capabilities: { search: false, fetch: false },
  diagnostics: [],
};

function response(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({ status: 'ok', webAccess: SNAPSHOT }))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WebAccessPanel', () => {
  it('默认关：加载后显示关闭态与能力可用性', async () => {
    render(<WebAccessPanel />);
    await waitFor(() => expect(screen.getByTestId('web-access-enabled')).toBeTruthy());
    const toggle = screen.getByTestId('web-access-enabled') as unknown as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.getByText((content) => content.includes('抓取不可用'))).toBeTruthy();
    expect(screen.getByText((content) => content.includes('检索不可用'))).toBeTruthy();
  });

  it('保存后即时生效（不出现「需重启」话术）', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (!init || init.method !== 'PUT') {
        return Promise.resolve(response({ status: 'ok', webAccess: SNAPSHOT }));
      }
      return Promise.resolve(response({ status: 'ok', webAccess: { ...SNAPSHOT, capabilities: { search: false, fetch: true } } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<WebAccessPanel />);
    await waitFor(() => expect(screen.getByTestId('web-access-enabled')).toBeTruthy());
    fireEvent.click(screen.getByTestId('web-access-enabled'));
    fireEvent.click(screen.getByText('保存联网设置'));
    await waitFor(() => expect(screen.getByTestId('web-access-notice').textContent).toContain('即时生效'));
    const put = fetchMock.mock.calls.find((call) => call[1]?.method === 'PUT');
    expect(put).toBeTruthy();
    const rawBody = put?.[1]?.body;
    expect(typeof rawBody).toBe('string');
    const parsed: unknown = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}');
    expect((parsed as { enabled?: boolean }).enabled).toBe(true);
    expect(screen.getByTestId('web-access-notice').textContent).not.toContain('重启');
  });

  it('后端拒绝时把 diagnostics 显示出来（不谎称已保存）', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init && init.method === 'PUT') {
        return Promise.resolve(response({ status: 'error', error: 'config_value_rejected', diagnostics: [{ path: 'maxResults', message: '超出范围' }] }, false, 400));
      }
      return Promise.resolve(response({ status: 'ok', webAccess: SNAPSHOT }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<WebAccessPanel />);
    await waitFor(() => expect(screen.getByTestId('web-access-enabled')).toBeTruthy());
    fireEvent.click(screen.getByText('保存联网设置'));
    await waitFor(() => expect(screen.getByTestId('web-access-diagnostics').textContent).toContain('超出范围'));
    expect(screen.queryByTestId('web-access-notice')).toBeNull();
  });

  it('配置诊断（选了 SearXNG 却没填地址）如实展示', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({
      status: 'ok',
      webAccess: {
        ...SNAPSHOT,
        diagnostics: [{ code: 'searxng-base-url-missing', path: 'searxngBaseUrl', message: '未填实例地址' }],
      },
    }))));
    render(<WebAccessPanel />);
    await waitFor(() => expect(screen.getByTestId('web-access-config-diagnostics').textContent).toContain('未填实例地址'));
  });
});
