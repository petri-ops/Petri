// ============================================================
// useBranchStore — SWR-style hook for branch state management
//
// Phase 1: Branch Tab UI + state management
// Follows the established pattern of usePluginStore / useConversations
// with module-level cache shared across components.
//
// Design:
//   - A module-level cache shares branch data across every consumer
//     for the same projectId. Switching branches updates the shared
//     cache immediately without re-fetching.
//   - The hook exposes actions that update both the cache and call IPC.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { branchApi } from '@/lib/branchBridge';
import type { Branch } from '@/types/branch.types';

// ============================================================
// Module-level cache (shared across all consumers)
// ============================================================

interface BranchCache {
  branches: Branch[];
  activeBranchId: string | null;
}

const sharedCache = new Map<string, BranchCache>();
const inflight = new Map<string, Promise<BranchCache>>();
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((fn) => fn());
}

async function loadBranches(projectId: string, force = false): Promise<BranchCache> {
  // Short-circuit on cache hit
  if (!force) {
    const cached = sharedCache.get(projectId);
    if (cached) return cached;
  }

  const existing = inflight.get(projectId);
  if (existing) return existing;

  const promise = (async () => {
    const branches = await branchApi.list(projectId);
    const activeBranch = branches.find((b) => b.isActive) || branches[0] || null;
    const cache: BranchCache = {
      branches,
      activeBranchId: activeBranch?.id || null,
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

export interface UseBranchStoreResult {
  branches: Branch[];
  activeBranchId: string | null;
  activeBranch: Branch | null;
  loading: boolean;
  error: string | null;

  /** Force a re-fetch of branches */
  refresh: () => Promise<void>;

  /** Create a new branch */
  createBranch: (name: string, parentBranchId?: string) => Promise<Branch | null>;

  /** Switch to a different branch */
  switchBranch: (branchId: string) => Promise<void>;

  /** Delete a branch */
  deleteBranch: (branchId: string) => Promise<boolean>;

  /** Rename a branch */
  renameBranch: (branchId: string, newName: string) => Promise<boolean>;
}

export function useBranchStore(
  projectId: string | null | undefined
): UseBranchStoreResult {
  const [snapshot, setSnapshot] = useState<BranchCache>(() => {
    if (!projectId) return { branches: [], activeBranchId: null };
    return sharedCache.get(projectId) || { branches: [], activeBranchId: null };
  });
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

  // Load branches on mount / projectId change
  useEffect(() => {
    if (!projectId) {
      currentRef.current = null;
      setSnapshot({ branches: [], activeBranchId: null });
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

    loadBranches(projectId)
      .then((cache) => {
        if (cancelled || currentRef.current !== projectId) return;
        setSnapshot(cache);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled || currentRef.current !== projectId) return;
        setError((e as Error)?.message || 'failed to load branches');
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
      const cache = await loadBranches(projectId, true);
      if (currentRef.current !== projectId) return;
      setSnapshot(cache);
    } catch (e) {
      if (currentRef.current !== projectId) return;
      setError((e as Error)?.message || 'failed to refresh branches');
    } finally {
      if (currentRef.current === projectId) setLoading(false);
    }
  }, [projectId]);

  const createBranch = useCallback(
    async (name: string, parentBranchId?: string): Promise<Branch | null> => {
      if (!projectId) return null;

      try {
        const newBranch = await branchApi.create(projectId, name, parentBranchId);
        const cache = sharedCache.get(projectId);
        if (cache) {
          const next = { ...cache, branches: [...cache.branches, newBranch] };
          sharedCache.set(projectId, next);
          if (currentRef.current === projectId) setSnapshot(next);
        }
        return newBranch;
      } catch (e) {
        setError((e as Error)?.message || 'failed to create branch');
        return null;
      }
    },
    [projectId]
  );

  const switchBranch = useCallback(
    async (branchId: string): Promise<void> => {
      if (!projectId) return;

      try {
        // UI-P2-001: branch:switch handler 要求 projectId 限定停活范围
        await branchApi.switch(branchId, projectId);
        const cache = sharedCache.get(projectId);
        if (cache) {
          const next: BranchCache = {
            branches: cache.branches.map((b) => ({
              ...b,
              isActive: b.id === branchId,
            })),
            activeBranchId: branchId,
          };
          sharedCache.set(projectId, next);
          if (currentRef.current === projectId) setSnapshot(next);
        }
      } catch (e) {
        setError((e as Error)?.message || 'failed to switch branch');
      }
    },
    [projectId]
  );

  const deleteBranch = useCallback(
    async (branchId: string): Promise<boolean> => {
      if (!projectId) return false;

      try {
        await branchApi.delete(branchId);
        const cache = sharedCache.get(projectId);
        if (cache) {
          const next: BranchCache = {
            branches: cache.branches.filter((b) => b.id !== branchId),
            activeBranchId:
              cache.activeBranchId === branchId
                ? cache.branches.find((b) => b.id !== branchId)?.id || null
                : cache.activeBranchId,
          };
          sharedCache.set(projectId, next);
          if (currentRef.current === projectId) setSnapshot(next);
        }
        return true;
      } catch (e) {
        setError((e as Error)?.message || 'failed to delete branch');
        return false;
      }
    },
    [projectId]
  );

  const renameBranch = useCallback(
    async (branchId: string, newName: string): Promise<boolean> => {
      if (!projectId) return false;

      try {
        await branchApi.rename(branchId, newName);
        const cache = sharedCache.get(projectId);
        if (cache) {
          const next: BranchCache = {
            ...cache,
            branches: cache.branches.map((b) =>
              b.id === branchId ? { ...b, name: newName, updatedAt: Date.now() } : b
            ),
          };
          sharedCache.set(projectId, next);
          if (currentRef.current === projectId) setSnapshot(next);
        }
        return true;
      } catch (e) {
        setError((e as Error)?.message || 'failed to rename branch');
        return false;
      }
    },
    [projectId]
  );

  const activeBranch = snapshot.branches.find((b) => b.id === snapshot.activeBranchId) || null;

  return {
    branches: snapshot.branches,
    activeBranchId: snapshot.activeBranchId,
    activeBranch,
    loading,
    error,
    refresh,
    createBranch,
    switchBranch,
    deleteBranch,
    renameBranch,
  };
}

/** Test-only helper. Clears module-scope cache between test runs. */
export function __resetBranchStoreCacheForTests(): void {
  sharedCache.clear();
  inflight.clear();
  subscribers.clear();
}
