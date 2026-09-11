// ============================================================
// useConversations — SWR-style hook for /ai/conversations lists.
//
// Replaces the duplicated `useState + listConversations()` cache
// that previously lived in three places (project-workspace
// sidebar, SimpleChat, and the now-removed CopilotChat page).
// State-decomposition §4.3 [HIGH].
//
// Design:
//   - A module-level `Map<projectId, ConversationSummary[]>`
//     shares the loaded list across every consumer that asks
//     for the same projectId. This way the sidebar and the chat
//     panel see the same list, and one panel's `create` is
//     immediately visible to the other (no 5s timer race).
//   - The hook revalidates on mount and exposes a `refresh()`
//     so callers can force a re-fetch after mutating (create /
//     delete / archive) without racing the shared cache.
//   - For the sidebar's "other projects" list, useOtherConversations
//     is a separate hook that lazily loads each expanded project
//     into the same shared cache.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createConversation as apiCreateConversation,
  forkConversation as apiForkConversation,
  listConversations,
  type ConversationSummary,
} from '@/components/copilot/copilotConversationsClient';

// Shared cache. Survives component unmounts within the same
// renderer session so a sidebar collapse + expand doesn't trigger
// another HTTP roundtrip.
const sharedCache = new Map<string, ConversationSummary[]>();

/**
 * BLOCK-80 — 外部（欢迎页首问）创建会话后写入共享缓存：新会话置队首，
 * 保证工作区挂载时 seeds activeConvId = 新会话、左栏立即可见。
 * 不走这里直接 REST 建会话 → 缓存不知情 → 左栏/种子全部失明（本次事故根因）。
 */
export function primeConversationCache(projectId: string, created: ConversationSummary): void {
  const next = [created, ...(sharedCache.get(projectId) || [])];
  sharedCache.set(projectId, next);
}
// Track in-flight requests so two components mounting at once
// (sidebar + chat panel) don't issue parallel fetches.
const inflight = new Map<string, Promise<ConversationSummary[]>>();

async function loadShared(
  projectId: string,
  options: { force?: boolean } = {}
): Promise<ConversationSummary[]> {
  // Short-circuit on cache hit. The inflight guard below also
  // coalesces parallel requests, but cache hit avoids one roundtrip
  // per component remount (e.g. sidebar collapse + expand).
  if (!options.force) {
    const cached = sharedCache.get(projectId);
    if (cached) return cached;
  }
  const existing = inflight.get(projectId);
  if (existing) return existing;
  const promise = listConversations('active', projectId).then((list) => {
    sharedCache.set(projectId, list);
    inflight.delete(projectId);
    return list;
  });
  inflight.set(projectId, promise);
  return promise;
}

export interface UseConversationsResult {
  /** Latest loaded list for this project. Empty until first fetch. */
  list: ConversationSummary[];
  /** True while the first fetch is in-flight (mount). */
  loading: boolean;
  /** Most recent fetch error message, or null. */
  error: string | null;
  /** Force a re-fetch. Call after create / delete / archive. */
  refresh: () => Promise<void>;
  /** Create a new conversation in this project. Returns the new
   *  summary or null on failure. Optimistically prepends to the
   *  shared cache so the sidebar updates immediately. */
  create: (title?: string) => Promise<ConversationSummary | null>;
  /** Fork an existing conversation, creating a new one with all messages copied.
   *  Returns the new conversation summary with parent_id set. */
  fork: (conversationId: string, title?: string) => Promise<ConversationSummary | null>;
}

export function useConversations(
  projectId: string | null | undefined
): UseConversationsResult {
  const [list, setList] = useState<ConversationSummary[]>(
    () => (projectId ? sharedCache.get(projectId) || [] : [])
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks the projectId currently subscribed so a projectId
  // change resets state cleanly without leaving a "stale" list
  // on screen.
  const currentRef = useRef<string | null>(projectId || null);

  useEffect(() => {
    if (!projectId) {
      currentRef.current = null;
      setList([]);
      setLoading(false);
      setError(null);
      return;
    }
    currentRef.current = projectId;
    const cached = sharedCache.get(projectId) || [];
    setList(cached);
    // If the cache already has this project, we don't need to fetch
    // — the cached snapshot is the freshest known state. Skipping the
    // load here is what makes "remount the same project = no fetch"
    // work in the test (and in the real sidebar collapse / expand UX).
    if (cached.length > 0 || sharedCache.has(projectId)) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadShared(projectId)
      .then((next) => {
        if (cancelled || currentRef.current !== projectId) return;
        setList(next);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled || currentRef.current !== projectId) return;
        setError(e?.message || 'failed to load conversations');
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
      const next = await loadShared(projectId, { force: true });
      if (currentRef.current !== projectId) return;
      setList(next);
    } catch (e) {
      if (currentRef.current !== projectId) return;
      setError((e as Error)?.message || 'failed to load conversations');
    } finally {
      if (currentRef.current === projectId) setLoading(false);
    }
  }, [projectId]);

  const create = useCallback(
    async (title?: string): Promise<ConversationSummary | null> => {
      if (!projectId) return null;
      const created = await apiCreateConversation(title, undefined, projectId);
      if (created) {
        const next = [created, ...(sharedCache.get(projectId) || [])];
        sharedCache.set(projectId, next);
        if (currentRef.current === projectId) setList(next);
      }
      return created;
    },
    [projectId]
  );

  const fork = useCallback(
    async (conversationId: string, title?: string): Promise<ConversationSummary | null> => {
      if (!projectId) return null;
      const forked = await apiForkConversation(conversationId, title);
      if (forked) {
        const next = [forked, ...(sharedCache.get(projectId) || [])];
        sharedCache.set(projectId, next);
        if (currentRef.current === projectId) setList(next);
      }
      return forked;
    },
    [projectId]
  );

  return { list, loading, error, refresh, create, fork };
}

function normalizeProjectIds(
  ids: ReadonlySet<string> | string[] | null | undefined
): string[] {
  if (!ids) return [];
  if (ids instanceof Set) return Array.from(ids);
  // After the Set branch TS still widens the union; copy into a fresh
  // array so downstream .filter / .map calls see string[].
  return [...ids];
}

export interface UseOtherConversationsResult {
  /** Map of projectId → conversation list. */
  byProjectId: Record<string, ConversationSummary[]>;
  /** Force a re-fetch of every loaded project. */
  refresh: () => Promise<void>;
}

/**
 * Bulk-load conversations for a set of "other" projects (e.g.
 * sidebar entries the user has expanded but isn't currently
 * viewing). Reads from / writes to the same shared cache as
 * useConversations, so a project that becomes the active one
 * can switch over without a second fetch.
 */
export function useOtherConversations(
  projectIds: ReadonlySet<string> | string[] | null | undefined,
  excludeProjectId: string | null | undefined
): UseOtherConversationsResult {
  const [byProjectId, setByProjectId] = useState<Record<string, ConversationSummary[]>>(
    () => {
      // Seed from the shared cache so expanded-but-already-loaded
      // projects don't re-fetch on first render.
      const seed: Record<string, ConversationSummary[]> = {};
      const ids = normalizeProjectIds(projectIds);
      ids.forEach((pid) => {
        if (pid === excludeProjectId) return;
        const cached = sharedCache.get(pid);
        if (cached) seed[pid] = cached;
      });
      return seed;
    }
  );

  useEffect(() => {
    const relevant = normalizeProjectIds(projectIds).filter(
      (pid) => pid !== excludeProjectId
    );
    if (relevant.length === 0) return;
    let cancelled = false;
    Promise.all(
      relevant.map(async (pid): Promise<[string, ConversationSummary[]]> => {
        try {
          return [pid, await loadShared(pid)];
        } catch {
          // Network error for an "other" project is non-fatal —
          // the sidebar can simply show no conversations for it.
          return [pid, [] as ConversationSummary[]];
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setByProjectId((prev) => {
        // Bail out when nothing changed — cached lists are stable
        // references, so reference equality is a reliable change signal.
        // Without this, a fresh object every run re-renders the consumer;
        // with inline Set deps (tests) that re-runs the effect forever.
        let changed = false;
        const next = { ...prev };
        entries.forEach(([pid, list]) => {
          if (prev[pid] !== list) {
            next[pid] = list;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [projectIds, excludeProjectId]);

  const refresh = useCallback(async () => {
    const ids = normalizeProjectIds(projectIds).filter(
      (pid) => pid !== excludeProjectId
    );
    await Promise.all(
      ids.map(async (pid) => {
        inflight.delete(pid);
        const list = await loadShared(pid);
        setByProjectId((prev) => ({ ...prev, [pid]: list }));
        return list;
      })
    );
  }, [projectIds, excludeProjectId]);

  return { byProjectId, refresh };
}

/** Test-only helper. Clears the module-scope cache so vitest
 *  doesn't carry state between test runs. */
export function __resetConversationsCacheForTests(): void {
  sharedCache.clear();
  inflight.clear();
}