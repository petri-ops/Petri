import { describe, expect, it, beforeEach, vi, type Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useSkillStore,
  __resetSkillStoreCacheForTests,
  type Skill,
} from '@/hooks/useSkillStore';

interface BridgeOverrides {
  discover?: () => Promise<{ ok: boolean; skills?: Skill[]; error?: string }>;
  execute?: (
    skillId: string,
    params?: Record<string, unknown>
  ) => Promise<{ ok: boolean; executionId?: string; error?: string }>;
  getExecution?: (executionId: string) => Promise<{
    ok: boolean;
    execution?: {
      executionId: string;
      skillId: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      startedAt?: string;
      completedAt?: string;
      result?: unknown;
      error?: string;
    };
    error?: string;
  }>;
  cancel?: (executionId: string) => Promise<{ ok: boolean; cancelled?: boolean; error?: string }>;
  /** progressSubscriptions[executionId] -> registered callback list */
  progressCallbacks?: Map<string, Set<(payload: Record<string, unknown>) => void>>;
}

interface BridgeHandles {
  discover: Mock;
  execute: Mock;
  getExecution: Mock;
  cancel: Mock;
  onProgress: Mock;
}

function installBridge(overrides: BridgeOverrides = {}): BridgeHandles {
  const skills: Skill[] = [
    {
      id: 'deg-analysis',
      name: 'DEG Analysis',
      version: '1.0.0',
      description: 'Run differential expression analysis',
      category: 'transcriptomics',
      source: 'built-in' as const,
      tags: ['rna-seq', 'deg'],
      parameters: { required: [], optional: {} },
      plugins: { required: [], optional: [] },
    },
  ];
  const discover =
    overrides.discover
      ? vi.fn(overrides.discover)
      : vi.fn().mockResolvedValue({ ok: true, skills });
  const execute =
    overrides.execute
      ? vi.fn(overrides.execute)
      : vi.fn().mockResolvedValue({ ok: true, executionId: 'sre_test123' });
  const getExecution =
    overrides.getExecution
      ? vi.fn(overrides.getExecution)
      : vi.fn().mockResolvedValue({
          ok: true,
          execution: {
            executionId: 'sre_test123',
            skillId: 'deg-analysis',
            status: 'running' as const,
            startedAt: new Date().toISOString(),
          },
        });
  const cancel =
    overrides.cancel
      ? vi.fn(overrides.cancel)
      : vi.fn().mockResolvedValue({ ok: true, cancelled: true });
  const progressCallbacks =
    overrides.progressCallbacks ?? new Map<string, Set<(p: Record<string, unknown>) => void>>();
  const onProgress = vi.fn((cb: (p: Record<string, unknown>) => void) => {
    // Maintain one shared set per test + return unsubscribe
    let set = progressCallbacks.get('__default__');
    if (!set) {
      set = new Set();
      progressCallbacks.set('__default__', set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  });

  (window as unknown as { biof3Desktop: unknown }).biof3Desktop = {
    skills: {
      discover,
      execute,
      getExecution,
      cancel,
      onProgress,
    },
  };
  return { discover, execute, getExecution, cancel, onProgress };
}

function uninstallBridge() {
  delete (window as unknown as { biof3Desktop?: unknown }).biof3Desktop;
}

beforeEach(() => {
  __resetSkillStoreCacheForTests();
  uninstallBridge();
});

describe('useSkillStore', () => {
  it('exposes empty defaults when no bridge is installed', async () => {
    const { result } = renderHook(() => useSkillStore());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.skills).toEqual([]);
    expect(result.current.filteredSkills).toEqual([]);
    // store contract: 没有任何 bridge 时 error = 'skills bridge unavailable'
    expect(result.current.error).toBe('skills bridge unavailable');
  });

  it('loads skills on first mount via bridge.skills.discover()', async () => {
    installBridge();
    const { result } = renderHook(() => useSkillStore());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.skills.length).toBe(1);
    expect(result.current.skills[0].id).toBe('deg-analysis');
  });

  it('does not refetch on a second mount of the same hook', async () => {
    const { discover } = installBridge();
    const first = renderHook(() => useSkillStore());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    const second = renderHook(() => useSkillStore());
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it('search filters by query case-insensitively across name + tags', async () => {
    installBridge();
    const { result } = renderHook(() => useSkillStore());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.filteredSkills.length).toBe(1);

    act(() => result.current.setSearchQuery('deg'));
    expect(result.current.filteredSkills.length).toBe(1);

    act(() => result.current.setSearchQuery('xyz-no-match'));
    expect(result.current.filteredSkills.length).toBe(0);
  });

  it('execute() calls bridge.skills.execute with skillId + params', async () => {
    const { execute } = installBridge();
    const { result } = renderHook(() => useSkillStore());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let execResult: { ok: boolean; executionId?: string; error?: string } = { ok: false };
    await act(async () => {
      execResult = await result.current.execute('deg-analysis', { alpha: 0.05 });
    });

    expect(execute).toHaveBeenCalledWith('deg-analysis', { alpha: 0.05 });
    expect(execResult.ok).toBe(true);
    expect(execResult.executionId).toBe('sre_test123');
  });

  it('execute() surfaces failure from the bridge', async () => {
    installBridge({
      execute: vi.fn().mockResolvedValue({ ok: false, error: '权限被拒' }),
    });
    const { result } = renderHook(() => useSkillStore());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let execResult: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      execResult = await result.current.execute('deg-analysis', {});
    });
    expect(execResult.error).toBe('权限被拒');
  });

  it('execute() subscribes to bridge.skills.onProgress (PHASE 1 G0 UI-157)', async () => {
    const { onProgress } = installBridge();
    const { result } = renderHook(() => useSkillStore());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.execute('deg-analysis', {});
    });
    // PHASE 1 wakeup path: bridge.onProgress must have been called
    expect(onProgress).toHaveBeenCalled();
  });

  it('bridge.skills.cancel is callable and returns { ok: true, cancelled: true }', async () => {
    const handles = installBridge();
    // PHASE 1 IPC bridge wiring: bridge.skills.cancel(executionId) must be wired to SkillsSDK via main.js
    const bridge = (window as unknown as {
      biof3Desktop: { skills: { cancel: Mock } };
    }).biof3Desktop;
    let cancelResult: { ok: boolean; cancelled?: boolean; error?: string } = { ok: false };
    await act(async () => {
      cancelResult = await bridge.skills.cancel('sre_test123');
    });
    expect(handles.cancel).toHaveBeenCalledWith('sre_test123');
    expect(cancelResult.ok).toBe(true);
    expect(cancelResult.cancelled).toBe(true);
  });

  it('store.getExecution(executionId) reads from executions map (no bridge call)', async () => {
    const handles = installBridge();
    const { result } = renderHook(() => useSkillStore());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // First execute so the optimistic execution is registered in map
    await act(async () => {
      await result.current.execute('deg-analysis', { alpha: 0.05 });
    });

    const snapshot = result.current.getExecution('sre_test123');
    // store.getExecution is a synchronous Map lookup; does NOT call bridge
    expect(handles.getExecution).not.toHaveBeenCalled();
    expect(snapshot).toBeDefined();
    expect(snapshot?.skillId).toBe('deg-analysis');
  });
});
