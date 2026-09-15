// ============================================================
// FileTreeList — UI-305 P1 从 project-workspace.tsx 尾部整簇平移（原 1954-2012 行），
// 零行为变化；主文件按既有惯例再导出保持 '@/pages/project-workspace' 导入路径兼容。
// ============================================================
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import styles from '../project-workspace.module.css';
import type { ActiveWorkspaceFile, FileEntry } from './types';
import { FileTreeItem } from './FileTreeItem';

export function FileTreeList({
  entries,
  prefix,
  expandedDirs,
  onToggleDir,
  onFetchDir,
  fileUrlFor,
  onOpenFile,
  activePath,
  refreshVersion,
  depth = 0,
  workspaceDir,
  workspaceKind,
  onRowContextMenu,
  onDropToDir,
}: {
  entries: FileEntry[];
  prefix: string;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onFetchDir: (prefix: string) => Promise<FileEntry[]>;
  fileUrlFor: (path: string) => string;
  onOpenFile: (file: ActiveWorkspaceFile) => void;
  activePath?: string | null;
  refreshVersion: number;
  depth?: number;
  workspaceDir?: string;
  workspaceKind?: 'local' | 'ssh';
  onRowContextMenu?: (event: React.MouseEvent, entry: FileEntry, fullPath: string) => void;
  onDropToDir?: (item: { path: string; name: string; type: 'file' | 'dir' }, targetDir: string, copy: boolean) => void;
}): React.ReactElement {
  const orderedEntries = useMemo(
    () => [...entries].sort((left, right) => {
      if (left.type !== right.type) return left.type === 'dir' ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
    }),
    [entries]
  );

  return (
    <ul className={styles.fileTree} role={depth === 0 ? 'tree' : 'group'}>
      {orderedEntries.map((entry) => {
        const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const isExpanded = expandedDirs.has(fullPath);
        return (
          <FileTreeItem
            key={fullPath}
            entry={entry}
            fullPath={fullPath}
            isExpanded={isExpanded}
            depth={depth}
            expandedDirs={expandedDirs}
            onToggleDir={onToggleDir}
            onFetchDir={onFetchDir}
            fileUrlFor={fileUrlFor}
            onOpenFile={onOpenFile}
            activePath={activePath}
            refreshVersion={refreshVersion}
            workspaceDir={workspaceDir}
            workspaceKind={workspaceKind}
            onRowContextMenu={onRowContextMenu}
            onDropToDir={onDropToDir}
          />
        );
      })}
    </ul>
  );
}
