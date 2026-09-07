// ============================================================
// reviewModeHelpers — BLOCK-28 主区审阅模式纯函数助手
//
// 仅做确定性计算（文件统计 / 已审判定 / 目录分组），不触 IPC。
// ============================================================

import type { DiffFile } from './useWorkingTreeReview';

export interface FileDiffStats {
  added: number;
  removed: number;
}

/** 从 diff hunk 行统计单文件 +N −M（ctx 行不计）。 */
export function computeFileDiffStats(file: DiffFile | undefined): FileDiffStats {
  if (!file) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') added += 1;
      else if (line.type === 'del') removed += 1;
    }
  }
  return { added, removed };
}

/**
 * 已审判定（确定性规则）：
 * - diff 中不存在该文件（纯 untracked / 状态条目）→ 未审（需人工过目）
 * - binary 或 0 hunk → 自动已审（无可决策内容）
 * - 其余 → 全部 hunk 均有决策（accept/reject）才算已审
 */
export function isFileReviewed(
  diffFile: DiffFile | undefined,
  decisions: Record<string, 'accept' | 'reject' | 'pending'>
): boolean {
  if (!diffFile) return false;
  if (diffFile.binary || diffFile.hunks.length === 0) return true;
  for (let i = 0; i < diffFile.hunks.length; i += 1) {
    const d = decisions[`${diffFile.path}#${i}`];
    if (d !== 'accept' && d !== 'reject') return false;
  }
  return true;
}

export interface FileTreeGroup<T extends { path: string }> {
  /** 目录名；根目录文件归入 ''（显示为 "."） */
  dir: string;
  files: T[];
}

/** 按文件所在目录分组（稳定排序：目录名字典序，组内按 path 字典序）。 */
export function groupFilesByDirectory<T extends { path: string }>(files: T[]): FileTreeGroup<T>[] {
  const byDir = new Map<string, T[]>();
  for (const f of files) {
    const idx = f.path.lastIndexOf('/');
    const dir = idx === -1 ? '' : f.path.slice(0, idx);
    const bucket = byDir.get(dir);
    if (bucket) bucket.push(f);
    else byDir.set(dir, [f]);
  }
  return [...byDir.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([dir, grouped]) => ({
      dir,
      files: grouped.sort((a, b) => a.path.localeCompare(b.path)),
    }));
}

/** 分组显示名：根目录显示「（根目录）」（UI-244），其余显示目录路径。 */
export function groupDisplayName(dir: string): string {
  return dir === '' ? '（根目录）' : dir;
}

// UI-305 P2 - extracted from ReviewMode.tsx:
export function formatCommitDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * BLOCK-29.5 — 未跟踪文件只读预览：fileContent WORKTREE 直读磁盘，
 * 替换原「暂无行级 diff」占位（CodeMirrorEditor 只读渲染）。
 */

// UI-305 P2 — 自 ReviewMode.tsx 平移的共享类型/常量（CommitDiffFileView /
// UntrackedFilePreview / ReviewMode 主组件共用）：
export interface CommitSuccess {
  commit: string | null;
  files: string[];
  message: string;
}

/**
 * BLOCK-29.4 — 扩展名 → CodeMirror lang-* 语言小映射（未命中走纯文本）。
 */
export const FULLTEXT_LANGUAGE_BY_EXT: Record<string, string> = {
  py: 'python',
  md: 'markdown',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  js: 'javascript',
  mjs: 'javascript',
  jsx: 'javascript',
  ts: 'javascript',
  tsx: 'javascript',
};

export type CommitFileViewMode = 'diff' | 'fullModified' | 'fullOriginal' | 'blame';

export interface BlameData {
  lines: Array<{ line: number; sha: string }>;
  commits: Record<string, { sha: string; shortSha: string; author: string; isoDate: string; subject: string }>;
  truncated: boolean;
}
