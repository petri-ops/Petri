import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  usePluginStore,
  __resetPluginStoreCacheForTests,
  type RemotePlugin,
} from '@/hooks/usePluginStore';

interface BridgeOverrides {
  installed?: Array<{ id: string; version: string; type?: string; language?: string }>;
  remote?: { plugins: Record<string, RemotePlugin> };
  install?: (id: string, onProgress?: (data: unknown) => void) => Promise<{ ok: boolean; error?: string }>;
  uninstall?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  checkUpdates?: () => Promise<unknown>;
  runtime?: { status: () => Promise<{ r: { installed: boolean; path: string | null }; python: { installed: boolean; path: string | null } }> };
}

type MockFn = ReturnType<typeof vi.fn>;

interface BridgeHandles {
  installed: Array<{ id: string; version: string; type?: string; language?: string }>;
  remote: { plugins: Record<string, RemotePlugin> };
  install: MockFn;
  uninstall: MockFn;
  checkUpdates: MockFn;
  runtime: { status: MockFn };
}

function installBridge(overrides: BridgeOverrides = {}): BridgeHandles {
  const installed = (overrides.installed ?? []) as BridgeHandles['installed'];
  const remote = overrides.remote ?? { plugins: {} };
  const install = (overrides.install ? vi.fn(overrides.install) : vi.fn().mockResolvedValue({ ok: true })) as MockFn;
  const uninstall = (overrides.uninstall ? vi.fn(overrides.uninstall) : vi.fn().mockResolvedValue({ ok: true })) as MockFn;
  const checkUpdates = (overrides.checkUpdates ? vi.fn(overrides.checkUpdates) : vi.fn().mockResolvedValue([])) as MockFn;
  const runtime = overrides.runtime
    ? { status: vi.fn(overrides.runtime.status) as MockFn }
    : { status: vi.fn().mockResolvedValue({ r: { installed: false, path: null }, python: { installed: false, path: null } }) as MockFn };
  (window as unknown as { biof3Desktop: unknown }).biof3Desktop = {
    plugins: {
      listInstalled: vi.fn().mockResolvedValue(installed),
      listRemote: vi.fn().mockResolvedValue(remote),
      install,
      uninstall,
      checkUpdates,
    },
    runtime,
  };
  return { installed, remote, install, uninstall, checkUpdates, runtime };
}

function uninstallBridge() {
  delete (window as unknown as { biof3Desktop?: unknown }).biof3Desktop;
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
    (window as unknown as { biof3Desktop: unknown }).biof3Desktop = {
      plugins: { listInstalled, listRemote, install: vi.fn(), uninstall: vi.fn(), checkUpdates: vi.fn() },
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
    const bridge = (window as unknown as { biof3Desktop: { plugins: { listInstalled: ReturnType<typeof vi.fn> } } }).biof3Desktop;
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

  it('install wires the bridge call and refreshes on success', async () => {
    const { install } = installBridge();
    install.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => usePluginStore());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let result2: { ok: boolean } = { ok: false };
    await act(async () => {
      result2 = await result.current.install('p1');
    });
    expect(install).toHaveBeenCalledWith('p1', expect.any(Function));
    expect(result2).toEqual({ ok: true });
  });

  it('install surfaces failure from the bridge', async () => {
    const { install } = installBridge();
    install.mockResolvedValue({ ok: false, error: '权限被拒' });

    const { result } = renderHook(() => usePluginStore());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let result2: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      result2 = await result.current.install('p1');
    });
    expect(result2.error).toBe('权限被拒');
  });

  it('uninstall wires the bridge call and refreshes on success', async () => {
    const { uninstall } = installBridge({
      installed: [{ id: 'p1', version: '1.0.0' }],
    });
    uninstall.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => usePluginStore());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.installed).toHaveLength(1);

    let result2: { ok: boolean } = { ok: false };
    await act(async () => {
      result2 = await result.current.uninstall('p1');
    });
    expect(uninstall).toHaveBeenCalledWith('p1');
    expect(result2).toEqual({ ok: true });
  });

  it('checkUpdates populates the updates array', async () => {
    const { checkUpdates } = installBridge();
    checkUpdates.mockResolvedValue([{ id: 'p1', currentVersion: '1.0.0', latestVersion: '1.0.1' }]);

    const { result } = renderHook(() => usePluginStore());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.updates).toEqual([]);

    await act(async () => {
      await result.current.checkUpdates();
    });
    expect(result.current.updates).toEqual([{ id: 'p1', currentVersion: '1.0.0', latestVersion: '1.0.1' }]);
  });

  it('two subscribers see the same installed list after one calls install', async () => {
    const { install, installed } = installBridge({
      installed: [{ id: 'p1', version: '1.0.0' }],
    });

    const a = renderHook(() => usePluginStore());
    const b = renderHook(() => usePluginStore());
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    await waitFor(() => expect(b.result.current.loading).toBe(false));

    installed.length = 0;
    installed.push({ id: 'p1', version: '1.0.0' }, { id: 'p2', version: '2.0.0' });
    install.mockResolvedValue({ ok: true });

    await act(async () => {
      await a.result.current.install('p2');
    });
    expect(b.result.current.installed).toHaveLength(2);
    expect(b.result.current.installed.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});