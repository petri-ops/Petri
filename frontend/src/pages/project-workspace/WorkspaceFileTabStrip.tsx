// ============================================================
// WorkspaceFileTabStrip — UI-451 文件面板多 tab 常驻的 tab 条：
// 点击切换（回调收数组既有对象，身份不变 → 预览不重载 → 草稿保留）、X/中键关闭
// （脏 tab 由宿主走确认链）、拖拽排序（HTML5 原生 DnD + 独立 MIME，与文件树
// TREE_DRAG_MIME 互不误伤）、右键批量关闭菜单（复用 fileTreeMenu 样式族，模式同
// FileTreeContextMenu）。
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import styles from '../project-workspace.module.css';
import type { ActiveWorkspaceFile } from './types';
import { fileTabPanelId } from './workspaceFileTabOps';

/** 独立 MIME：与文件树拖拽（TREE_DRAG_MIME）隔离，tab 条不接受树行拖入。 */
export const FILE_TAB_DRAG_MIME = 'application/x-petri-file-tab';

// UI-451 加映 v2 — reveal = 在文件树中定位该 tab（展开祖先目录 + 行滚入视野）
// UI-451 加映 v3 — reopen = 重开最近关闭的 tab（历史存在时才出现在菜单）
export type FileTabMenuAction = 'close' | 'closeOthers' | 'closeRight' | 'closeAll' | 'reveal' | 'reopen';

type DragHint = { path: string; half: 'left' | 'right' } | null;

export function WorkspaceFileTabStrip({
  files,
  activePath,
  dirtyPaths,
  onActivate,
  onRequestClose,
  onMenuAction,
  onReorder,
  canReopen,
}: {
  files: ActiveWorkspaceFile[];
  activePath: string | null;
  dirtyPaths: Record<string, boolean>;
  onActivate: (file: ActiveWorkspaceFile) => void;
  onRequestClose: (path: string) => void;
  onMenuAction: (action: FileTabMenuAction, path: string) => void;
  onReorder: (fromPath: string, toIndex: number) => void;
  /** UI-451 加映 v3（Minor）— 存在可重开的关闭历史时才显示「重新打开已关闭的标签页」 */
  canReopen?: boolean;
}): React.ReactElement {
  const [dragHint, setDragHint] = useState<DragHint>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  // UI-451 加映 v2 (P2-4) — 激活 tab 滚入视野（tab 条横向滚动时新激活/新开 tab 不藏在条外）
  useEffect(() => {
    if (!activePath || !stripRef.current) return;
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(activePath) : activePath;
    const el = stripRef.current.querySelector(`[data-file-tab-path="${escaped}"]`);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activePath]);

  // UI-451 加映 v2 (P2-3) — 同名文件去重显示：重名时附加父目录限定（terminalTabs「名+目录」先例）
  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of files) counts.set(file.name, (counts.get(file.name) || 0) + 1);
    return counts;
  }, [files]);

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
    if (canReopen) items.push({ key: 'reopen', label: '重新打开已关闭的标签页', icon: 'restore' });
    items.push({ key: 'reveal', label: '在树中显示', icon: 'sidebar' });
    return items;
  };

  return (
    <>
      <div
        ref={stripRef}
        role="tablist"
        aria-label="打开的文件"
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
              aria-controls={fileTabPanelId(file)}
              tabIndex={isActive ? 0 : -1}
              className={`${styles.workspaceFileTab}${isActive ? ` ${styles.workspaceFileTabActive}` : ''}${dropClass ? ` ${dropClass}` : ''}`}
              title={isDirty ? `${file.path}（有未保存修改）` : file.path}
              draggable
              onDragStart={(event) => handleTabDragStart(event, file.path)}
              onDragOver={handleTabDragOver}
              onDrop={handleTabDrop}
              onDragEnd={() => setDragHint(null)}
              onClick={() => onActivate(file)}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onRequestClose(file.path);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onActivate(file);
                  return;
                }
                // UI-451 加映 v3（Minor a11y）— roving 方向键：激活并移焦到相邻 tab（WAI-ARIA tabs 模式）
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                  event.preventDefault();
                  const index = files.findIndex((item) => item.path === file.path);
                  const step = event.key === 'ArrowRight' ? 1 : -1;
                  const target = files[(index + step + files.length) % files.length];
                  if (!target) return;
                  onActivate(target);
                  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(target.path) : target.path;
                  const nextEl = stripRef.current?.querySelector(`[data-file-tab-path="${escaped}"]`);
                  if (nextEl instanceof HTMLElement) nextEl.focus();
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
              {(nameCounts.get(file.name) || 0) > 1 && (
                <span className={styles.workspaceFileTabDir} title={file.path}>
                  {file.path.split('/').slice(0, -1).filter(Boolean).join('/') || '根目录'}
                </span>
              )}
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
