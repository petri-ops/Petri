// ============================================================
// branchBridge — IPC wrapper for branch operations
//
// Wraps Electron IPC calls to the main process branch API.
// Uses the typed bridge accessor from desktopBridge.ts.
// ============================================================

import { getBridge } from '@/lib/desktopBridge';
import type { Branch } from '@/types/branch.types';

export interface BranchApi {
  create: (projectId: string, name: string, parentBranchId?: string) => Promise<Branch>;
  list: (projectId: string) => Promise<Branch[]>;
  switch: (branchId: string) => Promise<void>;
  delete: (branchId: string) => Promise<void>;
  rename: (branchId: string, newName: string) => Promise<void>;
  getActive: (projectId: string) => Promise<Branch | null>;
}

function createBranchBridge(): BranchApi {
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
    create: (projectId: string, name: string, parentBranchId?: string) =>
      bridge.create({ projectId, name, parentBranchId }),

    list: (projectId: string) =>
      bridge.list({ projectId }),

    switch: (branchId: string) =>
      bridge.switch({ branchId }),

    delete: (branchId: string) =>
      bridge.delete({ branchId }),

    rename: (branchId: string, newName: string) =>
      bridge.rename({ branchId, newName }),

    getActive: (projectId: string) =>
      bridge.getActive({ projectId }),
  };
}

export const branchApi = createBranchBridge();
