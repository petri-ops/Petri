// ============================================================
// useResultStore — SWR-style hook for result state management
//
// Phase 2: Project-scoped results shared across branches
// Follows the established pattern of useBranchStore with module-level cache.
//
// Design:
//   - Results are cached by PROJECT ID, NOT branch ID
//   - Branch switching does NOT trigger result reload
//   - This is the key architectural difference from branch state
//   - Results persist across branch switches within the same project
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { resultApi } from '@/lib/resultBridge';
import type { Result, ResultSummary, ListResultsOptions } from '@/types/result.types';

// ============================================================
// Module-level cache (shared across all consumers)
// ============================================================

interface ResultCache {
  /** Full result objects for the project */
  results: Result[];
  /** Lightweight summaries for listing */
  summaries: ResultSummary[];
  /** Active result ID within this project */
  activeResultId: string | null;
}

const sharedCache = new Map<string, ResultCache>();
const inflight = new Map<string, Promise<ResultCache>>();
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((fn) => fn());
}

async function loadResults(
  projectId: string,
  force = false
): Promise<ResultCache> {
  if (!force) {
    const cached = sharedCache.get(projectId);
    if (cached) return cached;
  }

  const existing = inflight.get(projectId);
  if (existing) return existing;

  const promise = (async () => {
    const [results, summaries] = await Promise.all([
      resultApi.byProject(projectId),
      resultApi.list(projectId),
    ]);
    const cache: ResultCache = {
      results,
      summaries,
      activeResultId: null,
    };
    sharedCache.set(projectId, cache);
    inflight.delete(projectId);
    notify();
    return cache;
  })();

  inflight.set(projectId, promise);
  return promise;
}

// ============================================================
// Hook interface
// ============================================================

export interface UseResultStoreResult {
  /** Full result objects for the current project */
  results: Result[];
  /** Lightweight summaries for listing */
  summaries: ResultSummary[];
  /** Results indexed by ID for quick lookup */
  resultsById: Map<string, Result>;
  /** Active result ID */
  activeResultId: string | null;
  loading: boolean;
  error: string | null;

  /** Force a re-fetch of results */
  refresh: () => Promise<void>;

  /** Set the active result */
  setActiveResult: (resultId: string | null) => void;

  /** Create a new result */
  createResult: (
    type: Result['type'],
    name: string,
    data: unknown,
    config?: Record<string, unknown>,
    sourceBranchId?: string
  ) => Promise<Result | null>;

  /** Update an existing result */
  updateResult: (
    resultId: string,
    updates: { name?: string; data?: unknown; config?: Record<string, unknown> }
  ) => Promise<Result | null>;

  /** Delete a result */
  deleteResult: (resultId: string) => Promise<boolean>;
}

export function useResultStore(
  projectId: string | null | undefined
): UseResultStoreResult {
  const [snapshot, setSnapshot] = useState<ResultCache>(() => ({
    results: [],
    summaries: [],
    activeResultId: null,
  }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentRef = useRef<string | null>(projectId || null);

  // Subscribe to cache updates from other consumers
  useEffect(() => {
    if (!projectId) return;

    const onChange = () => {
      const cached = sharedCache.get(projectId);
      if (cached) setSnapshot(cached);
    };

    subscribers.add(onChange);
    return () => {
      subscribers.delete(onChange);
    };
  }, [projectId]);

  // Load results on mount / projectId change
  useEffect(() => {
    if (!projectId) {
      currentRef.current = null;
      setSnapshot({ results: [], summaries: [], activeResultId: null });
      setLoading(false);
      setError(null);
      return;
    }

    currentRef.current = projectId;
    const cached = sharedCache.get(projectId);
    if (cached) {
      setSnapshot(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    loadResults(projectId)
      .then((cache) => {
        if (cancelled || currentRef.current !== projectId) return;
        setSnapshot(cache);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled || currentRef.current !== projectId) return;
        setError((e as Error)?.message || 'failed to load results');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    inflight.delete(projectId);
    setLoading(true);
    setError(null);
    try {
      const cache = await loadResults(projectId, true);
      if (currentRef.current !== projectId) return;
      setSnapshot(cache);
    } catch (e) {
      if (currentRef.current !== projectId) return;
      setError((e as Error)?.message || 'failed to refresh results');
    } finally {
      if (currentRef.current === projectId) setLoading(false);
    }
  }, [projectId]);

  const setActiveResult = useCallback(
    (resultId: string | null) => {
      if (!projectId) return;
      const cache = sharedCache.get(projectId);
      if (cache) {
        const next: ResultCache = { ...cache, activeResultId: resultId };
        sharedCache.set(projectId, next);
        if (currentRef.current === projectId) setSnapshot(next);
      }
    },
    [projectId]
  );

  const createResult = useCallback(
    async (
      type: Result['type'],
      name: string,
      data: unknown,
      config?: Record<string, unknown>,
      sourceBranchId?: string
    ): Promise<Result | null> => {
      if (!projectId) return null;

      try {
        const newResult = await resultApi.create(
          projectId,
          type,
          name,
          data,
          config,
          sourceBranchId
        );
        const cache = sharedCache.get(projectId);
        if (cache) {
          const next: ResultCache = {
            ...cache,
            results: [newResult, ...cache.results],
            summaries: [
              {
                id: newResult.id,
                projectId: newResult.projectId,
                type: newResult.type,
                name: newResult.name,
                sourceBranchId: newResult.sourceBranchId,
                updatedAt: newResult.updatedAt,
              },
              ...cache.summaries,
            ],
          };
          sharedCache.set(projectId, next);
          if (currentRef.current === projectId) setSnapshot(next);
        }
        return newResult;
      } catch (e) {
        setError((e as Error)?.message || 'failed to create result');
        return null;
      }
    },
    [projectId]
  );

  const updateResult = useCallback(
    async (
      resultId: string,
      updates: { name?: string; data?: unknown; config?: Record<string, unknown> }
    ): Promise<Result | null> => {
      if (!projectId) return null;

      try {
        const updated = await resultApi.update(resultId, updates);
        if (!updated) return null;

        const cache = sharedCache.get(projectId);
        if (cache) {
          const next: ResultCache = {
            ...cache,
            results: cache.results.map((r) =>
              r.id === resultId ? updated : r
            ),
            summaries: cache.summaries.map((s) =>
              s.id === resultId
                ? {
                    ...s,
                    name: updated.name,
                    updatedAt: updated.updatedAt,
                  }
                : s
            ),
          };
          sharedCache.set(projectId, next);
          if (currentRef.current === projectId) setSnapshot(next);
        }
        return updated;
      } catch (e) {
        setError((e as Error)?.message || 'failed to update result');
        return null;
      }
    },
    [projectId]
  );

  const deleteResult = useCallback(
    async (resultId: string): Promise<boolean> => {
      if (!projectId) return false;

      try {
        await resultApi.delete(resultId);
        const cache = sharedCache.get(projectId);
        if (cache) {
          const next: ResultCache = {
            ...cache,
            results: cache.results.filter((r) => r.id !== resultId),
            summaries: cache.summaries.filter((s) => s.id !== resultId),
            activeResultId:
              cache.activeResultId === resultId ? null : cache.activeResultId,
          };
          sharedCache.set(projectId, next);
          if (currentRef.current === projectId) setSnapshot(next);
        }
        return true;
      } catch (e) {
        setError((e as Error)?.message || 'failed to delete result');
        return false;
      }
    },
    [projectId]
  );

  // Build a Map for quick lookup by ID
  const resultsById = new Map(snapshot.results.map((r) => [r.id, r]));

  return {
    results: snapshot.results,
    summaries: snapshot.summaries,
    resultsById,
    activeResultId: snapshot.activeResultId,
    loading,
    error,
    refresh,
    setActiveResult,
    createResult,
    updateResult,
    deleteResult,
  };
}

/** Test-only helper. Clears module-scope cache between test runs. */
export function __resetResultStoreCacheForTests(): void {
  sharedCache.clear();
  inflight.clear();
  subscribers.clear();
}
