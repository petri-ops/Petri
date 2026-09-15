// ============================================================
// FileTreeOpsOverlay — BLOCK-89 / UI-378 文件树操作弹层族：
// 右键菜单（重命名/移动/复制/删除/新建文件夹）+ 确认与输入弹层 + 目标目录选择器。
// 全部走 fileOps REST 面（本地/ssh 双后端同构）；错误就地展示，成功后由宿主
// 派发 projectWorkspaceChanged 驱动既有刷新链。
// ============================================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import styles from '../project-workspace.module.css';
import type { FileEntry } from './types';
import {
  fsCopy,
  fsDelete,
  fsMkdir,
  fsMove,
  joinPath,
  splitPath,
  validateRename,
  type FsEntry,
} from './fileOps';

export interface FileTreeMenuTarget {
  x: number;
  y: number;
  /** null = 树空白区（根）：仅提供新建文件夹 */
  entry: FileEntry | null;
  fullPath: string;
}

export type FileTreeDialog =
  | { kind: 'delete'; targets: { path: string; name: string; isDir: boolean }[] }
  | { kind: 'rename'; path: string; name: string }
  | { kind: 'target'; action: 'move' | 'copy'; path: string; name: string }
  | { kind: 'mkdir'; parent: string };

export type FileTreeMenuAction = 'rename' | 'move' | 'copy' | 'delete' | 'mkdir';

/** 右键菜单：fixed 定位于触发点；整层 backdrop 捕获外部点击/Escape 关闭。 */
export function FileTreeContextMenu({
  target,
  onAction,
  onClose,
}: {
  target: FileTreeMenuTarget;
  onAction: (action: FileTreeMenuAction) => void;
  onClose: () => void;
}): React.ReactElement {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const items: { key: FileTreeMenuAction; label: string; icon: IconName; danger?: boolean }[] = [];
  if (target.entry) {
    items.push({ key: 'rename', label: '重命名', icon: 'pencil' });
    items.push({ key: 'move', label: '移动到…', icon: 'arrow-right' });
    items.push({ key: 'copy', label: '复制到…', icon: 'copy' });
    items.push({ key: 'delete', label: '删除', icon: 'trash', danger: true });
  }
  if (!target.entry || target.entry.type === 'dir') {
    items.push({ key: 'mkdir', label: '新建文件夹', icon: 'plus' });
  }

  return (
    <div
      className={styles.fileTreeMenuLayer}
      data-testid="file-tree-menu-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.fileTreeMenu}
        role="menu"
        data-testid="file-tree-menu"
        style={{ left: target.x, top: target.y }}
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className={`${styles.fileTreeMenuItem} ${item.danger ? styles.fileTreeMenuItemDanger : ''}`}
            data-testid={`file-tree-menu-${item.key}`}
            onClick={() => onAction(item.key)}
          >
            <Icon name={item.icon} size={13} />
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 目录选择器内部状态：面包屑上行 + 目录逐层下钻。 */
function DirPicker({
  initialDir,
  fetchDir,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  initialDir: string;
  fetchDir: (prefix: string) => Promise<FileEntry[]>;
  confirmLabel: string;
  onConfirm: (dir: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [pickedDir, setPickedDir] = useState(initialDir);
  const [dirs, setDirs] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDir(pickedDir).then((entries) => {
      if (cancelled) return;
      setDirs(entries.filter((entry) => entry.type === 'dir'));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [pickedDir, fetchDir]);

  const segments = useMemo(() => pickedDir.split('/').filter(Boolean), [pickedDir]);

  return (
    <>
      <div className={styles.fileTreeDirCrumb} data-testid="dir-picker-crumb">
        <button type="button" className={styles.fileTreeDirCrumbSeg} onClick={() => setPickedDir('')}>
          工作区根
        </button>
        {segments.map((segment, index) => (
          <React.Fragment key={`${segment}-${index}`}>
            <span className={styles.fileTreeDirCrumbSep}>/</span>
            <button
              type="button"
              className={styles.fileTreeDirCrumbSeg}
              onClick={() => setPickedDir(segments.slice(0, index + 1).join('/'))}
            >
              {segment}
            </button>
          </React.Fragment>
        ))}
      </div>
      <div className={styles.fileTreeDirList} data-testid="dir-picker-list">
        {loading ? (
          <p className={styles.fileTreeDirEmpty}>加载目录…</p>
        ) : dirs.length === 0 ? (
          <p className={styles.fileTreeDirEmpty}>此目录下没有子文件夹</p>
        ) : (
          dirs.map((dir) => {
            const dirPath = joinPath(pickedDir, dir.name);
            return (
              <button
                key={dirPath}
                type="button"
                className={styles.fileTreeDirRow}
                data-testid="dir-picker-row"
                onClick={() => setPickedDir(dirPath)}
              >
                <Icon name="folder" size={14} />
                <span>{dir.name}</span>
                <Icon name="chevron-right" size={12} />
              </button>
            );
          })
        )}
      </div>
      <div className={styles.fileTreeDialogActions}>
        <button type="button" className={styles.fileTreeDialogButton} onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className={`${styles.fileTreeDialogButton} ${styles.fileTreeDialogButtonPrimary}`}
          data-testid="dir-picker-confirm"
          onClick={() => onConfirm(pickedDir)}
        >
          {confirmLabel}
        </button>
      </div>
    </>
  );
}

/** 弹层宿主：按 dialog.kind 渲染确认/输入/选择器；成功后 onDone（宿主负责刷新与关闭）。 */
export function FileTreeDialogHost({
  dialog,
  projectId,
  fetchDir,
  onDone,
  onClose,
}: {
  dialog: FileTreeDialog;
  projectId: string;
  fetchDir: (prefix: string) => Promise<FileEntry[]>;
  onDone: () => void;
  onClose: () => void;
}): React.ReactElement {
  const [text, setText] = useState(() => (dialog.kind === 'rename' ? dialog.name : ''));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const runOp = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      onDone();
    } catch (e) {
      setError((e as Error).message || '操作失败');
    } finally {
      setBusy(false);
    }
  }, [onDone]);

  const title = useMemo(() => {
    switch (dialog.kind) {
      case 'delete':
        return dialog.targets.length > 1 ? `删除 ${dialog.targets.length} 个项目？` : `删除「${dialog.targets[0].name}」？`;
      case 'rename':
        return '重命名';
      case 'mkdir':
        return dialog.parent ? `在「${dialog.parent}」中新建文件夹` : '在工作区根新建文件夹';
      case 'target':
        return dialog.action === 'move' ? `移动「${dialog.name}」到…` : `复制「${dialog.name}」到…`;
    }
  }, [dialog]);

  const handleSubmit = useCallback(() => {
    if (dialog.kind === 'delete') {
      void runOp(() => fsDelete(projectId, dialog.targets.map((target) => target.path)));
      return;
    }
    if (dialog.kind === 'rename') {
      const { parent } = splitPath(dialog.path);
      const invalid = validateRename(dialog.name, text);
      if (invalid) {
        setError(invalid);
        return;
      }
      void runOp(() => fsMove(projectId, dialog.path, joinPath(parent, text.trim())));
      return;
    }
    if (dialog.kind === 'mkdir') {
      const invalid = validateRename('', text);
      if (invalid) {
        setError(invalid);
        return;
      }
      void runOp(() => fsMkdir(projectId, joinPath(dialog.parent, text.trim())));
    }
    // kind === 'target'：确认按钮由 DirPicker 承载
  }, [dialog, projectId, text, runOp]);

  return (
    <div
      className={styles.fileTreeDialogBackdrop}
      data-testid="file-tree-dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.fileTreeDialog}>
        <p className={styles.fileTreeDialogTitle}>{title}</p>
        {dialog.kind === 'delete' && (
          <div className={styles.fileTreeDeleteList}>
            {dialog.targets.map((target) => (
              <p key={target.path} className={styles.fileTreeDeleteItem}>
                <Icon name={target.isDir ? 'folder' : 'file'} size={13} />
                {target.name}
              </p>
            ))}
            <p className={styles.fileTreeDialogHint}>
              {dialog.targets.some((target) => target.isDir)
                ? '文件夹将连同其全部内容一起删除，此操作不可撤销。'
                : '此操作不可撤销。'}
            </p>
          </div>
        )}
        {(dialog.kind === 'rename' || dialog.kind === 'mkdir') && (
          <input
            className={styles.fileTreeDialogInput}
            data-testid="file-tree-dialog-input"
            value={text}
            autoFocus
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleSubmit();
            }}
            placeholder={dialog.kind === 'mkdir' ? '文件夹名称' : '新名称'}
          />
        )}
        {dialog.kind === 'target' && (
          <DirPicker
            initialDir={splitPath(dialog.path).parent}
            fetchDir={fetchDir}
            confirmLabel={dialog.action === 'move' ? '移动到这里' : '复制到这里'}
            onCancel={onClose}
            onConfirm={(dir) => {
              const toPath = joinPath(dir, dialog.name);
              void runOp(() =>
                dialog.action === 'move'
                  ? fsMove(projectId, dialog.path, toPath)
                  : fsCopy(projectId, dialog.path, toPath),
              );
            }}
          />
        )}
        {error && (
          <p className={styles.fileTreeOpsError} data-testid="file-tree-dialog-error" role="alert">
            {error}
          </p>
        )}
        {(dialog.kind === 'delete' || dialog.kind === 'rename' || dialog.kind === 'mkdir') && (
          <div className={styles.fileTreeDialogActions}>
            <button type="button" className={styles.fileTreeDialogButton} onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className={`${styles.fileTreeDialogButton} ${dialog.kind === 'delete' ? styles.fileTreeDialogButtonDanger : styles.fileTreeDialogButtonPrimary}`}
              data-testid="file-tree-dialog-confirm"
              disabled={busy}
              onClick={handleSubmit}
            >
              {dialog.kind === 'delete' ? '删除' : dialog.kind === 'rename' ? '重命名' : '创建'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
