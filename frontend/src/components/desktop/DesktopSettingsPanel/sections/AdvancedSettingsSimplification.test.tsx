import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeymapProvider } from '@/lib/appKeymapContext';
import { KEYMAP_COMMANDS } from '@/lib/appKeymap';
import { KeymapPanel } from './KeymapPanel';
import { NetworkSection } from './NetworkSection';
import { WebAccessPanel } from './WebAccessPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(payload: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: () => Promise.resolve(payload) } as unknown as Response;
}

function stubWebAccess(): void {
  vi.stubGlobal('fetch', vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes('/network')) {
      return Promise.resolve(jsonResponse({
        status: 'ok',
        network: {
          configured: { httpProxy: '', httpsProxy: '', noProxy: '', caFile: '' },
          applied: null,
          noProxyEffective: 'localhost,127.0.0.1,::1',
          restartRequired: false,
          diagnostics: [],
        },
      }));
    }
    if (url.includes('/web-access')) {
      return Promise.resolve(jsonResponse({
        status: 'ok',
        webAccess: {
          effective: { enabled: false, provider: 'none', searxngBaseUrl: '', maxResults: 5, timeoutMs: 10000, fetchMaxBytes: 1048576, allowedHosts: '', blockedHosts: '' },
          stored: {},
          allowedHosts: [],
          blockedHosts: [],
          capabilities: { search: false, fetch: false },
          diagnostics: [],
        },
      }));
    }
    return Promise.resolve(jsonResponse({ status: 'ok', bindings: {} }));
  }));
}

describe('UI-708 高级设置减负第一刀', () => {
  it('检索后端只有 models 能力渠道一个入口，联网页不再重复渲染选择器', async () => {
    stubWebAccess();
    render(<WebAccessPanel />);
    await waitFor(() => expect(screen.getByTestId('web-access-enabled')).toBeTruthy());
    expect(screen.queryByTestId('web-access-provider')).toBeNull();
    expect(screen.getByText('允许联网检索与抓取')).toBeTruthy();
  });

  it('网络代理与自签 CA 收进默认折叠的企业代理块', async () => {
    stubWebAccess();
    render(<NetworkSection />);
    const summary = await screen.findByText(/企业代理与证书/);
    const details = summary.closest('details');
    expect(details).toBeTruthy();
    expect((details as HTMLDetailsElement).open).toBe(false);
    expect((details as HTMLDetailsElement).contains(screen.getByTestId('network-http-proxy'))).toBe(true);
  });

  it('快捷键默认只显示已改键；可展开全部并按关键词过滤', async () => {
    stubWebAccess();
    render(<KeymapProvider><KeymapPanel /></KeymapProvider>);
    await waitFor(() => expect(screen.getByTestId('keymap-panel')).toBeTruthy());
    expect(screen.queryByTestId('keymap-row-palette.toggle')).toBeNull();
    fireEvent.click(screen.getByTestId('keymap-show-all'));
    await waitFor(() => expect(screen.getByTestId('keymap-row-palette.toggle')).toBeTruthy());
    expect(screen.getAllByTestId(/^keymap-row-/)).toHaveLength(KEYMAP_COMMANDS.length);
    fireEvent.change(screen.getByTestId('keymap-filter'), { target: { value: '项目库' } });
    await waitFor(() => expect(screen.getAllByTestId(/^keymap-row-/)).toHaveLength(1));
    expect(within(screen.getByTestId('keymap-row-nav-projects')).getByText('项目库')).toBeTruthy();
  });
});
