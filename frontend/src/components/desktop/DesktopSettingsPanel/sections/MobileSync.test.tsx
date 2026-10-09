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
    const fetchMock = vi.fn((input: string) => {
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
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
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
    const fetchMock = vi.fn((input: string, _init?: RequestInit) => {
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
    const fetchMock = vi.fn((input: string) => {
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

// BLOCK-149 A5（审视发现 #5）—— 真远程徽标三态诚实化：
// 后端 state=connected 是「转发已建立」的 10s 强启发（tunnel.js STABLE_CONNECTED_MS），
// 反代挂掉/半开 TCP 时手机实际打不开。前端消费 stateSinceTs：连接持续 ≥15min
// （含时钟偏差裕量，从紧）才宣称「公网可用」；此前如实显示「尚未确认」。
// BLOCK-152 T（隧道 publicUrl 周期自探活，#468 留方向）—— 消费升级为「时长 + 探活」：
// probe fail（公网门实测打不通）时即使 ≥15min 也不宣称，降级「公网未确认」（从紧）；
// probe unknown / 旧后端缺省维持 stateSinceTs 原判据。
describe('MobileSyncPanel 真远程徽标三态（BLOCK-149 A5）', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function connectedTunnel(stateSinceTs: number, probeState?: 'ok' | 'fail' | 'unknown') {
    return {
      configured: true, enabled: true, state: 'connected', host: 'aliyun',
      remotePort: 2233, localPort: 3005, publicUrl: 'https://gw.example.com',
      lastError: '', pid: 4321, stateSinceTs,
      ...(probeState ? { probeState, probedAt: stateSinceTs } : {}),
    };
  }

  function mockFetchWithTunnel(tunnel: Record<string, unknown>) {
    return vi.fn((input: string) => {
      const url = String(input);
      if (url.endsWith('/mobile/status')) {
        return fetchJson({
          ok: true, enabled: false, port: 3005, restartHint: 'x', lanAddresses: [],
          activeDevices: 0, devices: [], pairingPending: 0,
        });
      }
      if (url.endsWith('/mobile/tunnel')) {
        return fetchJson({ ok: true, tunnel, profiles: [] });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
  }

  it('连接刚建立（5min < 15min）：不宣称「公网可用」，如实显示「尚未确认」，徽标不取绿色', async () => {
    vi.stubGlobal('fetch', mockFetchWithTunnel(connectedTunnel(Date.now() - 5 * 60_000)));
    render(<MobileSyncPanel />);
    const badge = await waitFor(() => screen.getByTestId('tunnel-state-badge'));
    expect(badge.textContent).toBe('● 连接建立中 · 尚未确认公网可用');
    expect(badge.className).not.toContain('tunnelBadgeOn');
    expect(badge.className).toContain('tunnelBadgeWarn');
  });

  it('持续连接跨过阈值（17min ≥ 15min+裕量）：才显示「公网可用」，徽标取绿色', async () => {
    vi.stubGlobal('fetch', mockFetchWithTunnel(connectedTunnel(Date.now() - 17 * 60_000)));
    render(<MobileSyncPanel />);
    const badge = await waitFor(() => screen.getByTestId('tunnel-state-badge'));
    expect(badge.textContent).toBe('● 已连接 · 公网可用');
    expect(badge.className).toContain('tunnelBadgeOn');
    expect(badge.className).not.toContain('tunnelBadgeWarn');
  });

  it('边界从紧：15.5min 已过 15min 但落在时钟偏差裕量内 → 仍不宣称「公网可用」', async () => {
    vi.stubGlobal('fetch', mockFetchWithTunnel(connectedTunnel(Date.now() - 15.5 * 60_000)));
    render(<MobileSyncPanel />);
    const badge = await waitFor(() => screen.getByTestId('tunnel-state-badge'));
    expect(badge.textContent).toBe('● 连接建立中 · 尚未确认公网可用');
    expect(badge.className).not.toContain('tunnelBadgeOn');
  });

  it('stateSinceTs 缺失/非法（旧后端）：从紧永不宣称「公网可用」', async () => {
    const withoutTs = { ...connectedTunnel(0) };
    delete (withoutTs as Partial<typeof withoutTs>).stateSinceTs;
    vi.stubGlobal('fetch', mockFetchWithTunnel(withoutTs));
    render(<MobileSyncPanel />);
    const badge = await waitFor(() => screen.getByTestId('tunnel-state-badge'));
    expect(badge.textContent).toBe('● 连接建立中 · 尚未确认公网可用');
  });

  // ── BLOCK-152 T：徽标消费叠加端到端探活证据（tunnel.js status() probeState）──

  it('BLOCK-152 T probe fail：即使 ≥15min 也不宣称「公网可用」，降级「公网未确认」（从紧）', async () => {
    vi.stubGlobal('fetch', mockFetchWithTunnel(connectedTunnel(Date.now() - 17 * 60_000, 'fail')));
    render(<MobileSyncPanel />);
    const badge = await waitFor(() => screen.getByTestId('tunnel-state-badge'));
    expect(badge.textContent).toBe('● 连接建立中 · 公网未确认');
    expect(badge.className).not.toContain('tunnelBadgeOn');
    expect(badge.className).toContain('tunnelBadgeWarn');
  });

  it('BLOCK-152 T probe ok + ≥15min：宣称「公网可用」（时长 + 探活双判据齐备）', async () => {
    vi.stubGlobal('fetch', mockFetchWithTunnel(connectedTunnel(Date.now() - 17 * 60_000, 'ok')));
    render(<MobileSyncPanel />);
    const badge = await waitFor(() => screen.getByTestId('tunnel-state-badge'));
    expect(badge.textContent).toBe('● 已连接 · 公网可用');
    expect(badge.className).toContain('tunnelBadgeOn');
    expect(badge.className).not.toContain('tunnelBadgeWarn');
  });

  it('BLOCK-152 T probe ok + <15min：仍「尚未确认」（时长判据独立保持）', async () => {
    vi.stubGlobal('fetch', mockFetchWithTunnel(connectedTunnel(Date.now() - 5 * 60_000, 'ok')));
    render(<MobileSyncPanel />);
    const badge = await waitFor(() => screen.getByTestId('tunnel-state-badge'));
    expect(badge.textContent).toBe('● 连接建立中 · 尚未确认公网可用');
    expect(badge.className).not.toContain('tunnelBadgeOn');
  });

  it('BLOCK-152 T probeState 缺失（旧后端）：维持 stateSinceTs 判定（17min → 公网可用，向后兼容）', async () => {
    vi.stubGlobal('fetch', mockFetchWithTunnel(connectedTunnel(Date.now() - 17 * 60_000)));
    render(<MobileSyncPanel />);
    const badge = await waitFor(() => screen.getByTestId('tunnel-state-badge'));
    expect(badge.textContent).toBe('● 已连接 · 公网可用');
    expect(badge.className).toContain('tunnelBadgeOn');
  });
});
