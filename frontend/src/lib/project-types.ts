// ============================================================
// Global Project model — UI-REFACTOR Phase1
// Shared across all modules (tools, single-cell, spatial, etc.)
// Replaces module-specific project stores with a unified interface.
// ============================================================

/** BLOCK-83 D1：项目形态标签为自由文本——核心不约束取值，领域包自行登记约定
 * （历史 'single-cell' / 'spatial' 取值不再出现在核心里）。 */
export type ProjectModality = string;

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
  /** BLOCK-67：工作区形态。local = 本地目录（缺省）；ssh = 远程项目本体 */
  workspaceKind?: 'local' | 'ssh';
  /** BLOCK-67：ssh 项目的 ~/.ssh/config 别名（仅 workspaceKind='ssh'） */
  sshHost?: string;
  /** BLOCK-67：ssh 项目的远程绝对路径（仅 workspaceKind='ssh'） */
  remotePath?: string;
  status?: 'active' | 'archived';
  g0Baseline?: ProjectG0Baseline;
}

export interface ToolJob {
  id: string;
  tool_id: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
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
