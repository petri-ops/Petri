// ============================================================
// WorkspaceFileTabStrip — UI-451 文件面板多 tab 常驻的 tab 条：
// 点击切换（回调收数组既有对象，身份不变 → 预览不重载 → 草稿保留）、X/中键关闭
// （脏 tab 由宿主走确认链）、拖拽排序（HTML5 原生 DnD + 独立 MIME，与文件树
// TREE_DRAG_MIME 互不误伤）、右键批量关闭菜单（复用 fileTreeMenu 样式族，模式同
// FileTreeContextMenu）。
// ============================================================
import React, { useCallback, useEffect, useState } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import styles from '../project-workspace.module.css';
import type { ActiveWorkspaceFile } from './types';

/** 独立 MIME：与文件树拖拽（TREE_DRAG_MIME）隔离，tab 条不接受树行拖入。 */
export const FILE_TAB_DRAG_MIME = 'application/x-gewu-file-tab';

export type FileTabMenuAction = 'close' | 'closeOthers' | 'closeRight' | 'closeAll';

type DragHint = { path: string; half: 'left' | 'right' } | null;

export function WorkspaceFileTabStrip({
  files,
  activePath,
  dirtyPaths,
  onActivate,
  onRequestClose,
  onMenuAction,
  onReorder,
}: {
  files: ActiveWorkspaceFile[];
  activePath: string | null;
  dirtyPaths: Record<string, boolean>;
  onActivate: (file: ActiveWorkspaceFile) => void;
  onRequestClose: (path: string) => void;
  onMenuAction: (action: FileTabMenuAction, path: string) => void;
  onReorder: (fromPath: string, toIndex: number) => void;
}): React.ReactElement {
  const [dragHint, setDragHint] = useState<DragHint>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  // Esc 关右键菜单；外点由整层 backdrop 的 mousedown 处理（模式同 FileTreeContextMenu）
  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  const halfFor = (event: React.DragEvent): 'left' | 'right' => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return event.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
  };

  const handleTabDragStart = useCallback((event: React.DragEvent, path: string) => {
    event.dataTransfer.setData(FILE_TAB_DRAG_MIME, path);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleTabDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(FILE_TAB_DRAG_MIME)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const path = (event.currentTarget as HTMLElement).dataset.fileTabPath || '';
    const half = halfFor(event);
    setDragHint((prev) => (prev?.path === path && prev.half === half ? prev : { path, half }));
  }, []);

  const handleTabDrop = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(FILE_TAB_DRAG_MIME)) return;
    event.preventDefault();
    event.stopPropagation();
    const fromPath = event.dataTransfer.getData(FILE_TAB_DRAG_MIME);
    const targetPath = (event.currentTarget as HTMLElement).dataset.fileTabPath || '';
    setDragHint(null);
    if (!fromPath || fromPath === targetPath) return;
    const targetIndex = files.findIndex((item) => item.path === targetPath);
    if (targetIndex === -1) return;
    onReorder(fromPath, targetIndex + (halfFor(event) === 'left' ? 0 : 1));
  }, [files, onReorder]);

  // tab 条空白区：拖到末尾
  const handleStripDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(FILE_TAB_DRAG_MIME)) return;
    event.preventDefault();
    setDragHint((prev) => (prev?.path === '' && prev.half === 'right' ? prev : { path: '', half: 'right' }));
  }, []);
  const handleStripDrop = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(FILE_TAB_DRAG_MIME)) return;
    event.preventDefault();
    const fromPath = event.dataTransfer.getData(FILE_TAB_DRAG_MIME);
    setDragHint(null);
    if (fromPath) onReorder(fromPath, files.length);
  }, [files.length, onReorder]);

  const buildMenuItems = (path: string): { key: FileTabMenuAction; label: string; icon: IconName }[] => {
    const index = files.findIndex((item) => item.path === path);
    const items: { key: FileTabMenuAction; label: string; icon: IconName }[] = [
      { key: 'close', label: '关闭', icon: 'x' },
    ];
    if (files.length > 1) items.push({ key: 'closeOthers', label: '关闭其他', icon: 'minus' });
    if (index !== -1 && index < files.length - 1) items.push({ key: 'closeRight', label: '关闭右侧标签页', icon: 'arrow-right' });
    items.push({ key: 'closeAll', label: '关闭全部', icon: 'square-stack' });
    return items;
  };

  return (
    <>
      <div
        className={`${styles.workspaceFileTabStrip}${dragHint?.path === '' ? ` ${styles.workspaceFileTabStripDropTail}` : ''}`}
        data-testid="file-tab-strip"
        onDragOver={handleStripDragOver}
        onDrop={handleStripDrop}
        onDragEnd={() => setDragHint(null)}
      >
        {files.map((file) => {
          const isActive = file.path === activePath;
          const isDirty = !!dirtyPaths[file.path];
          const dropClass = dragHint?.path === file.path
            ? (dragHint.half === 'left' ? styles.workspaceFileTabDropLeft : styles.workspaceFileTabDropRight)
            : '';
          return (
            <div
              key={file.path}
              data-file-tab-path={file.path}
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              className={`${styles.workspaceFileTab}${isActive ? ` ${styles.workspaceFileTabActive}` : ''}${dropClass ? ` ${dropClass}` : ''}`}
              title={isDirty ? `${file.path}（有未保存修改）` : file.path}
              draggable
              onDragStart={(event) => handleTabDragStart(event, file.path)}
              onDragOver={handleTabDragOver}
              onDrop={handleTabDrop}
              onDragEnd={() => setDragHint(null)}
              onClick={() => onActivate(file)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onActivate(file);
                }
              }}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  onRequestClose(file.path);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY, path: file.path });
              }}
            >
              <Icon name="file" size={12} />
              <span className={styles.workspaceFileTabName}>{file.name}</span>
              {isDirty && <span className={styles.workspaceFileTabDot} data-testid="file-tab-dirty" />}
              <button
                type="button"
                className={styles.workspaceFileTabClose}
                aria-label={`关闭 ${file.name}`}
                title="关闭"
                onClick={(event) => {
                  event.stopPropagation();
                  onRequestClose(file.path);
                }}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          );
        })}
      </div>
      {menu && (
        <div
          className={styles.fileTreeMenuLayer}
          data-testid="file-tab-menu-layer"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMenu(null);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            if (event.target === event.currentTarget) setMenu(null);
          }}
        >
          <div
            className={styles.fileTreeMenu}
            role="menu"
            data-testid="file-tab-menu"
            style={{ left: menu.x, top: menu.y }}
          >
            {buildMenuItems(menu.path).map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={styles.fileTreeMenuItem}
                data-testid={`file-tab-menu-${item.key}`}
                onClick={() => {
                  setMenu(null);
                  onMenuAction(item.key, menu.path);
                }}
              >
                <Icon name={item.icon} size={13} />
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
