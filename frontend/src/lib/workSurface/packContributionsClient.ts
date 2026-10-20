import * as React from 'react';
import { getApiPrefix, getToken } from '@/lib/authClient';
import type {
  PackContributionInput,
  PackResultSurfaceContribution,
  PackUiActionContribution,
  PackViewContribution,
} from './registry';

interface ContributionsResponse {
  ok?: boolean;
  packs?: PackContributionInput[];
  diagnostics?: unknown[];
  error?: string;
}

let cache: PackContributionInput[] | null = null;
let inflight: Promise<PackContributionInput[]> | null = null;
let lastError: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function normalizePack(raw: unknown): PackContributionInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.packId !== 'string' || !record.packId.trim()) return null;
  return {
    packId: record.packId.trim(),
    views: Array.isArray(record.views) ? record.views as PackViewContribution[] : [],
    resultSurfaces: Array.isArray(record.resultSurfaces)
      ? record.resultSurfaces as PackResultSurfaceContribution[]
      : [],
    uiActions: Array.isArray(record.uiActions)
      ? record.uiActions as PackUiActionContribution[]
      : [],
  };
}

async function fetchPackContributions(force = false): Promise<PackContributionInput[]> {
  if (!force && cache) return cache;
  if (!force && inflight) return inflight;
  inflight = (async () => {
    try {
      const response = await fetch(`${getApiPrefix()}/packs/contributions`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!response.ok) throw new Error(`pack_contributions_http_${response.status}`);
      const payload = (await response.json()) as ContributionsResponse;
      if (payload.ok === false) throw new Error(payload.error || 'pack_contributions_failed');
      const packs = Array.isArray(payload.packs)
        ? payload.packs.map(normalizePack).filter((pack): pack is PackContributionInput => pack !== null)
        : [];
      cache = packs;
      lastError = null;
      return packs;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'pack_contributions_fetch_failed';
      // 失败不缓存：下一次挂载可重试；当次只返回空贡献（核心面不受影响）。
      return cache || [];
    } finally {
      inflight = null;
      emit();
    }
  })();
  return inflight;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function usePackContributions(): {
  packs: PackContributionInput[];
  loading: boolean;
  error: string | null;
} {
  const [packs, setPacks] = React.useState<PackContributionInput[]>(() => cache || []);
  const [loading, setLoading] = React.useState(cache === null);
  const [error, setError] = React.useState<string | null>(lastError);

  React.useEffect(() => {
    let alive = true;
    const sync = () => {
      if (!alive) return;
      setPacks(cache || []);
      setLoading(inflight !== null && cache === null);
      setError(lastError);
    };
    const unsubscribe = subscribe(sync);
    // 初始 loading 已在 useState 置位；这里只触发异步拉取，emit 由 fetch 的
    // finally 驱动，避免 effect 内同步 setState。
    if (!cache) void fetchPackContributions();
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return { packs, loading, error };
}
