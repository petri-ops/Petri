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

/** 分组显示名：根目录显示 "."，其余显示目录路径。 */
export function groupDisplayName(dir: string): string {
  return dir === '' ? '.' : dir;
}
