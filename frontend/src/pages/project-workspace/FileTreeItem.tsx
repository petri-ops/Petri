// ============================================================
// FileTreeItem — UI-305 P1 从 project-workspace.tsx 尾部整簇平移（原 2014-2117 行），
// 零行为变化；主文件按既有惯例再导出保持 '@/pages/project-workspace' 导入路径兼容。
// ============================================================
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Icon } from '@/components/icons/Icon';
import { WorkspaceFileIcon } from '@/components/workspace-panels/WorkspaceFileIcon';
import styles from '../project-workspace.module.css';
import type { ActiveWorkspaceFile, FileEntry } from './types';
import { FileTreeList } from './FileTreeList';
import { formatSize } from './helpers';

// UI-400-3 — 树内拖拽内部 MIME 协议常量导出：RightFileTree 根目录落点复用同一协议
export const TREE_DRAG_MIME = 'application/x-gewu-tree-item';

export function FileTreeItem({
  entry,
  fullPath,
  isExpanded,
  depth,
  expandedDirs,
  onToggleDir,
  onFetchDir,
  onFetchDirPage,
  fileUrlFor,
  onOpenFile,
  activePath,
  refreshVersion,
  workspaceDir,
  workspaceKind,
  onRowContextMenu,
  onDropToDir,
}: {
  entry: FileEntry;
  fullPath: string;
  isExpanded: boolean;
  depth: number;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onFetchDir: (prefix: string) => Promise<FileEntry[]>;
  /** BLOCK-96 F2 — 游标分页（可选；缺省回退 onFetchDir 全量，行为兼容） */
  onFetchDirPage?: (prefix: string, offset: number) => Promise<{ entries: FileEntry[]; total: number; truncated: boolean }>;
  fileUrlFor: (path: string) => string;
  onOpenFile: (file: ActiveWorkspaceFile) => void;
  activePath?: string | null;
  refreshVersion: number;
  workspaceDir?: string;
  workspaceKind?: 'local' | 'ssh';
  /** UI-378 — 行右键菜单（宿主接管定位与动作分发） */
  onRowContextMenu?: (event: React.MouseEvent, entry: FileEntry, fullPath: string) => void;
  /** UI-378 — 拖拽落点：拖到目录行上释放（copy=true 时为复制，默认移动） */
  onDropToDir?: (item: { path: string; name: string; type: 'file' | 'dir' }, targetDir: string, copy: boolean) => void;
}): React.ReactElement {
  const [children, setChildren] = useState<FileEntry[]>([]);
  // BLOCK-96 F2 — 目录子项游标分页状态：truncated 时尾部出现「加载更多」
  const [more, setMore] = useState<{ total: number; done: number } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const dragDepthRef = useRef(0);

  const loadDir = useCallback(async (offset: number, append: boolean) => {
    if (onFetchDirPage) {
      const page = await onFetchDirPage(fullPath, offset);
      setChildren((prev) => (append ? [...prev, ...page.entries] : page.entries));
      setMore(page.truncated ? { total: page.total, done: offset + page.entries.length } : null);
      return;
    }
    setChildren(await onFetchDir(fullPath));
    setMore(null);
  }, [onFetchDir, onFetchDirPage, fullPath]);

  useEffect(() => {
    if (isExpanded && entry.type === 'dir') {
      void loadDir(0, false);
    }
  }, [isExpanded, entry.type, fullPath, loadDir, refreshVersion]);

  const handleLoadMore = useCallback(() => {
    if (!more || loadingMore) return;
    setLoadingMore(true);
    void loadDir(more.done, true).finally(() => setLoadingMore(false));
  }, [more, loadingMore, loadDir]);

  const fileUrl = fileUrlFor(fullPath);
  const isActive = entry.type === 'file' && activePath === fullPath;
  const DRAG_MIME = TREE_DRAG_MIME;
  const isDropTarget = entry.type === 'dir' && Boolean(onDropToDir);

  const handleDragStart = useCallback((event: React.DragEvent) => {
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ path: fullPath, name: entry.name, type: entry.type }));
    // BLOCK-90/91 — OS 拖出导出：文件行附带 DownloadURL，拖到 Finder/桌面即落盘。
    // 本地项目用 file:// 直连（即时）；ssh 项目用预览同源 HTTP URL（落盘时服务端流式
    // 下载，无需物化本地副本——plan D5）。树内 drop 读的是上方内部 MIME，互不影响。
    if (entry.type === 'file') {
      if (workspaceKind === 'local' && workspaceDir) {
        const absolute = `file://${workspaceDir}/${fullPath}`;
        event.dataTransfer.setData('DownloadURL', `application/octet-stream:${entry.name}:${absolute}`);
      } else if (fileUrl) {
        event.dataTransfer.setData('DownloadURL', `application/octet-stream:${entry.name}:${fileUrl}`);
      }
    }
    event.dataTransfer.effectAllowed = 'copyMove';
  }, [entry.name, entry.type, fullPath, workspaceDir, workspaceKind]);

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    if (!isDropTarget || !event.dataTransfer.types.includes(DRAG_MIME)) return;
    dragDepthRef.current += 1;
    setDropActive(true);
  }, [isDropTarget]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (!isDropTarget || !event.dataTransfer.types.includes(DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = event.ctrlKey ? 'copy' : 'move';
  }, [isDropTarget]);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    if (!isDropTarget || !event.dataTransfer.types.includes(DRAG_MIME)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDropActive(false);
  }, [isDropTarget]);

  const handleDrop = useCallback((event: React.DragEvent) => {
    if (!isDropTarget) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDropActive(false);
    const raw = event.dataTransfer.getData(DRAG_MIME);
    if (!raw || !onDropToDir) return;
    try {
      const item = JSON.parse(raw) as { path: string; name: string; type: 'file' | 'dir' };
      if (item.path === fullPath) return;
      onDropToDir(item, fullPath, event.ctrlKey);
    } catch { /* 外部拖拽或载荷损坏：忽略 */ }
  }, [isDropTarget, fullPath, onDropToDir]);

  return (
    <li className={styles.fileTreeNode} role="none">
      <button
        type="button"
        data-tree-dir={isDropTarget ? fullPath : undefined}
        className={`${styles.fileTreeRow} ${isActive ? styles.fileTreeRowActive : ''} ${dropActive ? styles.fileTreeRowDropTarget : ''}`}
        style={{ paddingLeft: 5 + depth * 16 }}
        draggable={Boolean(onDropToDir)}
        onDragStart={onDropToDir ? handleDragStart : undefined}
        onDragEnter={isDropTarget ? handleDragEnter : undefined}
        onDragOver={isDropTarget ? handleDragOver : undefined}
        onDragLeave={isDropTarget ? handleDragLeave : undefined}
        onDrop={isDropTarget ? handleDrop : undefined}
        onContextMenu={
          onRowContextMenu
            ? (event) => {
                event.preventDefault();
                onRowContextMenu(event, entry, fullPath);
              }
            : undefined
        }
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
            modifiedAt: entry.modifiedAt,
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
          onFetchDirPage={onFetchDirPage}
          fileUrlFor={fileUrlFor}
          onOpenFile={onOpenFile}
          activePath={activePath}
          refreshVersion={refreshVersion}
          depth={depth + 1}
          workspaceDir={workspaceDir}
          workspaceKind={workspaceKind}
          onRowContextMenu={onRowContextMenu}
          onDropToDir={onDropToDir}
        />
      )}
      {isExpanded && entry.type === 'dir' && more && (
        <button
          type="button"
          className={styles.fileTreeLoadMore}
          style={{ paddingLeft: 21 + depth * 16 }}
          onClick={handleLoadMore}
          disabled={loadingMore}
          data-testid="file-tree-load-more"
        >
          {loadingMore ? '加载中…' : `加载更多（剩余 ${more.total - more.done} 项）`}
        </button>
      )}
    </li>
  );
}

// ============================================================
// RightFileTree — file tree for the right panel (current workspace)
