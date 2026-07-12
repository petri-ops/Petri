// ============================================================
// Global Project model — UI-REFACTOR Phase1
// Shared across all modules (tools, single-cell, spatial, etc.)
// Replaces module-specific project stores with a unified interface.
// ============================================================

export type ProjectModality = 'single-cell' | 'spatial' | 'general' | string;

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  modality?: ProjectModality;
  workspacePath?: string;
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
