// ============================================================
// FileTreeItem — UI-305 P1 从 project-workspace.tsx 尾部整簇平移（原 2014-2117 行），
// 零行为变化；主文件按既有惯例再导出保持 '@/pages/project-workspace' 导入路径兼容。
// ============================================================
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import { WorkspaceFileIcon } from '@/components/workspace-panels/WorkspaceFileIcon';
import styles from '../project-workspace.module.css';
import type { ActiveWorkspaceFile, FileEntry } from './types';
import { FileTreeList } from './FileTreeList';
import { isCsvFile, isPdfFile, isHtmlFile, isJsonFile, withReportTheme, detectOfficeKind, fallbackKindForExtension, formatSize } from './helpers';

export function FileTreeItem({
  entry,
  fullPath,
  isExpanded,
  depth,
  expandedDirs,
  onToggleDir,
  onFetchDir,
  fileUrlFor,
  onOpenFile,
  activePath,
  refreshVersion,
  workspaceDir,
  workspaceKind,
}: {
  entry: FileEntry;
  fullPath: string;
  isExpanded: boolean;
  depth: number;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onFetchDir: (prefix: string) => Promise<FileEntry[]>;
  fileUrlFor: (path: string) => string;
  onOpenFile: (file: ActiveWorkspaceFile) => void;
  activePath?: string | null;
  refreshVersion: number;
  workspaceDir?: string;
  workspaceKind?: 'local' | 'ssh';
}): React.ReactElement {
  const [children, setChildren] = useState<FileEntry[]>([]);

  useEffect(() => {
    if (isExpanded && entry.type === 'dir') {
      onFetchDir(fullPath).then(setChildren);
    }
  }, [isExpanded, entry.type, fullPath, onFetchDir, refreshVersion]);

  const fileUrl = fileUrlFor(fullPath);
  const isActive = entry.type === 'file' && activePath === fullPath;

  return (
    <li className={styles.fileTreeNode} role="none">
      <button
        type="button"
        className={`${styles.fileTreeRow} ${isActive ? styles.fileTreeRowActive : ''}`}
        style={{ paddingLeft: 5 + depth * 16 }}
        onClick={() => {
          if (entry.type === 'dir') {
            onToggleDir(fullPath);
            return;
          }
          onOpenFile({
            path: fullPath,
            name: entry.name,
            url: fileUrl,
            size: entry.size,
            workspaceDir,
            workspaceKind,
          });
        }}
        role="treeitem"
        aria-expanded={entry.type === 'dir' ? isExpanded : undefined}
        aria-selected={entry.type === 'file' ? isActive : undefined}
        title={entry.type === 'dir' ? `${isExpanded ? '收起' : '展开'} ${entry.name}` : `预览 ${entry.name}`}
      >
        {entry.type === 'dir' ? (
          <>
            <span className={styles.fileTreeChevron}>
              <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={13} />
            </span>
            <WorkspaceFileIcon name={entry.name} type="dir" />
            <span className={styles.fileTreeName}>{entry.name}</span>
          </>
        ) : (
          <>
            <span className={styles.fileTreeChevron} />
            <WorkspaceFileIcon name={entry.name} type="file" />
            <span className={styles.fileTreeLink}>{entry.name}</span>
            {entry.size != null && (
              <span className={styles.fileTreeSize}>{formatSize(entry.size)}</span>
            )}
          </>
        )}
      </button>
      {isExpanded && entry.type === 'dir' && children.length > 0 && (
        <FileTreeList
          entries={children}
          prefix={fullPath}
          expandedDirs={expandedDirs}
          onToggleDir={onToggleDir}
          onFetchDir={onFetchDir}
          fileUrlFor={fileUrlFor}
          onOpenFile={onOpenFile}
          activePath={activePath}
          refreshVersion={refreshVersion}
          depth={depth + 1}
          workspaceDir={workspaceDir}
          workspaceKind={workspaceKind}
        />
      )}
    </li>
  );
}

// ============================================================
// RightFileTree — file tree for the right panel (current workspace)
