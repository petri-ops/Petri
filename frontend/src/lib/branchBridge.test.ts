// ============================================================
// branchBridge 拆包 + 行映射契约回归（UI-P2-001）
//
// branch:* handler 统一返回 fail-closed 信封 { ok, data?, error? }，
// 落库行为 snake_case（src/database/branch-db.js 原样返回），本桥是
// 唯一拆包 + snake→camel 映射点。回归锁定：
//  1) 此前信封被原样透传，/project/:id/results 首次加载即把信封当
//     数组用（branches.find is not a function），分支 tab 永不渲染；
//  2) switch 缺 projectId、delete/rename 参数键 branchId≠id，
//     UI 切分支恒被 handler 以 "branchId and projectId are required" 拒绝。
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Branch } from '@/types/branch.types';

const ROW_FIXTURE = {
  id: 'b1',
  project_id: 'p1',
  name: 'main',
  parent_branch_id: null,
  created_at: 100,
  updated_at: 200,
  is_active: 1,
};

const BRANCH_FIXTURE: Branch = {
  id: 'b1',
  projectId: 'p1',
  name: 'main',
  parentBranchId: null,
  createdAt: 100,
  updatedAt: 200,
  isActive: true,
};

type Envelope = { ok: boolean; data?: unknown; error?: string };

function stubBridge(methods: Record<string, unknown>): void {
  (window as unknown as Record<string, unknown>).petri = { branch: methods };
}

async function loadBranchApi() {
  vi.resetModules();
  const mod = await import('@/lib/branchBridge');
  return mod.branchApi;
}

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>).petri;
  delete (window as unknown as Record<string, unknown>).petriDesktop;
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).petri;
  delete (window as unknown as Record<string, unknown>).petriDesktop;
  vi.restoreAllMocks();
});

describe('branchBridge envelope unwrap + row mapping (UI-P2-001)', () => {
  it('list：信封拆包 + snake→camel 映射返回裸 Branch 数组（崩溃回归锁定）', async () => {
    const list = vi.fn(async (): Promise<Envelope> => ({
      ok: true,
      data: [ROW_FIXTURE],
    }));
    stubBridge({ list });
    const api = await loadBranchApi();
    const branches = await api.list('p1');
    expect(Array.isArray(branches)).toBe(true);
    expect(branches).toEqual([BRANCH_FIXTURE]);
    expect(list).toHaveBeenCalledWith({ projectId: 'p1' });
  });

  it('create：信封拆包返回裸 Branch；isActive 数字 0/1 → false/true', async () => {
    stubBridge({
      create: vi.fn(async (): Promise<Envelope> => ({
        ok: true,
        data: { ...ROW_FIXTURE, is_active: 0 },
      })),
    });
    const api = await loadBranchApi();
    const created = await api.create('p1', 'feature-x');
    expect(created.isActive).toBe(false);
    expect(created.projectId).toBe('p1');
    expect(created.parentBranchId).toBeNull();
  });

  it('switch：参数键 { branchId, projectId }（handler 契约），返回映射后 Branch', async () => {
    const sw = vi.fn(async (): Promise<Envelope> => ({ ok: true, data: ROW_FIXTURE }));
    stubBridge({ switch: sw });
    const api = await loadBranchApi();
    const active = await api.switch('b1', 'p1');
    expect(sw).toHaveBeenCalledWith({ branchId: 'b1', projectId: 'p1' });
    expect(active).toEqual(BRANCH_FIXTURE);
  });

  it('delete/rename：参数键为 id（非 branchId），按 handler 契约传参', async () => {
    const del = vi.fn(async (): Promise<Envelope> => ({ ok: true }));
    const rename = vi.fn(async (): Promise<Envelope> => ({ ok: true, data: ROW_FIXTURE }));
    stubBridge({ delete: del, rename });
    const api = await loadBranchApi();
    await expect(api.delete('b1')).resolves.toBeUndefined();
    await expect(api.rename('b1', 'renamed')).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledWith({ id: 'b1' });
    expect(rename).toHaveBeenCalledWith({ id: 'b1', newName: 'renamed' });
  });

  it('getActive：data null → null（项目尚无分支）', async () => {
    stubBridge({
      getActive: vi.fn(async (): Promise<Envelope> => ({ ok: true, data: null })),
    });
    const api = await loadBranchApi();
    await expect(api.getActive('p1')).resolves.toBeNull();
  });

  it('error 信封：抛出 handler 错误信息（store 侧进 error 态）', async () => {
    stubBridge({
      list: vi.fn(async (): Promise<Envelope> => ({ ok: false, error: 'db closed' })),
    });
    const api = await loadBranchApi();
    await expect(api.list('p1')).rejects.toThrow('db closed');
  });

  it('switch error 信封：UI 切分支失败不再被静默吞掉', async () => {
    stubBridge({
      switch: vi.fn(async (): Promise<Envelope> => ({
        ok: false,
        error: 'branchId and projectId are required',
      })),
    });
    const api = await loadBranchApi();
    await expect(api.switch('b1', 'p1')).rejects.toThrow(
      'branchId and projectId are required'
    );
  });

  it('桥不可用：兜底空值语义不抛错（list → []，getActive → null）', async () => {
    const api = await loadBranchApi();
    await expect(api.list('p1')).resolves.toEqual([]);
    await expect(api.getActive('p1')).resolves.toBeNull();
  });
});
