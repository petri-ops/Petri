// ============================================================
// usePluginStore — SWR-style hook for the plugin catalog
// (installed list + runtime manifest + runtime status).
//
// BLOCK-158 商店面退役 — 原「插件商店」写面（install/uninstall/
// checkUpdates/updates 徽标/启停开关）随商店卡片移除；本 hook 收敛为
// **目录读面**：已装清单（installed.json）、运行时目录（runtime manifest，
// 供包卡片运行时标题/体积）、运行时在位状态（runtime banner）。
// 插件分发 = 领域包通道（packs.*，见 PluginStorePanel/useDomainPacks）；
// 运行时安装 = 包一键内链 installPlugin（pack-lifecycle）。
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { getBridge } from '@/lib/desktopBridge';

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

interface PluginManifest {
  plugins: Record<string, RemotePlugin>;
}

interface PluginStoreSnapshot {
  installed: InstalledPlugin[];
  remote: PluginManifest;
  runtimeStatus: RuntimeStatus | null;
}

let cache: PluginStoreSnapshot = { installed: [], remote: { plugins: {} }, runtimeStatus: null };
let loaded = false;
let inflight: Promise<PluginStoreSnapshot> | null = null;
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

export interface UsePluginStoreResult {
  installed: InstalledPlugin[];
  remote: PluginManifest;
  runtimeStatus: RuntimeStatus | null;
  loading: boolean;
  /** Force a full refresh (installed + runtime manifest + runtime status). */
  refresh: () => Promise<void>;
}

export function usePluginStore(
  opts: {
    /** When true, the hook triggers a full refresh on mount.
     *  Defaults to `true` for the standalone PluginStorePanel. */
    autoLoad?: boolean;
  } = {}
): UsePluginStoreResult {
  const { autoLoad = true } = opts;
  const [snapshot, setSnapshot] = useState<PluginStoreSnapshot>(cache);
  const [loading, setLoading] = useState(!loaded && autoLoad);

  useEffect(() => {
    let cancelled = false;
    const onChange = () => {
      if (cancelled) return;
      setSnapshot(cache);
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
    const next = await refreshAllCore();
    setSnapshot(next);
    setLoading(false);
  }, []);

  return {
    installed: snapshot.installed,
    remote: snapshot.remote,
    runtimeStatus: snapshot.runtimeStatus,
    loading,
    refresh,
  };
}

/** Test-only helper. */
export function __resetPluginStoreCacheForTests(): void {
  cache = { installed: [], remote: { plugins: {} }, runtimeStatus: null };
  loaded = false;
  inflight = null;
  subscribers.clear();
}
