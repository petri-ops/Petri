// ============================================================
// Type definitions for the project-workspace page.
//
// Extracted from project-workspace.tsx (BLOCK-9 PHASE 3) so the
// huge page file can focus on rendering while type contracts
// live in a small, statically importable module.
// ============================================================

/** A single file selected from the workspace tree, ready for preview. */
export interface ActiveWorkspaceFile {
  path: string;
  name: string;
  url: string;
  size?: number;
  workspaceDir?: string; // 项目根目录绝对路径；BLOCK-19 用于 workspace.writeTextFile 安全写盘
}
