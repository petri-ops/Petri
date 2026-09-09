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
  /** BLOCK-67：ssh 项目无本地 workspaceDir，保存改走 REST PUT 直写远程 */
  workspaceKind?: 'local' | 'ssh';
}

// UI-305 P1 — 文件树条目（原 project-workspace.tsx 内联声明，FileTreeList /
// FileTreeItem / RightFileTree 共享）。
export interface FileEntry {
  name: string;
  type: 'file' | 'dir';
  size?: number;
  modifiedAt?: number;
}

// UI-305 P1 — 文件树条目（原 project-workspace.tsx 内联声明，FileTreeList /
// FileTreeItem / RightFileTree 共享）。
export interface FileEntry {
  name: string;
  type: 'file' | 'dir';
  size?: number;
  modifiedAt?: number;
}
