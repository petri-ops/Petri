// ============================================================
// resultBridge — IPC wrapper for result operations
//
// Phase 2: Project-scoped results shared across branches
// Uses the typed bridge accessor from desktopBridge.ts.
//
// UI-311 — result:* handler 统一返回 fail-closed 信封 { ok, data?, error? }
// （electron.d.ts 如实声明），本桥是 result 命名空间的唯一拆包点：消费方
// （useResultStore / ResultVersionHistory）仍见裸值契约。此前无人拆包，
// /project/:id/results 首次加载即把信封当数组用（snapshot.results.map is
// not a function）整页崩溃。
// ============================================================

import { getBridge } from '@/lib/desktopBridge';
import type { Result, ResultSummary, ResultVersion, ListResultsOptions } from '@/types/result.types';

interface ResultIpcEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** ok=true → data；否则抛 handler 错误信息（store 捕获后进 error 态）。 */
async function unwrap<T>(call: Promise<ResultIpcEnvelope<T>>): Promise<T> {
  const envelope = await call;
  if (!envelope || envelope.ok !== true) {
    throw new Error(envelope?.error || 'Result bridge error');
  }
  return envelope.data as T;
}

/** 同 unwrap，但 handler 明确报「not found」时按契约落 null（get 类方法）。 */
async function unwrapNullable<T>(call: Promise<ResultIpcEnvelope<T | null>>): Promise<T | null> {
  const envelope = await call;
  if (envelope && envelope.ok) return (envelope.data ?? null);
  if (envelope && /not found/i.test(String(envelope.error))) return null;
  throw new Error(envelope?.error || 'Result bridge error');
}

export interface ResultApi {
  create: (
    projectId: string,
    type: Result['type'],
    name: string,
    data: unknown,
    config?: Record<string, unknown>,
    sourceBranchId?: string
  ) => Promise<Result>;
  get: (id: string) => Promise<Result | null>;
  list: (projectId: string, options?: ListResultsOptions) => Promise<ResultSummary[]>;
  update: (
    id: string,
    updates: { name?: string; data?: unknown; config?: Record<string, unknown> }
  ) => Promise<Result | null>;
  delete: (id: string) => Promise<void>;
  byProject: (
    projectId: string,
    options?: { type?: Result['type']; limit?: number; offset?: number }
  ) => Promise<Result[]>;
  version: {
    create: (
      resultId: string,
      data: unknown,
      config?: Record<string, unknown>,
      createdByBranchId?: string
    ) => Promise<ResultVersion>;
    get: (id: string) => Promise<ResultVersion | null>;
    getByNumber: (resultId: string, version: number) => Promise<ResultVersion | null>;
    list: (resultId: string, limit?: number, offset?: number) => Promise<ResultVersion[]>;
  };
  // Phase 4: Conversation export
  createFromConversation: (
    projectId: string,
    branchId: string,
    options?: {
      name?: string;
      includeMessages?: boolean;
      generateSummary?: boolean;
    }
  ) => Promise<Result>;
}

function createResultBridge(): ResultApi {
  const bridge = getBridge('result');

  if (!bridge) {
    return {
      create: async () => {
        throw new Error('Result bridge not available');
      },
      get: async () => null,
      list: async () => [],
      update: async () => null,
      delete: async () => {
        throw new Error('Result bridge not available');
      },
      byProject: async () => [],
      version: {
        create: async () => {
          throw new Error('Result bridge not available');
        },
        get: async () => null,
        getByNumber: async () => null,
        list: async () => [],
      },
      createFromConversation: async () => {
        throw new Error('Result bridge not available');
      },
    };
  }

  return {
    create: (projectId, type, name, data, config, sourceBranchId) =>
      unwrap(
        bridge.create({ projectId, type, name, data, config, sourceBranchId })
      ),

    get: (id) => unwrapNullable(bridge.get({ id })),

    list: (projectId, options) => unwrap(bridge.list({ projectId, options })),

    update: (id, updates) => unwrapNullable(bridge.update({ id, updates })),

    delete: (id) => unwrap(bridge.delete({ id })),

    byProject: (projectId, options) =>
      unwrap(bridge.byProject({ projectId, options })),

    version: {
      create: (resultId, data, config, createdByBranchId) =>
        unwrap(
          bridge.version.create({ resultId, data, config, createdByBranchId })
        ),

      get: (id) => unwrapNullable(bridge.version.get({ id })),

      getByNumber: (resultId, version) =>
        unwrapNullable(bridge.version.getByNumber({ resultId, version })),

      list: (resultId, limit, offset) =>
        unwrap(bridge.version.list({ resultId, limit, offset })),
    },

    createFromConversation: (projectId, branchId, options) =>
      unwrap(bridge.createFromConversation({ projectId, branchId, options })),
  };
}

export const resultApi = createResultBridge();
