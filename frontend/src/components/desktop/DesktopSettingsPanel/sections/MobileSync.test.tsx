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

import { MobileSync } from './MobileSync';

function fetchJson(payload: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(payload) } as Response);
}

const msk = () => JSON.stringify({}).length && undefined;

describe('MobileSync 设置区（BLOCK-70 / UI-319）', () => {
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
    render(<MobileSync />);
    await waitFor(() => expect(screen.getByText(/未启用（开启后需重启桌面端生效）/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: '生成配对二维码' })).toBeNull();
    expect(screen.getByRole('button', { name: '开启手机远程' })).toBeTruthy();
  });

  it('已启用：显示配对按钮；生成配对码后渲染二维码与一次性提示', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/mobile/status') {
        return fetchJson({
          ok: true, enabled: true, port: 3005, restartHint: 'x', lanAddresses: ['192.168.0.10'],
          activeDevices: 0, devices: [], pairingPending: 0,
        });
      }
      if (url === '/mobile/pairing/token') {
        expect(init?.method).toBe('POST');
        return fetchJson({
          ok: true, token: 'a'.repeat(64), expiresAt: Date.now() + 60_000,
          urls: ['http://192.168.0.10:3005/m#t'], primaryUrl: 'http://192.168.0.10:3005/m#t',
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MobileSync />);
    await waitFor(() => expect(screen.getByRole('button', { name: '生成配对二维码' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '生成配对二维码' }));
    await waitFor(() => expect(screen.getByAltText('手机配对二维码')).toBeTruthy());
    expect(screen.getByText(/一次性配对码，5 分钟内有效/)).toBeTruthy();
    const qr = screen.getByAltText('手机配对二维码') as HTMLImageElement;
    expect(qr.src).toContain('/mobile/pairing/qr.svg?token=');
  });

  it('设备列表：显示名称与最近活跃，吊销发出正确请求', async () => {
    const revokeCalls: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/mobile/status') {
        return fetchJson({
          ok: true, enabled: true, port: 3005, restartHint: 'x', lanAddresses: [],
          activeDevices: 1,
          devices: [{ id: 'mdev_1', name: 'iOS 设备', createdAt: '2026-09-13T00:00:00Z', lastSeenAt: '2026-09-13T01:00:00Z', revoked: false }],
          pairingPending: 0,
        });
      }
      if (url === '/mobile/devices/mdev_1/revoke') {
        revokeCalls.push(url);
        return fetchJson({ ok: true, revoked: 'mdev_1' });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MobileSync />);
    await waitFor(() => expect(screen.getByText(/iOS 设备/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '吊销' }));
    await waitFor(() => expect(revokeCalls.length).toBe(1));
  });
});
