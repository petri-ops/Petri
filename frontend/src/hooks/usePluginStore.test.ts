import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  usePluginStore,
  __resetPluginStoreCacheForTests,
  type RemotePlugin,
} from '@/hooks/usePluginStore';

// BLOCK-158 商店面退役 — 本 hook 收敛为目录读面（installed/runtime manifest/runtimeStatus）；
// 安装/卸载/更新面随商店卡片移除（分发 = 领域包通道 packs.*）。

interface BridgeOverrides {
  installed?: Array<{ id: string; version: string; type?: string; language?: string }>;
  remote?: { plugins: Record<string, RemotePlugin> };
  runtime?: { status: () => Promise<{ r: { installed: boolean; path: string | null }; python: { installed: boolean; path: string | null } }> };
}

type MockFn = ReturnType<typeof vi.fn>;

function installBridge(overrides: BridgeOverrides = {}): BridgeHandles {
  const installed = (overrides.installed ?? []) as BridgeHandles['installed'];
  const remote = overrides.remote ?? { plugins: {} };
  const runtime = overrides.runtime
    ? { status: vi.fn(overrides.runtime.status) as MockFn }
    : { status: vi.fn().mockResolvedValue({ r: { installed: false, path: null }, python: { installed: false, path: null } }) };
  (window as unknown as { petriDesktop: unknown }).petriDesktop = {
    plugins: {
      listInstalled: vi.fn().mockResolvedValue(installed),
      listRemote: vi.fn().mockResolvedValue(remote),
    },
    runtime,
  };
  return { installed, remote, runtime };
}

interface BridgeHandles {
  installed: Array<{ id: string; version: string; type?: string; language?: string }>;
  remote: { plugins: Record<string, RemotePlugin> };
  runtime: { status: MockFn };
}

function uninstallBridge() {
  delete (window as unknown as { petriDesktop?: unknown }).petriDesktop;
}

beforeEach(() => {
  __resetPluginStoreCacheForTests();
  uninstallBridge();
});

describe('usePluginStore', () => {
  it('exposes empty defaults when no bridge is installed', async () => {
    const { result } = renderHook(() => usePluginStore());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.installed).toEqual([]);
    expect(result.current.remote).toEqual({ plugins: {} });
    expect(result.current.runtimeStatus).toBeNull();
  });

  it('loads installed / remote / runtime on first mount', async () => {
    installBridge({
      installed: [{ id: 'p1', version: '1.0.0', type: 'tool' }],
      remote: { plugins: { p1: { title: 'P1', version: '1.0.0' } } },
      runtime: { status: vi.fn().mockResolvedValue({ r: { installed: true, path: '/usr/bin/R' }, python: { installed: false, path: null } }) },
    });
    const { result } = renderHook(() => usePluginStore());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.installed).toEqual([{ id: 'p1', version: '1.0.0', type: 'tool' }]);
    expect(result.current.remote.plugins?.p1?.title).toBe('P1');
    expect(result.current.runtimeStatus?.r.installed).toBe(true);
  });

  it('does not refetch on a second mount of the same hook', async () => {
    const listInstalled = vi.fn().mockResolvedValue([]);
    const listRemote = vi.fn().mockResolvedValue({ plugins: {} });
    (window as unknown as { petriDesktop: unknown }).petriDesktop = {
      plugins: { listInstalled, listRemote },
      runtime: { status: vi.fn().mockResolvedValue({ r: { installed: false, path: null }, python: { installed: false, path: null } }) },
    };
    const first = renderHook(() => usePluginStore());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    const second = renderHook(() => usePluginStore());
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(listInstalled).toHaveBeenCalledTimes(1);
    expect(listRemote).toHaveBeenCalledTimes(1);
  });

  it('autoLoad=false skips the bridge on mount but refresh() populates later', async () => {
    installBridge({ installed: [{ id: 'p1', version: '1.0.0' }] });
    const bridge = (window as unknown as { petriDesktop: { plugins: { listInstalled: ReturnType<typeof vi.fn> } } }).petriDesktop;
    const listInstalled = bridge.plugins.listInstalled;
    listInstalled.mockClear();

    const { result } = renderHook(() => usePluginStore({ autoLoad: false }));
    expect(result.current.loading).toBe(false);
    expect(listInstalled).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.installed).toEqual([{ id: 'p1', version: '1.0.0' }]);
    expect(listInstalled).toHaveBeenCalledTimes(1);
  });

  it('BLOCK-158 商店面退役：写面（install/uninstall/checkUpdates/updates/setEnabled）不再存在于 hook API', () => {
    const { result } = renderHook(() => usePluginStore());
    const api = result.current as unknown as Record<string, unknown>;
    expect(api.install).toBeUndefined();
    expect(api.uninstall).toBeUndefined();
    expect(api.checkUpdates).toBeUndefined();
    expect(api.updates).toBeUndefined();
    expect(api.setEnabled).toBeUndefined();
    expect(typeof api.refresh).toBe('function');
  });
});
