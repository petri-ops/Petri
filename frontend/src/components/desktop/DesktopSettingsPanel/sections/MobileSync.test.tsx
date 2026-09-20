import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MobileSyncPanel } from './MobileSync';

function fetchJson(payload: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(payload) } as Response);
}

describe('MobileSyncPanel 手机连接面板（BLOCK-70 / UI-354）', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('未开启：状态点灰 + 诚实提示 + 「开启」按钮，无二维码', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/mobile/status')) {
        return fetchJson({
          ok: true, enabled: false, port: 3005, restartHint: 'x', lanAddresses: [],
          activeDevices: 0, devices: [], pairingPending: 0,
        });
      }
      if (url.endsWith('/mobile/tunnel')) {
        return fetchJson({ ok: false });
      }
      return fetchJson({ ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MobileSyncPanel />);
    await waitFor(() => expect(screen.getByText(/手机远程未开启/)).toBeTruthy());
    expect(screen.queryByTestId('mobile-pairing-qr')).toBeNull();
    expect(screen.getByRole('button', { name: '开启' })).toBeTruthy();
    expect(screen.getByText(/开启后需重启桌面端生效/)).toBeTruthy();
  });

  it('已开启：自动出码（无需点击）、复制链接只显示主机不裸露 token', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/mobile/status')) {
        return fetchJson({
          ok: true, enabled: true, port: 3005, restartHint: 'x', lanAddresses: ['192.168.0.10'],
          activeDevices: 0, devices: [], pairingPending: 0,
        });
      }
      if (url.endsWith('/mobile/pairing/token')) {
        expect(init?.method).toBe('POST');
        return fetchJson({
          ok: true, token: 'a'.repeat(64), expiresAt: Date.now() + 60_000,
          urls: ['http://192.168.0.10:3005/pair?token=t'], primaryUrl: 'http://192.168.0.10:3005/pair?token=t',
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MobileSyncPanel />);
    await waitFor(() => expect(screen.getByTestId('mobile-pairing-qr')).toBeTruthy());
    expect(screen.getByText(/已配对手机重扫直接进入/)).toBeTruthy();
    // 链接行：只显示 host；复制按钮写入完整 URL
    expect(screen.getByTestId('mobile-copy-link').textContent).toContain('复制链接');
    expect(screen.queryByText(/token=/)).toBeNull();
    fireEvent.click(screen.getByTestId('mobile-copy-link'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://192.168.0.10:3005/pair?token=t'));
    await waitFor(() => expect(screen.getByTestId('mobile-copy-link').textContent).toContain('已复制'));
  });

  it('设备区：只显示活跃设备（已吊销彻底不渲染）+ 空态 + 相对时间', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/mobile/status')) {
        return fetchJson({
          ok: true, enabled: true, port: 3005, restartHint: 'x', lanAddresses: [],
          activeDevices: 1,
          devices: [
            { id: 'mdev_1', name: 'iOS 设备-a1', createdAt: '2026-09-13T00:00:00Z', lastSeenAt: new Date(Date.now() - 5 * 60_000).toISOString(), revoked: false },
            { id: 'mdev_0', name: '桌面投影-9f', createdAt: '2026-09-13T00:00:00Z', lastSeenAt: '2026-09-13T00:30:00Z', revoked: true },
          ],
          pairingPending: 0,
        });
      }
      if (url.endsWith('/mobile/pairing/token')) {
        return fetchJson({
          ok: true, token: 'b'.repeat(64), expiresAt: Date.now() + 60_000,
          urls: ['u'], primaryUrl: 'http://h/pair?token=t',
        });
      }
      if (url.endsWith('/mobile/devices/mdev_1/revoke')) {
        return fetchJson({ ok: true, revoked: 'mdev_1' });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MobileSyncPanel />);
    await waitFor(() => expect(screen.getByText(/iOS 设备-a1/)).toBeTruthy());
    // 修订 4：已吊销历史不再有任何呈现
    expect(screen.queryByText(/桌面投影-9f/)).toBeNull();
    expect(screen.queryByText(/已吊销/)).toBeNull();
    expect(screen.getByTestId('mobile-revoke-all')).toBeTruthy();
    expect(screen.getByText(/5 分钟前/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '吊销' }));
    await waitFor(() => expect(screen.getByTestId('mobile-device-row')).toBeTruthy());
  });

  it('空设备态：显示引导文案，无「全部吊销」', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/mobile/status')) {
        return fetchJson({
          ok: true, enabled: true, port: 3005, restartHint: 'x', lanAddresses: [],
          activeDevices: 0, devices: [], pairingPending: 0,
        });
      }
      if (url.endsWith('/mobile/pairing/token')) {
        return fetchJson({
          ok: true, token: 'c'.repeat(64), expiresAt: Date.now() + 60_000,
          urls: ['u'], primaryUrl: 'http://h/pair?token=t',
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MobileSyncPanel />);
    await waitFor(() => expect(screen.getByText(/还没有设备连接/)).toBeTruthy());
    expect(screen.queryByTestId('mobile-revoke-all')).toBeNull();
  });
});
