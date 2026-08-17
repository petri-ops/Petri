// ============================================================
// resultBridge — IPC wrapper for result operations
//
// Phase 2: Project-scoped results shared across branches
// Uses the typed bridge accessor from desktopBridge.ts.
// ============================================================

import { getBridge } from '@/lib/desktopBridge';
import type { Result, ResultSummary, ResultVersion, ListResultsOptions } from '@/types/result.types';

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
    create: (
      projectId: string,
      type: Result['type'],
      name: string,
      data: unknown,
      config?: Record<string, unknown>,
      sourceBranchId?: string
    ) =>
      bridge.create({ projectId, type, name, data, config, sourceBranchId }),

    get: (id: string) => bridge.get({ id }),

    list: (projectId: string, options?: ListResultsOptions) =>
      bridge.list({ projectId, options }),

    update: (
      id: string,
      updates: { name?: string; data?: unknown; config?: Record<string, unknown> }
    ) => bridge.update({ id, updates }),

    delete: (id: string) => bridge.delete({ id }),

    byProject: (
      projectId: string,
      options?: { type?: Result['type']; limit?: number; offset?: number }
    ) => bridge.byProject({ projectId, options }),

    version: {
      create: (
        resultId: string,
        data: unknown,
        config?: Record<string, unknown>,
        createdByBranchId?: string
      ) =>
        bridge.version.create({ resultId, data, config, createdByBranchId }),

      get: (id: string) => bridge.version.get({ id }),

      getByNumber: (resultId: string, version: number) =>
        bridge.version.getByNumber({ resultId, version }),

      list: (resultId: string, limit?: number, offset?: number) =>
        bridge.version.list({ resultId, limit, offset }),
    },

    createFromConversation: (
      projectId: string,
      branchId: string,
      options?: {
        name?: string;
        includeMessages?: boolean;
        generateSummary?: boolean;
      }
    ) => bridge.createFromConversation({ projectId, branchId, options }),
  };
}

export const resultApi = createResultBridge();
