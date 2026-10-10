// ============================================================
// usePluginStore — SWR-style hook for the plugin store
// (installed list + remote manifest + runtime status).
//
// State-decomposition §4.6 [HIGH] flagged that the plugin
// catalog lived in three independent `useState` caches:
//
//   - PluginStorePanel.tsx   (line 94-96 pre-commit, lists +
//                             runtimeStatus + checkUpdates
//                             on mount).
//   - project-workspace.tsx ToolboxPanel (~line 2020-2025
//                             pre-commit, lists only).
//
// Both components called
// `window.biof3Desktop.plugins.listInstalled()` +
// `listRemote()` on mount and held their own snapshot. When
// one panel installed or uninstalled a plugin, the other
// panel's list stayed stale until the user toggled its tab
// or remounted the workspace. The hook replaces both caches
// and shares them via a module-level listener fan-out.
//
// Per-call UI state (install / uninstall spinner flags,
// progress bar by pluginId, last-installed runtime banner)
// stays in the caller; these are intrinsically per-action
// concerns, not shared catalog data.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { getBridge } from '@/lib/desktopBridge';

// Types — exported so callers don't re-declare them inline
// (the project's existing `RemotePlugin` lives in electron.d.ts;
// the two inline copies in PluginStorePanel / project-workspace
// ToolboxPanel are now replaced by this central one).
export interface PluginInstallProgress {
  ratio: number;
  received: number;
  total: number;
}

export interface InstalledPlugin {
  id: string;
  version: string;
  installedAt?: string;
  type?: string;
  language?: string;
  scriptFingerprint?: string | null;
  installedFingerprint?: string | null;
  currentFingerprint?: string | null;
  manifestDrift?: boolean;
  driftReason?: string | null;
  /** BLOCK-157 DIST-1 — 启停粒度（缺省 true=启用；停用即不注册，重启后生效） */
  enabled?: boolean;
}

export interface RemotePlugin {
  title?: string;
  version?: string;
  language?: string;
  size?: number;
  description?: string;
  type?: string;
  dependencies?: string[];
  optional?: boolean;
}

export interface RuntimeStatus {
  r: { installed: boolean; path: string | null };
  python: { installed: boolean; path: string | null };
}

export interface UpdateInfo {
  id: string;
  currentVersion: string;
  latestVersion: string;
  changelog?: string;
  size?: number;
}

interface PluginManifest {
  plugins: Record<string, RemotePlugin>;
}

interface PluginStoreSnapshot {
  installed: InstalledPlugin[];
  remote: PluginManifest;
  runtimeStatus: RuntimeStatus | null;
}

// Plan 1.6 §4.7 [HIGH] — drop the hand-rolled `PluginBridge`
// interface and the inline `getBridge()` helper. The canonical
// bridge shape lives in `@/lib/electron.d.ts` and the typed
// accessor lives in `@/lib/desktopBridge`. Hook now just
// calls `getBridge('plugins')` and gets the proper return
// type automatically.

let cache: PluginStoreSnapshot = { installed: [], remote: { plugins: {} }, runtimeStatus: null };
let loaded = false;
let inflight: Promise<PluginStoreSnapshot> | null = null;
let updatesInflight: Promise<void> | null = null;
let updatesCache: UpdateInfo[] = [];
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((fn) => fn());
}

async function refreshAllCore(): Promise<PluginStoreSnapshot> {
  if (inflight) return inflight;
  const bridge = getBridge('plugins');
  if (!bridge) return cache;
  inflight = (async () => {
    const [inst, rem] = await Promise.all([
      bridge.listInstalled().catch(() => []),
      bridge.listRemote().catch(() => ({ plugins: {} })),
    ]);
    const runtime = getBridge('runtime');
    const rt = (await runtime?.status?.().catch(() => null)) ?? null;
    cache = { installed: inst, remote: rem, runtimeStatus: rt };
    loaded = true;
    notify();
    return cache;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function refreshUpdates(): Promise<void> {
  const bridge = getBridge('plugins');
  if (!bridge?.checkUpdates) return;
  if (updatesInflight) return updatesInflight;
  updatesInflight = bridge
    .checkUpdates()
    .then((result) => {
      updatesCache = Array.isArray(result) ? result : [];
      notify();
    })
    .catch(() => {
      /* silent — same as the previous caller behaviour */
    })
    .finally(() => {
      updatesInflight = null;
    });
  return updatesInflight;
}

export interface UsePluginStoreResult {
  installed: InstalledPlugin[];
  remote: PluginManifest;
  runtimeStatus: RuntimeStatus | null;
  updates: UpdateInfo[];
  checkingUpdates: boolean;
  loading: boolean;
  /** Force a full refresh (installed + remote + runtime + updates). */
  refresh: () => Promise<void>;
  /** Force a refresh of just the updates list. */
  checkUpdates: () => Promise<void>;
  /** Install a plugin via the electron bridge. On success the
   *  cache is refreshed and `updates` re-checked. The optional
   *  `onProgress` callback fires with per-byte progress events
   *  for the caller to render a progress bar. */
  install: (
    pluginId: string,
    onProgress?: (data: PluginInstallProgress) => void
  ) => Promise<{ ok: boolean; error?: string }>;
  /** Uninstall a plugin via the electron bridge. Cache refresh
   *  happens on success. */
  uninstall: (pluginId: string) => Promise<{ ok: boolean; error?: string }>;
  /** BLOCK-157 DIST-1 — 启停粒度：翻转 enabled 标志（文件不动免重装；
   *  本地乐观更新 installed 缓存，重启后加载器生效）。 */
  setEnabled: (pluginId: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
}

export function usePluginStore(
  opts: {
    /** When true, the hook triggers a full refresh on mount
     *  (listInstalled + listRemote + runtime.status + updates).
     *  Defaults to `true` for the standalone PluginStorePanel.
     *  ToolboxPanel sets this to `false` because the user only
     *  needs the catalog when its "plugins" tab is opened —
     *  saving one roundtrip per workspace mount. */
    autoLoad?: boolean;
  } = {}
): UsePluginStoreResult {
  const { autoLoad = true } = opts;
  const [snapshot, setSnapshot] = useState<PluginStoreSnapshot>(cache);
  const [updates, setUpdates] = useState<UpdateInfo[]>(updatesCache);
  const [checkingUpdates] = useState(false); // kept for API stability
  const [loading, setLoading] = useState(!loaded && autoLoad);

  useEffect(() => {
    let cancelled = false;
    const onChange = () => {
      if (cancelled) return;
      setSnapshot(cache);
      setUpdates(updatesCache);
    };
    subscribers.add(onChange);
    if (autoLoad && !loaded) {
      setLoading(true);
      refreshAllCore().then((next) => {
        if (cancelled) return;
        setSnapshot(next);
        setLoading(false);
      }).catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    } else if (!autoLoad) {
      setLoading(false);
    }
    return () => {
      cancelled = true;
      subscribers.delete(onChange);
    };
  }, [autoLoad]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      refreshAllCore().then((next) => setSnapshot(next)),
      refreshUpdates().then(() => setUpdates(updatesCache)),
    ]);
    setLoading(false);
  }, []);

  const checkUpdates = useCallback(async () => {
    await refreshUpdates();
    setUpdates(updatesCache);
  }, []);

  const install = useCallback(
    async (
      pluginId: string,
      onProgress?: (data: PluginInstallProgress) => void
    ): Promise<{ ok: boolean; error?: string }> => {
      const bridge = getBridge('plugins');
      if (!bridge) return { ok: false, error: 'bridge unavailable' };
      const result = await bridge.install(pluginId, (data) => {
        if (onProgress) {
          onProgress({ ratio: data.ratio, received: data.received, total: data.total });
        }
      });
      if (result.ok) {
        const next = await refreshAllCore();
        setSnapshot(next);
        await refreshUpdates();
        setUpdates(updatesCache);
      }
      return result;
    },
    []
  );

  const uninstall = useCallback(async (pluginId: string) => {
    const bridge = getBridge('plugins');
    if (!bridge) return { ok: false, error: 'bridge unavailable' };
    const result = await bridge.uninstall(pluginId);
    if (result.ok) {
      const next = await refreshAllCore();
      setSnapshot(next);
    }
    return result;
  }, []);

  // BLOCK-157 DIST-1 — 启停粒度：乐观翻转本地缓存行（重启后端才改注册面，
  // 无需拉远端重刷）；投影环境无 setEnabled 桥时诚实失败。
  const setEnabled = useCallback(async (pluginId: string, enabled: boolean) => {
    const bridge = getBridge('plugins');
    if (!bridge?.setEnabled) return { ok: false, error: 'bridge unavailable' };
    const result = await bridge.setEnabled(pluginId, enabled);
    if (result.ok) {
      setSnapshot((prev) => ({
        ...prev,
        installed: prev.installed.map((p) => (p.id === pluginId ? { ...p, enabled } : p)),
      }));
    }
    return result;
  }, []);

  return {
    installed: snapshot.installed,
    remote: snapshot.remote,
    runtimeStatus: snapshot.runtimeStatus,
    updates,
    checkingUpdates,
    loading,
    refresh,
    checkUpdates,
    install,
    uninstall,
    setEnabled,
  };
}

/** Test-only helper. */
export function __resetPluginStoreCacheForTests(): void {
  cache = { installed: [], remote: { plugins: {} }, runtimeStatus: null };
  loaded = false;
  inflight = null;
  updatesCache = [];
  updatesInflight = null;
  subscribers.clear();
}
