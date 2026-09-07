// ============================================================
// resultBridge 拆包契约回归（UI-311）
//
// result:* handler 统一返回 fail-closed 信封 { ok, data?, error? }，
// 本桥是唯一拆包点。回归锁定：信封进 → 裸值出；此前信封被原样透传，
// /project/:id/results 首次加载即 snapshot.results.map is not a function。
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result, ResultSummary, ResultVersion } from '@/types/result.types';

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

const VERSION_FIXTURE: ResultVersion = {
  id: 'v1',
  resultId: 'r1',
  version: 1,
  data: { points: 12 },
  createdAt: 150,
  createdByBranchId: null,
};

type Envelope = { ok: boolean; data?: unknown; error?: string };

function stubBridge(methods: Record<string, unknown>): void {
  (window as unknown as Record<string, unknown>).gewu = { result: methods };
}

async function loadResultApi() {
  vi.resetModules();
  const mod = await import('@/lib/resultBridge');
  return mod.resultApi;
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

describe('resultBridge envelope unwrap (UI-311)', () => {
  it('byProject：信封拆包返回裸数组（崩溃回归锁定）', async () => {
    const byProject = vi.fn(async (): Promise<Envelope> => ({
      ok: true,
      data: [RESULT_FIXTURE],
    }));
    stubBridge({
      byProject,
      list: vi.fn(async (): Promise<Envelope> => ({ ok: true, data: [] })),
    });
    const api = await loadResultApi();
    const results = await api.byProject('p1');
    expect(Array.isArray(results)).toBe(true);
    expect(results).toEqual([RESULT_FIXTURE]);
    expect(byProject).toHaveBeenCalledWith({ projectId: 'p1', options: undefined });
  });

  it('list：信封拆包返回裸数组', async () => {
    stubBridge({
      byProject: vi.fn(async (): Promise<Envelope> => ({ ok: true, data: [] })),
      list: vi.fn(async (): Promise<Envelope> => ({
        ok: true,
        data: [SUMMARY_FIXTURE],
      })),
    });
    const api = await loadResultApi();
    const summaries = await api.list('p1');
    expect(summaries).toEqual([SUMMARY_FIXTURE]);
  });

  it('get：ok → data；not found → null；其他错误 → throw', async () => {
    stubBridge({
      get: vi.fn(async (): Promise<Envelope> => ({ ok: true, data: RESULT_FIXTURE })),
    });
    const api = await loadResultApi();
    await expect(api.get('r1')).resolves.toEqual(RESULT_FIXTURE);

    stubBridge({
      get: vi.fn(async (): Promise<Envelope> => ({
        ok: false,
        error: 'Result not found',
      })),
    });
    const api2 = await loadResultApi();
    await expect(api2.get('missing')).resolves.toBeNull();

    stubBridge({
      get: vi.fn(async (): Promise<Envelope> => ({
        ok: false,
        error: 'boom',
      })),
    });
    const api3 = await loadResultApi();
    await expect(api3.get('r1')).rejects.toThrow('boom');
  });

  it('create/update/version.list/createFromConversation：统一拆包', async () => {
    stubBridge({
      create: vi.fn(async (): Promise<Envelope> => ({ ok: true, data: RESULT_FIXTURE })),
      update: vi.fn(async (): Promise<Envelope> => ({ ok: true, data: RESULT_FIXTURE })),
      createFromConversation: vi.fn(async (): Promise<Envelope> => ({
        ok: true,
        data: RESULT_FIXTURE,
      })),
      version: {
        create: vi.fn(async (): Promise<Envelope> => ({ ok: true, data: VERSION_FIXTURE })),
        get: vi.fn(async (): Promise<Envelope> => ({ ok: true, data: VERSION_FIXTURE })),
        getByNumber: vi.fn(async (): Promise<Envelope> => ({ ok: true, data: VERSION_FIXTURE })),
        list: vi.fn(async (): Promise<Envelope> => ({ ok: true, data: [VERSION_FIXTURE] })),
      },
    });
    const api = await loadResultApi();
    await expect(api.create('p1', 'chart', 'n', {})).resolves.toEqual(RESULT_FIXTURE);
    await expect(api.update('r1', { name: 'x' })).resolves.toEqual(RESULT_FIXTURE);
    await expect(api.createFromConversation('p1', 'b1')).resolves.toEqual(RESULT_FIXTURE);
    await expect(api.version.list('r1')).resolves.toEqual([VERSION_FIXTURE]);
  });

  it('error 信封：抛出 handler 错误信息（store 侧进 error 态）', async () => {
    stubBridge({
      byProject: vi.fn(async (): Promise<Envelope> => ({
        ok: false,
        error: 'db closed',
      })),
      list: vi.fn(async (): Promise<Envelope> => ({ ok: true, data: [] })),
    });
    const api = await loadResultApi();
    await expect(api.byProject('p1')).rejects.toThrow('db closed');
  });

  it('桥不可用：兜底空值语义不抛错（list/byProject → []，get → null）', async () => {
    const api = await loadResultApi();
    await expect(api.byProject('p1')).resolves.toEqual([]);
    await expect(api.list('p1')).resolves.toEqual([]);
    await expect(api.get('r1')).resolves.toBeNull();
  });
});
