// ============================================================
// useResultStore 回归（UI-311）
//
// result:* IPC 信封契约漂移曾让 cache.results 变成 { ok, data } 信封对象，
// 渲染期 snapshot.results.map 直接抛错、整棵 React 树卸载（/results 白屏）。
// 回归锁定：信封桥接下 hook 必须产出裸数组。
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { Result, ResultSummary } from '@/types/result.types';

const RESULT_FIXTURE: Result = {
  id: 'r1',
  projectId: 'p1',
  type: 'chart',
  name: 'volcano',
  data: { points: 12 },
  config: {},
  sourceBranchId: null,
  createdAt: 100,
  updatedAt: 200,
};

const SUMMARY_FIXTURE: ResultSummary = {
  id: 'r1',
  projectId: 'p1',
  type: 'chart',
  name: 'volcano',
  sourceBranchId: null,
  updatedAt: 200,
};

type Envelope = { ok: boolean; data?: unknown; error?: string };

function stubBridge(overrides: Record<string, unknown> = {}): void {
  (window as unknown as Record<string, unknown>).gewu = {
    result: {
      byProject: vi.fn(async (): Promise<Envelope> => ({
        ok: true,
        data: [RESULT_FIXTURE],
      })),
      list: vi.fn(async (): Promise<Envelope> => ({
        ok: true,
        data: [SUMMARY_FIXTURE],
      })),
      create: vi.fn(async (): Promise<Envelope> => ({ ok: true, data: RESULT_FIXTURE })),
      update: vi.fn(async (): Promise<Envelope> => ({ ok: true, data: RESULT_FIXTURE })),
      delete: vi.fn(async (): Promise<Envelope> => ({ ok: true })),
      version: {
        list: vi.fn(async (): Promise<Envelope> => ({ ok: true, data: [] })),
      },
      ...overrides,
    },
  };
}

async function loadUseResultStore() {
  vi.resetModules();
  const mod = await import('@/hooks/useResultStore');
  return mod.useResultStore as typeof import('@/hooks/useResultStore').useResultStore;
}

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>).gewu;
  delete (window as unknown as Record<string, unknown>).biof3Desktop;
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).gewu;
  delete (window as unknown as Record<string, unknown>).biof3Desktop;
  vi.restoreAllMocks();
});

describe('useResultStore envelope regression (UI-311)', () => {
  it('加载后 results/summaries 为裸数组，resultsById 可建（原崩溃点）', async () => {
    stubBridge();
    const useResultStore = await loadUseResultStore();
    const { result } = renderHook(() => useResultStore('p1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    // 原崩溃点：snapshot.results 为信封对象时，resultsById 的 .map 渲染期抛错
    expect(Array.isArray(result.current.results)).toBe(true);
    expect(result.current.results).toEqual([RESULT_FIXTURE]);
    expect(Array.isArray(result.current.summaries)).toBe(true);
    expect(result.current.summaries).toEqual([SUMMARY_FIXTURE]);
    expect(result.current.resultsById.get('r1')).toEqual(RESULT_FIXTURE);
  });

  it('handler 错误信封 → error 态 + results 保持空数组（不崩）', async () => {
    stubBridge({
      byProject: vi.fn(async (): Promise<Envelope> => ({
        ok: false,
        error: 'db closed',
      })),
    });
    const useResultStore = await loadUseResultStore();
    const { result } = renderHook(() => useResultStore('p1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('db closed');
    expect(result.current.results).toEqual([]);
  });

  it('projectId 为 null → 空快照且不发起加载', async () => {
    const byProject = vi.fn(async (): Promise<Envelope> => ({ ok: true, data: [] }));
    stubBridge({ byProject });
    const useResultStore = await loadUseResultStore();
    const { result } = renderHook(() => useResultStore(null));

    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
    // 微任务排空后仍不应有调用
    await Promise.resolve();
    expect(byProject).not.toHaveBeenCalled();
  });
});
