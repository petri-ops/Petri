// ============================================================
// BLOCK-70（UI-319）—— 设置区「手机远程」组件契约。
//
// 锁定三态诚实呈现与操作语义：未启用（含重启提示）/ 已启用（可生成配对码）/
// 设备吊销。后端交互全部 mock，只验证前端渲染与请求形状。
// ============================================================
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getTokenMock } = vi.hoisted(() => ({
  getTokenMock: vi.fn(() => 'token'),
}));

vi.mock('@/lib/authClient', () => ({
  getPlatformApiPrefix: () => '',
  getToken: getTokenMock,
}));

import { MobileSyncPanel } from './MobileSync';

function fetchJson(payload: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(payload) } as Response);
}

const msk = () => JSON.stringify({}).length && undefined;

describe('MobileSyncPanel 手机连接面板（BLOCK-70 / UI-354）', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('未启用：呈现状态与「开启后需重启」诚实提示，不显示配对按钮', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      expect(String(input)).toBe('/mobile/status');
      return fetchJson({
        ok: true, enabled: false, port: 3005, restartHint: 'x', lanAddresses: [],
        activeDevices: 0, devices: [], pairingPending: 0,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MobileSyncPanel />);
    await waitFor(() => expect(screen.getByText(/未启用（开启后需重启桌面端生效）/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: '重新生成配对码' })).toBeNull();
    expect(screen.queryByTestId('mobile-pairing-qr')).toBeNull();
    expect(screen.getByRole('button', { name: '开启手机远程' })).toBeTruthy();
  });

  it('已启用：自动出码（无需手动点击）；「重新生成配对码」可即时换码', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInfo | RequestInit) => {
      const url = String(input);
      if (url === '/mobile/status') {
        return fetchJson({
          ok: true, enabled: true, port: 3005, restartHint: 'x', lanAddresses: ['192.168.0.10'],
          activeDevices: 0, devices: [], pairingPending: 0,
        });
      }
      if (url === '/mobile/pairing/token') {
        expect((init as RequestInit | undefined)?.method).toBe('POST');
        return fetchJson({
          ok: true, token: 'a'.repeat(64), expiresAt: Date.now() + 60_000,
          urls: ['http://192.168.0.10:3005/m#t'], primaryUrl: 'http://192.168.0.10:3005/m#t',
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MobileSyncPanel />);
    // 加映 4：面板打开且已启用 → 自动出码，无需点击
    await waitFor(() => expect(screen.getByTestId('mobile-pairing-qr')).toBeTruthy());
    const qr = screen.getByAltText('手机配对二维码') as HTMLImageElement;
    expect(qr.src).toContain('/mobile/pairing/qr.svg?token=');
    expect(screen.getByText(/已配对手机重扫码直接复用原会话/)).toBeTruthy();
    // 手动按钮保留为即时换码入口
    expect(screen.getByRole('button', { name: '重新生成配对码' })).toBeTruthy();
  });

  it('设备列表：活跃设备 + 吊销请求正确，已吊销折叠不平铺', async () => {
    const revokeCalls: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/mobile/status') {
        return fetchJson({
          ok: true, enabled: true, port: 3005, restartHint: 'x', lanAddresses: [],
          activeDevices: 1,
          devices: [
            { id: 'mdev_1', name: 'iOS 设备-a1', createdAt: '2026-09-13T00:00:00Z', lastSeenAt: '2026-09-13T01:00:00Z', revoked: false },
            { id: 'mdev_0', name: '桌面投影-9f', createdAt: '2026-09-13T00:00:00Z', lastSeenAt: '2026-09-13T00:30:00Z', revoked: true },
          ],
          pairingPending: 0,
        });
      }
      if (url === '/mobile/pairing/token') {
        return fetchJson({
          ok: true, token: 'b'.repeat(64), expiresAt: Date.now() + 60_000,
          urls: ['http://192.168.0.10:3005/m#t'], primaryUrl: 'http://192.168.0.10:3005/m#t',
        });
      }
      if (url === '/mobile/devices/mdev_1/revoke') {
        revokeCalls.push(url);
        return fetchJson({ ok: true, revoked: 'mdev_1' });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MobileSyncPanel />);
    await waitFor(() => expect(screen.getByText(/iOS 设备-a1/)).toBeTruthy());
    // 已吊销默认折叠（只显示计数），展开后可见
    expect(screen.queryByText(/桌面投影-9f/)).toBeNull();
    fireEvent.click(screen.getByTestId('mobile-revoked-toggle'));
    expect(screen.getByText(/桌面投影-9f/)).toBeTruthy();
    expect(screen.getByTestId('mobile-revoke-all')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '吊销' }));
    await waitFor(() => expect(revokeCalls.length).toBe(1));
  });
});
