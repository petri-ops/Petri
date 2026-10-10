/**
 * useSkillStore — centralized state management for Skills discovery,
 * filtering, and execution.
 *
 * Replaces scattered local-state caches across components that called
 * `window.petriDesktop.skills.*` directly. Implements:
 * - Module-level cache with 5-minute TTL
 * - Subscriber fan-out for cross-component sync
 * - Optimistic execution updates
 * - Unified search/filter pipeline
 *
 * References:
 * - core/shared-backend/skill-registry.js — backend Skill registry
 * - core/shared-backend/skill-schema.js — Skill manifest schema
 * - frontend/src/hooks/usePluginStore.ts — adopted pattern
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBridge } from '@/lib/desktopBridge';

// ─────────────────────────────────────────────────────────────────────────────
// Type definitions — BLOCK-92 Wave B-7 外迁 ./useSkillStore/types.ts（纯搬运），
// 原导入路径保持全部 re-export：消费方（Skills 页等）import 零改动。
// ─────────────────────────────────────────────────────────────────────────────
import type {
  Skill,
  SkillExecution,
  SkillSource,
} from './useSkillStore/types';
import {
  __getProgressUnsubsSize,
  _executionsChanged,
  _startPolling,
  _stopAllPolling,
  _stopAllProgressWakeups,
  _subscribeProgressWakeup,
  _unsubscribeProgressWakeup,
} from './useSkillStore/executionMonitor';

export type {
  ExecutionStatus,
  OutputArtifact,
  ParameterSchema,
  ParameterType,
  Skill,
  SkillExecution,
} from './useSkillStore/types';
export { __getProgressUnsubsSize } from './useSkillStore/executionMonitor';
interface DiscoverResult {
  ok: boolean;
  skills?: Skill[];
  error?: string;
}

/** Result of a skill execution call. */
interface ExecuteResult {
  ok: boolean;
  executionId?: string;
  error?: string;
}

/** Snapshot held in the module-level cache. */
interface SkillStoreSnapshot {
  skills: Skill[];
  loaded: boolean;
  lastFetched: number; // timestamp
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level cache (shared across all hook instances)
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let _cache: SkillStoreSnapshot = {
  skills: [],
  loaded: false,
  lastFetched: 0,
};

let _inflight: Promise<DiscoverResult> | null = null;
const _subscribers = new Set<() => void>();

function _notify(): void {
  _subscribers.forEach((fn) => fn());
}

function _isCacheStale(): boolean {
  return Date.now() - _cache.lastFetched > CACHE_TTL_MS;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core data-fetching
// ─────────────────────────────────────────────────────────────────────────────

async function _discoverSkills(): Promise<DiscoverResult> {
  if (_inflight) return _inflight;

  const bridge = getBridge('skills');
  if (!bridge) {
    return { ok: false, error: 'skills bridge unavailable' };
  }

  let resolveInflight!: (result: DiscoverResult) => void;

  const promise = new Promise<DiscoverResult>((resolve) => {
    resolveInflight = resolve;
  });

  _inflight = promise;

  void (async () => {
    try {
      const result = await bridge.discover();
      if (result.ok && Array.isArray(result.skills)) {
        _cache = {
          skills: result.skills,
          loaded: true,
          lastFetched: Date.now(),
        };
      } else {
        _cache.loaded = true;
      }
      _notify();
      resolveInflight(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      _notify();
      resolveInflight({ ok: false, error });
    } finally {
      _inflight = null;
    }
  })();

  return promise;
}

// ─────────────────────────────────────────────────────────────────────────────
// Polling helpers for execution status
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// Public hook
// ─────────────────────────────────────────────────────────────────────────────

export interface UseSkillStoreResult {
  /** All discovered skills (unfiltered). */
  skills: Skill[];
  /** Skills after applying current filters. */
  filteredSkills: Skill[];
  /** Whether a discovery call is in-flight. */
  loading: boolean;
  /** Error message from last failed operation. */
  error: string | null;
  /** Current search query. */
  searchQuery: string;
  /** Set search query (triggers re-filter). */
  setSearchQuery: (query: string) => void;
  /** Active category filter (null = no filter). */
  categoryFilter: string | null;
  /** Set category filter. */
  setCategoryFilter: (category: string | null) => void;
  /** Active source filter (null = no filter). */
  sourceFilter: SkillSource | null;
  /** Set source filter. */
  setSourceFilter: (source: SkillSource | null) => void;
  /** All known categories from discovered skills. */
  categories: string[];
  /** All known tags from discovered skills. */
  tags: string[];
  /** Map of executionId → execution record. */
  executions: Map<string, SkillExecution>;
  /** Discover/re-discover all skills. */
  discover: () => Promise<void>;
  /** Search skills locally (complements server-side discover). */
  search: (query: string) => Promise<void>;
  /** Execute a skill by ID with given params. */
  execute: (
    skillId: string,
    params?: Record<string, unknown>
  ) => Promise<ExecuteResult>;
  /** Get a specific execution record by ID. */
  getExecution: (executionId: string) => SkillExecution | undefined;
  /** BLOCK-4 G4 顺手补：Cancel a running execution by ID. */
  cancel: (
    executionId: string
  ) => Promise<{ ok: boolean; cancelled?: boolean; error?: string }>;
  /** Invalidate cache and force reload on next use. */
  invalidateCache: () => void;
}

export function useSkillStore(
  opts: {
    /** Automatically trigger discover on mount. Defaults to true. */
    autoLoad?: boolean;
    /** Force cache refresh regardless of TTL. Defaults to false. */
    forceRefresh?: boolean;
  } = {}
): UseSkillStoreResult {
  const { autoLoad = true, forceRefresh = false } = opts;

  const [snapshot, setSnapshot] = useState<SkillStoreSnapshot>(_cache);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(
    !_cache.loaded && autoLoad
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SkillSource | null>(null);
  const [executions, setExecutions] = useState<Map<string, SkillExecution>>(
    new Map()
  );

  // Subscribe to module-level cache changes
  useEffect(() => {
    const onChange = () => {
      setSnapshot({ ..._cache });
    };
    _subscribers.add(onChange);
    return () => {
      _subscribers.delete(onChange);
    };
  }, []);

  // Initial load
  useEffect(() => {
    let cancelled = false;

    if (autoLoad && (!_cache.loaded || forceRefresh || _isCacheStale())) {
      setLoading(true);
      setError(null);
      _discoverSkills()
        .then((result) => {
          if (cancelled) return;
          if (!result.ok) setError(result.error ?? 'Discovery failed');
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
        });
    } else if (autoLoad) {
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [autoLoad, forceRefresh]);

  // Cleanup polling + progress wakeup subscriptions on unmount
  useEffect(() => {
    return () => {
      _stopAllPolling();
      _stopAllProgressWakeups();
    };
  }, []);

  // ── Derived: filtered skills ────────────────────────────────────────────────

  const filteredSkills = useMemo(() => {
    const list = snapshot.skills;
    let result = list;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    if (categoryFilter) {
      result = result.filter(
        (s) =>
          s.category === categoryFilter ||
          s.category.startsWith(categoryFilter + '/')
      );
    }

    if (sourceFilter) {
      result = result.filter((s) => s.source === sourceFilter);
    }

    return result;
  }, [snapshot.skills, searchQuery, categoryFilter, sourceFilter]);

  // ── Derived: metadata ────────────────────────────────────────────────────────

  const categories = useMemo(() => {
    const set = new Set<string>();
    snapshot.skills.forEach((s) => set.add(s.category));
    return Array.from(set).sort();
  }, [snapshot.skills]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    snapshot.skills.forEach((s) => s.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [snapshot.skills]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const discover = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await _discoverSkills();
      if (!result.ok) {
        setError(result.error ?? 'Discovery failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const search = useCallback((_query: string) => {
    // Local filtering is handled by useMemo; reserved for server-side search if/when the backend supports it.
    setSearchQuery(_query);
    return Promise.resolve();
  }, []);

  const execute = useCallback(
    async (
      skillId: string,
      params?: Record<string, unknown>
    ): Promise<ExecuteResult> => {
      const bridge = getBridge('skills');
      if (!bridge) {
        return { ok: false, error: 'skills bridge unavailable' };
      }

      // Generate optimistic execution record
      const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const optimisticExecution: SkillExecution = {
        executionId,
        skillId,
        status: 'pending',
        startedAt: new Date(),
      };

      // BLOCK-4 E2: setExecutions 内部 deep-equal 比较，避免无变化 re-render
      setExecutions((prev) => {
        const existing = prev.get(executionId);
        if (existing && !_executionsChanged(existing, optimisticExecution)) {
          return prev; // skip 跳过 re-render
        }
        const next = new Map(prev);
        next.set(executionId, optimisticExecution);
        return next;
      });

      try {
        const result = await bridge.execute(skillId, params ?? {});

        if (result.ok && result.executionId) {
          // Update with real execution ID if different
          const realId = result.executionId;
          const runningExec: SkillExecution = {
            ...optimisticExecution,
            executionId: realId,
            status: 'running',
          };
          setExecutions((prev) => {
            const next = new Map(prev);
            next.delete(executionId);
            const existing = next.get(realId);
            if (existing && !_executionsChanged(existing, runningExec)) {
              return prev;
            }
            next.set(realId, runningExec);
            return next;
          });

          // Start polling for status updates (2s polling is truth-source fallback)
          _startPolling(realId, (updated) => {
            setExecutions((prev) => {
              const existing = prev.get(realId);
              if (existing && !_executionsChanged(existing, updated)) {
                return prev;
              }
              const next = new Map(prev);
              next.set(realId, updated);
              return next;
            });
          });
          // PHASE 1 G0 UI-157：subscribe event-driven wakeup (~100ms latency)
          _subscribeProgressWakeup(realId, (updated) => {
            setExecutions((prev) => {
              const existing = prev.get(realId);
              if (existing && !_executionsChanged(existing, updated)) {
                return prev;
              }
              const next = new Map(prev);
              next.set(realId, updated);
              return next;
            });
          });

          return { ok: true, executionId: realId };
        } else {
          // Mark as failed
          const failedExec: SkillExecution = {
            ...optimisticExecution,
            status: 'failed',
            completedAt: new Date(),
            error: result.error ?? 'Execution failed',
          };
          setExecutions((prev) => {
            const existing = prev.get(executionId);
            if (existing && !_executionsChanged(existing, failedExec)) {
              return prev;
            }
            const next = new Map(prev);
            next.set(executionId, failedExec);
            return next;
          });
          return { ok: false, error: result.error };
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        const failedExec: SkillExecution = {
          ...optimisticExecution,
          status: 'failed',
          completedAt: new Date(),
          error,
        };
        setExecutions((prev) => {
          const existing = prev.get(executionId);
          if (existing && !_executionsChanged(existing, failedExec)) {
            return prev;
          }
          const next = new Map(prev);
          next.set(executionId, failedExec);
          return next;
        });
        return { ok: false, error };
      }
    },
    []
  );

  const getExecution = useCallback(
    (executionId: string): SkillExecution | undefined => {
      return executions.get(executionId);
    },
    [executions]
  );

  // BLOCK-4 G4 顺手补：store 内部 cancel action（PHASE 6 G4 报告"无 store.cancel() action"）
  const cancel = useCallback(
    async (executionId: string): Promise<{ ok: boolean; cancelled?: boolean; error?: string }> => {
      const bridge = getBridge('skills');
      if (!bridge || typeof bridge.cancel !== 'function') {
        return { ok: false, error: 'skills bridge unavailable' };
      }
      try {
        const result = await bridge.cancel(executionId);
        // 成功 cancel 同步清本地 wakeup 订阅（防止后续 progress 事件还写入 store）
        if (result.ok && result.cancelled !== false) {
          _unsubscribeProgressWakeup(executionId);
        }
        return result;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[useSkillStore] cancel failed:', error);
        }
        return { ok: false, error };
      }
    },
    []
  );

  const invalidateCache = useCallback(() => {
    _cache = { skills: [], loaded: false, lastFetched: 0 };
    _notify();
  }, []);

  return {
    skills: snapshot.skills,
    filteredSkills,
    loading,
    error,
    searchQuery,
    setSearchQuery,
    categoryFilter,
    setCategoryFilter,
    sourceFilter,
    setSourceFilter,
    categories,
    tags,
    executions,
    discover,
    search,
    execute,
    getExecution,
    cancel,
    invalidateCache,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test-only helpers
// ─────────────────────────────────────────────────────────────────────────────

// BLOCK-4 PHASE 2 G5: Test-only selector exposing the module-level
// `_progressUnsubs` Map size, used to assert that the useEffect cleanup
// in useSkillStore clears all wakeup subscriptions on unmount. Internal
// module state stays private; this getter is the only test-facing surface.

export function __resetSkillStoreCacheForTests(): void {
  _cache = { skills: [], loaded: false, lastFetched: 0 };
  _inflight = null;
  _subscribers.clear();
  _stopAllPolling();
  _stopAllProgressWakeups();
}
