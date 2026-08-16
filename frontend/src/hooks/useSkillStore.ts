/**
 * useSkillStore — centralized state management for Skills discovery,
 * filtering, and execution.
 *
 * Replaces scattered local-state caches across components that called
 * `window.biof3Desktop.skills.*` directly. Implements:
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
// Type definitions
// ─────────────────────────────────────────────────────────────────────────────

/** Parameter type supported by Skill manifests. */
export type ParameterType = 'select' | 'number' | 'string' | 'boolean' | 'file';

/** Schema definition for an optional parameter. */
export interface ParameterSchema {
  type: ParameterType;
  description: string;
  options?: string[];
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  accept?: string;
  pattern?: string;
}

/** Output artifact definition. */
export interface OutputArtifact {
  id: string;
  type: string; // relaxed to allow backend to return string literals
  label: string;
  description?: string;
  format?: string;
  columns?: string[];
  dpi?: number;
  requires_plugin?: string;
}

/** Skill source priority (mirrors backend SOURCE_PRIORITY). */
export type SkillSource = 'built-in' | 'installed' | 'marketplace';

/** A single Skill entry. */
export interface Skill {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  source: SkillSource;
  tags: string[];
  capabilities?: string[];
  parameters: {
    required: string[];
    optional: Record<string, ParameterSchema>;
  };
  plugins: {
    required: string[];
    optional: string[];
  };
  workflows?: {
    default: string | null;
    variants: string[];
  };
  prompts?: {
    system?: string;
    system_file?: string;
    user_templates?: string[];
  };
  recoveryStrategies?: Array<{
    when: string;
    description?: string;
    do: string;
    fallback: string;
    recoverable: boolean;
  }>;
  outputs?: {
    primary: OutputArtifact[];
    secondary: OutputArtifact[];
  };
  metadata?: {
    author?: string;
    license?: string;
    source?: string;
    created?: string;
    updated?: string;
    compatibility?: {
      min_app_version?: string;
      platform?: string[];
    };
  };
}

/** Execution status for a Skill run. */
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed';

/** A single Skill execution record. */
export interface SkillExecution {
  executionId: string;
  skillId: string;
  status: ExecutionStatus;
  startedAt?: Date;
  completedAt?: Date;
  result?: unknown;
  error?: string;
}

/** Result of a skill discovery call. */
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
let _pollIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

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
  let rejectInflight!: (err: unknown) => void;

  const promise = new Promise<DiscoverResult>((resolve, reject) => {
    resolveInflight = resolve;
    rejectInflight = reject;
  });

  _inflight = promise;

  (async () => {
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

function _startPolling(
  executionId: string,
  onUpdate: (execution: SkillExecution) => void
): void {
  if (_pollIntervals.has(executionId)) return;

  const interval = setInterval(async () => {
    const bridge = getBridge('skills');
    if (!bridge) {
      clearInterval(interval);
      _pollIntervals.delete(executionId);
      return;
    }

    try {
      const result = await bridge.getExecution(executionId);
      if (result.ok && result.execution) {
        const exec: SkillExecution = {
          executionId: result.execution.executionId,
          skillId: result.execution.skillId,
          status: result.execution.status,
          startedAt: result.execution.startedAt
            ? new Date(result.execution.startedAt)
            : undefined,
          completedAt: result.execution.completedAt
            ? new Date(result.execution.completedAt)
            : undefined,
          result: result.execution.result,
          error: result.execution.error,
        };
        onUpdate(exec);

        // Stop polling on terminal state
        if (
          exec.status === 'completed' ||
          exec.status === 'failed'
        ) {
          clearInterval(interval);
          _pollIntervals.delete(executionId);
          // BLOCK-3 P2 A1: 终态同步清 onProgress 订阅，避免多 execution 切换后
          // 残留 wakeup callback 继续接收 progress 事件触发重复 IPC。
          _unsubscribeProgressWakeup(executionId);
        }
      }
    } catch {
      clearInterval(interval);
      _pollIntervals.delete(executionId);
      // BLOCK-3 P2 A1: 异常路径同样清 onProgress 订阅
      _unsubscribeProgressWakeup(executionId);
    }
  }, 2000);

  _pollIntervals.set(executionId, interval);
}

function _stopAllPolling(): void {
  _pollIntervals.forEach((interval) => clearInterval(interval));
  _pollIntervals.clear();
}

// PHASE 1 G0 UI-157：event-driven wakeup（取代单纯 2s polling）。
// 订阅主进程 webContents.send('skills:progress') 推送，过滤到当前
// executionId 时立即调一次 bridge.getExecution() 拉完整 snapshot。
// 与 _startPolling 并行运行（polling 2s 是真值兜底，wakeup 把感知延迟从
// ≤2s 降到 ≤100ms；终态时清理订阅避免泄漏）。
const _progressUnsubs: Map<string, () => void> = new Map();

function _subscribeProgressWakeup(
  executionId: string,
  onUpdate: (execution: SkillExecution) => void
): void {
  if (_progressUnsubs.has(executionId)) return;
  const bridge = getBridge('skills');
  if (!bridge || typeof bridge.onProgress !== 'function') return;
  const unsubscribe = bridge.onProgress((payload: { executionId?: string }) => {
    if (payload?.executionId !== executionId) return;
    void (async () => {
      try {
        const result = await bridge.getExecution(executionId);
        if (result.ok && result.execution) {
          onUpdate({
            executionId: result.execution.executionId,
            skillId: result.execution.skillId,
            status: result.execution.status,
            startedAt: result.execution.startedAt
              ? new Date(result.execution.startedAt)
              : undefined,
            completedAt: result.execution.completedAt
              ? new Date(result.execution.completedAt)
              : undefined,
            result: result.execution.result,
            error: result.execution.error,
          });
        }
      } catch {
        /* 静默兜底：polling 仍会按 2s 节奏兜底真值 */
      }
    })();
  });
  _progressUnsubs.set(executionId, unsubscribe);
}

function _unsubscribeProgressWakeup(executionId: string): void {
  const unsub = _progressUnsubs.get(executionId);
  if (unsub) {
    unsub();
    _progressUnsubs.delete(executionId);
  }
}

function _stopAllProgressWakeups(): void {
  _progressUnsubs.forEach((unsub) => unsub());
  _progressUnsubs.clear();
}

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

  const search = useCallback(async (_query: string) => {
    // Local filtering is handled by useMemo; this method is reserved
    // for server-side search if/when the backend supports it.
    setSearchQuery(_query);
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

      setExecutions((prev) => {
        const next = new Map(prev);
        next.set(executionId, optimisticExecution);
        return next;
      });

      try {
        const result = await bridge.execute(skillId, params ?? {});

        if (result.ok && result.executionId) {
          // Update with real execution ID if different
          const realId = result.executionId;
          setExecutions((prev) => {
            const next = new Map(prev);
            next.delete(executionId);
            next.set(realId, {
              ...optimisticExecution,
              executionId: realId,
              status: 'running',
            });
            return next;
          });

          // Start polling for status updates (2s polling is truth-source fallback)
          _startPolling(realId, (updated) => {
            setExecutions((prev) => {
              const next = new Map(prev);
              next.set(realId, updated);
              return next;
            });
          });
          // PHASE 1 G0 UI-157：subscribe event-driven wakeup (~100ms latency)
          _subscribeProgressWakeup(realId, (updated) => {
            setExecutions((prev) => {
              const next = new Map(prev);
              next.set(realId, updated);
              return next;
            });
          });

          return { ok: true, executionId: realId };
        } else {
          // Mark as failed
          setExecutions((prev) => {
            const next = new Map(prev);
            next.set(executionId, {
              ...optimisticExecution,
              status: 'failed',
              completedAt: new Date(),
              error: result.error ?? 'Execution failed',
            });
            return next;
          });
          return { ok: false, error: result.error };
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        setExecutions((prev) => {
          const next = new Map(prev);
          next.set(executionId, {
            ...optimisticExecution,
            status: 'failed',
            completedAt: new Date(),
            error,
          });
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
    invalidateCache,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test-only helpers
// ─────────────────────────────────────────────────────────────────────────────

export function __resetSkillStoreCacheForTests(): void {
  _cache = { skills: [], loaded: false, lastFetched: 0 };
  _inflight = null;
  _subscribers.clear();
  _stopAllPolling();
  _stopAllProgressWakeups();
}
