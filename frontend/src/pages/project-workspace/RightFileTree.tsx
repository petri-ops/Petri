// ============================================================
// RightFileTree — UI-305 P1 从 project-workspace.tsx 尾部整簇平移（原 2119-2412 行），
// 零行为变化；主文件按既有惯例再导出保持 '@/pages/project-workspace' 导入路径兼容。
// ============================================================
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import { DataIntakeControl } from '@/components/workspace-panels/DataIntakeControl';
import type { Project, ToolJob, Dataset } from '@/lib/project-types';
import { getApiPrefix, getToken } from '@/lib/authClient';
import { gewuEvents, subscribeGewuEvent, dispatchGewuEvent } from '@/lib/events';
import { getBridge } from '@/lib/desktopBridge';
import styles from '../project-workspace.module.css';
import type { ActiveWorkspaceFile, FileEntry } from './types';
import { FileTreeList } from './FileTreeList';
import { WorkspaceFilePreview } from './WorkspaceFilePreview';
import { FileTreeContextMenu, FileTreeDialogHost, type FileTreeDialog, type FileTreeMenuAction, type FileTreeMenuTarget } from './FileTreeOpsOverlay';
import { fsImportFrom, fsMkdir, fsMove, fsCopy, fsUpload, joinPath, uniqueTargetName, type DraggedTreeItem } from './fileOps';

export function RightFileTree({
  project,
  active,
  openFiles,
  activeFile,
  onOpenFile,
  onCloseFile,
  onAskAgent,
}: {
  project: Project;
  active: boolean;
  openFiles: ActiveWorkspaceFile[];
  activeFile: ActiveWorkspaceFile | null;
  onOpenFile: (file: ActiveWorkspaceFile) => void;
  onCloseFile: (path: string) => void;
  onAskAgent: (prompt: string) => boolean | void;
}): React.ReactElement {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [treeOpen, setTreeOpen] = useState(true);
  const [treeWidth, setTreeWidth] = useState(220);
  // BLOCK-73 / UI-322 — 「显示隐藏文件」开关（方案 A）：默认关维持现状体感；偏好持久化。
  const [showHidden, setShowHidden] = useState<boolean>(() => {
    try { return window.localStorage.getItem('gewu.fileTree.showHidden') === '1'; } catch { return false; }
  });

  const [refreshVersion, setRefreshVersion] = useState(0);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [openError, setOpenError] = useState('');
  const [opening, setOpening] = useState(false);
  const activeFileSignatureRef = useRef<string | null>(null);

  // BLOCK-89 / UI-378 — 文件操作（右键菜单 + 拖拽）状态
  const [menuTarget, setMenuTarget] = useState<FileTreeMenuTarget | null>(null);
  const [dialog, setDialog] = useState<FileTreeDialog | null>(null);
// BLOCK-90 — OS 拖入目录递归走树（ssh 分片上传用；本地项目走服务端 fs_cp 递归，不走这里）。
interface OsWalkItem { file: File; relPath: string; }

async function walkOsEntry(entry: FileSystemEntry, prefix: string): Promise<OsWalkItem[]> {
  if (entry.isFile) {
    return new Promise((resolve) => (entry as FileSystemFileEntry).file(
      (file) => resolve([{ file, relPath: `${prefix}${entry.name}` }]),
      () => resolve([]),
    ));
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const out: OsWalkItem[] = [];
  for (;;) {
    const batch: FileSystemEntry[] = await new Promise((resolve) => reader.readEntries(
      (items) => resolve(items as FileSystemEntry[]),
      () => resolve([]),
    ));
    if (batch.length === 0) break;
    for (const child of batch) {
      for (const item of await walkOsEntry(child, `${prefix}${entry.name}/`)) out.push(item);
    }
  }
  return out;
}

  const [opsError, setOpsError] = useState('');

  const fetchDir = useCallback(async (prefix: string) => {
    try {
      // BLOCK-73 — showHidden=1 时服务端跳过点文件过滤（ssh 项目 no-op，见服务端分支）
      const resp = await fetch(
        getApiPrefix() + `/workspaces/${encodeURIComponent(project.id)}/tree?prefix=${encodeURIComponent(prefix)}${showHidden ? '&showHidden=1' : ''}`
      );
      const data = await resp.json();
      if (data.ok) return data.entries as FileEntry[];
    } catch { /* ignore */ }
    return [];
  }, [project.id, showHidden]);

  const refreshFiles = useCallback(async (forcePreview = false) => {
    const rootEntries = await fetchDir('');
    setTree(rootEntries);
    setLoading(false);
    setRefreshVersion((value) => value + 1);

    if (!activeFile?.path) return;
    const segments = activeFile.path.split('/').filter(Boolean);
    const fileName = segments.pop() || activeFile.name;
    const parent = segments.join('/');
    const entries = parent ? await fetchDir(parent) : rootEntries;
    const current = entries.find((entry) => entry.type === 'file' && entry.name === fileName);
    const signature = current
      ? `${current.size ?? -1}:${current.modifiedAt ?? -1}`
      : 'missing';
    const previous = activeFileSignatureRef.current;
    activeFileSignatureRef.current = signature;
    if (forcePreview || (previous !== null && previous !== signature)) {
      setPreviewVersion((value) => value + 1);
    }
  }, [activeFile?.name, activeFile?.path, fetchDir]);

  useEffect(() => {
    activeFileSignatureRef.current = null;
    setOpenError('');
    setOpening(false);
    if (activeFile?.path) {
      const segments = activeFile.path.split('/').filter(Boolean);
      segments.pop();
      setExpandedDirs((current) => {
        const next = new Set(current);
        segments.forEach((_segment, index) => {
          next.add(segments.slice(0, index + 1).join('/'));
        });
        return next;
      });
    }
  }, [activeFile?.path]);

  useEffect(() => {
    setLoading(true);
    void refreshFiles();
  }, [project.id, refreshFiles]);

  useEffect(() => {
    if (!active) return;
    void refreshFiles();
    // UI-327 加映 — SSH 远程项目不做 2s 轮询（每次都是网络往返，持续刷新造成不稳定感）；
    // 刷新触发：初始加载 / projectWorkspaceChanged（agent 写档等）/ 手动刷新按钮。
    // 本地项目保持 2s 轮询原样（本地 fs 轮询零成本）。
    const isSsh = project.workspaceKind === 'ssh';
    let timer: number | undefined;
    if (!isSsh) {
      timer = window.setInterval(() => {
        if (!document.hidden) void refreshFiles();
      }, 2000);
    }
    const unsubscribe = subscribeGewuEvent(gewuEvents.projectWorkspaceChanged, (detail) => {
      if (detail.projectId === project.id) {
        void refreshFiles(true);
      }
    });
    return () => {
      if (timer) window.clearInterval(timer);
      unsubscribe();
    };
  }, [active, project.id, project.workspaceKind, refreshFiles]);

  const toggleDir = useCallback(async (dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }, []);

  const handleOpenFile = useCallback((file: ActiveWorkspaceFile) => {
    onOpenFile(file);
  }, [onOpenFile]);

  // ── BLOCK-89 / UI-378 文件操作（本地/ssh 双后端同构，前端零感知 workspaceKind）──
  const notifyTreeChanged = useCallback(() => {
    dispatchGewuEvent(gewuEvents.projectWorkspaceChanged, { projectId: project.id, source: 'manual' });
  }, [project.id]);

  const closeOverlays = useCallback(() => {
    setMenuTarget(null);
    setDialog(null);
  }, []);

  const runTreeOp = useCallback(async (fn: () => Promise<unknown>) => {
    setOpsError('');
    try {
      await fn();
      notifyTreeChanged();
      return true;
    } catch (error) {
      setOpsError((error as Error).message || '文件操作失败');
      return false;
    }
  }, [notifyTreeChanged]);

  const handleRowContextMenu = useCallback((event: React.MouseEvent, entry: FileEntry, fullPath: string) => {
    setOpsError('');
    setMenuTarget({ x: event.clientX, y: event.clientY, entry, fullPath });
  }, []);

  const handleMenuAction = useCallback((action: FileTreeMenuAction) => {
    if (!menuTarget) return;
    const { entry, fullPath } = menuTarget;
    setMenuTarget(null);
    if (action === 'mkdir') {
      setDialog({ kind: 'mkdir', parent: entry?.type === 'dir' ? fullPath : '' });
      return;
    }
    if (!entry) return;
    if (action === 'rename') setDialog({ kind: 'rename', path: fullPath, name: entry.name });
    else if (action === 'move') setDialog({ kind: 'target', action: 'move', path: fullPath, name: entry.name });
    else if (action === 'copy') setDialog({ kind: 'target', action: 'copy', path: fullPath, name: entry.name });
    else if (action === 'delete') {
      setDialog({
        kind: 'delete',
        targets: [{ path: fullPath, name: entry.name, isDir: entry.type === 'dir' }],
      });
    }
  }, [menuTarget]);

  // 拖拽落点：目标目录预检唯一名（冲突自动 -2 后缀）后走 move/copy
  const handleDropToDir = useCallback(async (item: DraggedTreeItem, targetDir: string, copy: boolean) => {
    setOpsError('');
    const entries = await fetchDir(targetDir);
    const toPath = joinPath(targetDir, uniqueTargetName(entries, item.name));
    const op = copy ? fsCopy : fsMove;
    await runTreeOp(() => op(project.id, item.path, toPath));
  }, [fetchDir, project.id, runTreeOp]);

  // ── BLOCK-90 — OS 拖入导入 ──────────────────────────────────────────
  // 工作区窗口级 drop 接管（home 页 BLOCK-53 的姊妹面：/ =拖目录建项目，/project =导入文件）。
  // 落点：文件树目录行（data-tree-dir）=该目录，其余=根目录；重名 uniqueTargetName 自动 -2。
  // 本地项目：pathForFile（webUtils）取绝对路径 → fs/import-from 服务端拷贝（文件/目录递归）。
  // ssh 项目：源在桌面机、工作区在远端 → renderer 64KB 分片读 + fs/upload 串行追加；
  // 目录经 webkitGetAsEntry 递归走树逐个 mkdir+upload。
  const pathForOf = useCallback((file: File): string | null => {
    const pathFor = window.biof3Desktop?.files?.pathForFile;
    if (typeof pathFor === 'function') {
      try { const p = pathFor(file); if (p) return p; } catch { /* fall through */ }
    }
    return (file as File & { path?: string }).path || null;
  }, []);

  const uploadOsFile = useCallback(async (file: File, toPath: string) => {
    const CHUNK = 64 * 1024;
    if (file.size === 0) {
      await fsUpload(project.id, toPath, '', 0);
      return;
    }
    for (let offset = 0; offset < file.size; offset += CHUNK) {
      const buf = new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer());
      let binary = '';
      for (let i = 0; i < buf.length; i += 0x8000) {
        binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      }
      await fsUpload(project.id, toPath, btoa(binary), offset);
    }
  }, [project.id]);

  const importFromOsDrop = useCallback(async (
    items: Array<{ file: File; entry: FileSystemEntry | null; sourcePath?: string | null }>,
    targetDir: string,
  ) => {
    for (const { file, entry, sourcePath } of items) {
      try {
        const dirEntries = await fetchDir(targetDir);
        const base = uniqueTargetName(dirEntries, entry?.isDirectory ? entry.name : file.name);
        const root = joinPath(targetDir, base);
        if (project.workspaceKind === 'ssh') {
          if (entry && entry.isDirectory) {
            await fsMkdir(project.id, root);
            for (const item of await walkOsEntry(entry, '')) {
              await uploadOsFile(item.file, `${root}/${item.relPath}`.replace(/\/{2,}/g, '/'));
            }
          } else {
            await uploadOsFile(file, root);
          }
        } else {
          // 测试缝：DataTransfer 显式携带源路径时优先（CDP 自动化用；真实拖入走
          // webUtils。该值与直调 fs/import-from REST 等权，无新增特权面）。
          const abs = sourcePath
            || (typeof pathForOf === 'function' ? pathForOf(file) : null)
            || (file as File & { path?: string }).path
            || null;
          if (!abs) throw new Error('无法解析拖入项的磁盘路径');
          await fsImportFrom(project.id, abs, root);
        }
      } catch (error) {
        setOpsError(`${file.name}: ${(error as Error).message || '导入失败'}`);
      }
    }
    notifyTreeChanged();
  }, [fetchDir, notifyTreeChanged, project.workspaceKind, uploadOsFile]);

  useEffect(() => {
    const hasExternalFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes('Files');
    const prevent = (event: DragEvent) => {
      if (!hasExternalFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (event: DragEvent) => {
      if (!hasExternalFiles(event)) return;
      event.preventDefault();
      // Chromium 默认行为是导航到拖入文件路径；上面 preventDefault 已接管。
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const dirRow = hit && (hit as Element).closest('[data-tree-dir]');
      const targetDir = (dirRow && dirRow.getAttribute('data-tree-dir')) || '';
      const droppedFiles = Array.from(event.dataTransfer?.files || []);
      const droppedEntries = Array.from(event.dataTransfer?.items || []).map((item) => {
        const anyItem = item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null };
        return typeof anyItem.webkitGetAsEntry === 'function' ? anyItem.webkitGetAsEntry() : null;
      });
      const seamPath = event.dataTransfer?.getData('application/x-gewu-source-path') || null;
      const paired = droppedFiles.map((file, index) => ({
        file,
        entry: droppedEntries[index] ?? null,
        sourcePath: seamPath && droppedFiles.length === 1 ? seamPath : null,
      }));
      if (paired.length > 0) void importFromOsDrop(paired, targetDir);
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', onDrop);
    };
  }, [importFromOsDrop]);

  const activePreviewUrl = useMemo(() => {
    if (!activeFile?.url) return '';
    const separator = activeFile.url.includes('?') ? '&' : '?';
    return `${activeFile.url}${separator}workspaceRevision=${previewVersion}`;
  }, [activeFile?.url, previewVersion]);

  const openWithSystemApp = useCallback(async () => {
    if (!activeFile || !project.workspacePath) return;
    const filesBridge = getBridge('files');
    if (!filesBridge?.openWorkspaceFile) {
      setOpenError('桌面文件打开能力不可用');
      return;
    }
    setOpening(true);
    setOpenError('');
    try {
      const result = await filesBridge.openWorkspaceFile(project.workspacePath, activeFile.path);
      if (!result.ok) setOpenError(result.error || '系统应用无法打开该文件');
    } catch (error) {
      setOpenError((error as Error).message || '系统应用无法打开该文件');
    } finally {
      setOpening(false);
    }
  }, [activeFile, project.workspacePath]);

  const downloadActiveFile = useCallback(() => {
    if (!activeFile || !activePreviewUrl) return;
    const link = document.createElement('a');
    link.href = activePreviewUrl;
    link.download = activeFile.name;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [activeFile, activePreviewUrl]);

  const breadcrumbSegments = useMemo(
    () => activeFile?.path.split('/').filter(Boolean) || [],
    [activeFile?.path]
  );
  const workspaceRootName = useMemo(() => {
    const pathSegments = String(project.workspacePath || '').split(/[\\/]/).filter(Boolean);
    return pathSegments[pathSegments.length - 1] || project.name;
  }, [project.name, project.workspacePath]);

  const revealBreadcrumbDirectory = useCallback((index: number) => {
    setTreeOpen(true);
    setExpandedDirs((current) => {
      const next = new Set(current);
      for (let cursor = 0; cursor <= index; cursor += 1) {
        next.add(breadcrumbSegments.slice(0, cursor + 1).join('/'));
      }
      return next;
    });
  }, [breadcrumbSegments]);

  const startTreeResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = treeWidth;
    const onMove = (moveEvent: MouseEvent) => {
      setTreeWidth(Math.min(320, Math.max(96, startWidth - (moveEvent.clientX - startX))));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, [treeWidth]);

  return (
    <div className={styles.workspaceFiles}>
      <div className={styles.workspaceFilesToolbar}>
        <div className={styles.workspaceBreadcrumb} title={activeFile?.path || project.workspacePath || project.name}>
          <button
            type="button"
            className={styles.workspaceBreadcrumbSegment}
            onClick={() => setTreeOpen(true)}
          >
            {workspaceRootName}
          </button>
          {breadcrumbSegments.map((segment, index) => {
            const isFile = index === breadcrumbSegments.length - 1;
            return (
              <React.Fragment key={`${segment}-${index}`}>
                <Icon name="chevron-right" size={12} className={styles.workspaceBreadcrumbSeparator} />
                {isFile ? (
                  <span className={styles.workspaceBreadcrumbFile}>{segment}</span>
                ) : (
                  <button
                    type="button"
                    className={styles.workspaceBreadcrumbSegment}
                    onClick={() => revealBreadcrumbDirectory(index)}
                  >
                    {segment}
                  </button>
                )}
              </React.Fragment>
            );
          })}
          {!activeFile && <span className={styles.workspaceBreadcrumbEmpty}>选择文件预览</span>}
        </div>
        <DataIntakeControl projectId={project.id} onAskAgent={onAskAgent} />
        {/* UI-327 加映 — 手动刷新（ssh 项目取消轮询后，外部变更靠此按钮 / agent 写档事件刷新） */}
        <button
          type="button"
          className={styles.workspaceTreeToggle}
          onClick={() => void refreshFiles(true)}
          title="刷新文件树"
          aria-label="刷新文件树"
          data-testid="file-tree-refresh"
        >
          <Icon name="repeat" size={13} />
        </button>
        {/* BLOCK-73 / UI-322 — 「显示隐藏文件」开关（方案 A）：默认关；ssh 项目禁用（node-agent 过滤在 BLOCK-67 面内） */}
        <button
          type="button"
          className={styles.workspaceTreeToggle}
          onClick={() => {
            const next = !showHidden;
            setShowHidden(next);
            try { window.localStorage.setItem('gewu.fileTree.showHidden', next ? '1' : '0'); } catch { /* ignore */ }
          }}
          aria-pressed={showHidden}
          data-testid="file-tree-show-hidden"
          disabled={project.workspaceKind === 'ssh'}
          title={
            project.workspaceKind === 'ssh'
              ? '远程项目暂不支持显示隐藏文件（待 BLOCK-67 后续协调）'
              : showHidden
                ? '隐藏文件当前可见（点击隐藏）'
                : '显示隐藏文件'
          }
        >
          <Icon name={showHidden ? 'eye' : 'eye-off'} size={13} />
        </button>
        <button
          className={styles.workspaceTreeToggle}
          onClick={() => setTreeOpen((value) => !value)}
          title={treeOpen ? '收起文件树' : '展开文件树'}
        >
          <Icon name={treeOpen ? 'chevron-down' : 'chevron-right'} size={13} />
          <Icon name="folder" size={14} />
        </button>
        {activeFile && (
          <button
            type="button"
            className={styles.workspaceTreeToggle}
            onClick={() => onCloseFile(activeFile.path)}
            title={openFiles.length > 1 ? `关闭当前文件（另有 ${openFiles.length - 1} 个已打开文件）` : '关闭当前文件'}
            aria-label="关闭当前文件"
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </div>
      <div className={styles.workspaceFilesMain}>
        <div className={styles.workspaceFilePreviewPane}>
          <WorkspaceFilePreview
            file={activeFile}
            refreshVersion={previewVersion}
            openError={openError}
            opening={opening}
            onOpen={openWithSystemApp}
            onDownload={downloadActiveFile}
            onOpenFile={handleOpenFile}
            projectId={project.id}
          />
        </div>
        {treeOpen && (
          <aside
            className={styles.workspaceFileTreePaneWrap}
            style={{ width: treeWidth, maxWidth: '65%' }}
          >
            <div
              className={styles.workspaceFileTreeResize}
              onMouseDown={startTreeResize}
              title="拖拽调整文件树宽度"
            />
            <div className={styles.workspaceFileTreePane}>
              {loading ? (
                <p className={styles.panelEmpty}>加载文件树…</p>
              ) : tree.length === 0 ? (
                <p className={styles.panelEmpty}>当前工作区暂无文件</p>
              ) : (
                <FileTreeList
                  entries={tree}
                  prefix=""
                  expandedDirs={expandedDirs}
                  onToggleDir={toggleDir}
                  onFetchDir={fetchDir}
                  fileUrlFor={(path) =>
                    getApiPrefix() + `/workspaces/${encodeURIComponent(project.id)}/file?path=${encodeURIComponent(path)}`
                  }
                  onOpenFile={handleOpenFile}
                  activePath={activeFile?.path || null}
                  refreshVersion={refreshVersion}
                  depth={0}
                  workspaceDir={project.workspacePath}
                  workspaceKind={project.workspaceKind}
                  onRowContextMenu={handleRowContextMenu}
                  onDropToDir={(item, targetDir, copy) => { void handleDropToDir(item, targetDir, copy); }}
                />
              )}
            </div>
          </aside>
        )}
      </div>
      {opsError && (
        <p className={styles.fileTreeOpsError} role="alert" data-testid="file-tree-ops-error">
          <Icon name="alert-circle" size={12} />
          {opsError}
        </p>
      )}
      {menuTarget && (
        <FileTreeContextMenu
          target={menuTarget}
          onAction={handleMenuAction}
          onClose={() => setMenuTarget(null)}
        />
      )}
      {dialog && (
        <FileTreeDialogHost
          dialog={dialog}
          projectId={project.id}
          fetchDir={fetchDir}
          onDone={() => {
            closeOverlays();
            notifyTreeChanged();
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
