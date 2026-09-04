// ============================================================
// Global Project model — UI-REFACTOR Phase1
// Shared across all modules (tools, single-cell, spatial, etc.)
// Replaces module-specific project stores with a unified interface.
// ============================================================

export type ProjectModality = 'single-cell' | 'spatial' | 'general' | string;

export interface ProjectG0Baseline {
  recordVersion: number;
  createdBaselineId: string;
  createdBaselineVersion?: string | null;
  createdManifestDigest?: string | null;
  createdBundleDigest?: string | null;
  openedBaselineId: string;
  openedBaselineVersion: string;
  openedManifestDigest: string;
  openedBundleDigest: string;
  compatibilityStatus: 'compatible' | 'migration_required' | 'blocked';
  compatibilityReason: string;
  executionAllowed: boolean;
  migrationRequired: boolean;
  firstRecordedAt?: string | null;
  lastOpenedAt?: string | null;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  modality?: ProjectModality;
  workspacePath?: string;
  status?: 'active' | 'archived';
  g0Baseline?: ProjectG0Baseline;
}

export interface ToolJob {
  id: string;
  tool_id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  created_at: number;
  completed_at?: number;
  error?: string;
  name?: string;
  project_id?: string | null;
  conversationId?: string | null;
  /** BLOCK-57：远程执行目标 id（null/undefined = 本机执行） */
  execution_target_id?: string | null;
}

export interface Dataset {
  id: string;
  projectId: string;
  name: string;
  ossUrl: string;
  size: number;
  uploadedAt: string;
  description?: string;
  nCells?: number;
  nGenes?: number;
  metaUrl?: string;
  featuresUrl?: string;
  parentDatasetId?: string;
  sourceDatasetIds?: string[];
}
