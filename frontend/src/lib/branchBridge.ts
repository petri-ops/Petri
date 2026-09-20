// ============================================================
// branchBridge — IPC wrapper for branch operations
//
// Wraps Electron IPC calls to the main process branch API.
// Uses the typed bridge accessor from desktopBridge.ts.
//
// UI-P2-001 — branch:* handler 统一返回 fail-closed 信封 { ok, data?, error? }
// （与 result:* 的 UI-311 同型），本桥是 branch 命名空间的唯一拆包 + 行映射点：
// handler 落库行是 snake_case（project_id / is_active / created_at …），
// 消费方（useBranchStore / ResultStudioPage）见裸 camelCase Branch 契约。
// 此前无人拆包，/project/:id/results 首次加载即把信封当数组用
// （branches.find is not a function），分支 tab 永不渲染；且 switch/delete/
// rename 的参数键与 handler 契约不符（缺 projectId / branchId≠id），
// UI 切分支恒被 handler 以 "branchId and projectId are required" 拒绝。
// ============================================================

import { getBridge } from '@/lib/desktopBridge';
import type { Branch } from '@/types/branch.types';

interface BranchIpcEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** branch:* handler 的落库行（snake_case SQLite 列，见 src/database/branch-db.js）。 */
interface BranchRow {
  id: string;
  project_id: string;
  name: string;
  parent_branch_id: string | null;
  created_at: number;
  updated_at: number;
  is_active: number | boolean;
}

/** ok=true → data；否则抛 handler 错误信息（store 捕获后进 error 态）。 */
async function unwrap<T>(call: Promise<BranchIpcEnvelope<T>>): Promise<T> {
  const envelope = await call;
  if (!envelope || envelope.ok !== true) {
    throw new Error(envelope?.error || 'Branch bridge error');
  }
  return envelope.data as T;
}

/** snake_case 落库行 → 前端 camelCase Branch 契约（types/branch.types.ts）。 */
function toBranch(row: BranchRow | null | undefined): Branch | null {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    parentBranchId: row.parent_branch_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isActive: Boolean(row.is_active),
  };
}

function createBranchBridge(): {
  create: (projectId: string, name: string, parentBranchId?: string) => Promise<Branch>;
  list: (projectId: string) => Promise<Branch[]>;
  switch: (branchId: string, projectId: string) => Promise<Branch | null>;
  delete: (branchId: string) => Promise<void>;
  rename: (branchId: string, newName: string) => Promise<void>;
  getActive: (projectId: string) => Promise<Branch | null>;
} {
  const bridge = getBridge('branch');

  if (!bridge) {
    // Stub implementation when branch bridge is not available
    return {
      create: async () => {
        throw new Error('Branch bridge not available');
      },
      list: async () => [],
      switch: async () => {
        throw new Error('Branch bridge not available');
      },
      delete: async () => {
        throw new Error('Branch bridge not available');
      },
      rename: async () => {
        throw new Error('Branch bridge not available');
      },
      getActive: async () => null,
    };
  }

  return {
    create: async (projectId, name, parentBranchId) => {
      const row = await unwrap<BranchRow>(
        bridge.create({ projectId, name, parentBranchId })
      );
      return toBranch(row) as Branch;
    },

    list: async (projectId) => {
      const rows = await unwrap<BranchRow[]>(
        bridge.list({ projectId })
      );
      return (rows || []).map(toBranch).filter((b): b is Branch => b !== null);
    },

    switch: async (branchId, projectId) => {
      const row = await unwrap<BranchRow>(
        bridge.switch({ branchId, projectId })
      );
      return toBranch(row);
    },

    delete: async (branchId) => {
      // handler 契约参数键是 id（src/ipc/branch-handlers.js branch:delete）
      await unwrap(bridge.delete({ id: branchId }) as Promise<BranchIpcEnvelope<undefined>>);
    },

    rename: async (branchId, newName) => {
      // handler 契约参数键是 id + newName（branch:rename）
      await unwrap(
        bridge.rename({ id: branchId, newName }) as Promise<BranchIpcEnvelope<BranchRow>>
      );
    },

    getActive: async (projectId) => {
      const row = await unwrap<BranchRow | null>(
        bridge.getActive({ projectId })
      );
      return toBranch(row);
    },
  };
}

export const branchApi = createBranchBridge();
