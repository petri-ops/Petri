// ============================================================
// RightFileTree — UI-305 P1 从 project-workspace.tsx 尾部整簇平移（原 2119-2412 行），
// 零行为变化；主文件按既有惯例再导出保持 '@/pages/project-workspace' 导入路径兼容。
// ============================================================
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Icon } from '@/components/icons/Icon';
import { SshStatusDot } from '@/components/workspace-panels/SshStatusDot';
import type { Project } from '@/lib/project-types';
import { getApiPrefix } from '@/lib/authClient';
import { petriEvents, subscribePetriEvent, dispatchPetriEvent } from '@/lib/events';
import { getBridge } from '@/lib/desktopBridge';
import { trackResizeGlow } from '@/lib/resize-glow';
import styles from '../project-workspace.module.css';
import type { ActiveWorkspaceFile, FileEntry } from './types';
import { FileTreeList } from './FileTreeList';
import { WorkspaceFilePreview } from './WorkspaceFilePreview';
import { FileTreeContextMenu, FileTreeDialogHost, type FileTreeDialog, type FileTreeMenuAction, type FileTreeMenuTarget, type FileTreeOpResult } from './FileTreeOpsOverlay';
import { WorkspaceFileTabStrip, type FileTabMenuAction as FileTabMenuActionKind } from './WorkspaceFileTabStrip';
import { fileTabPanelId } from './workspaceFileTabOps';
import { fsImportFrom, fsMkdir, fsMove, fsCopy, fsUpload, joinPath, uniqueTargetName, type DraggedTreeItem } from './fileOps';
import { TREE_DRAG_MIME } from './FileTreeItem';

// BLOCK-96 F2 — 树游标分页：每目录限量拉取，截断目录尾部出现「加载更多」。
// 文件操作/签名对账仍走全量 fetchDir（唯一名预检与 mtime 签名不能吃截断）。
const TREE_DIR_PAGE_LIMIT = 200;

type DirPage = { entries: FileEntry[]; total: number; truncated: boolean };

export function RightFileTree({
  project,
  active,
  openFiles,
  activeFile,
  onOpenFile,
  onActivateFile,
  onCloseFiles,
  onReorderFiles,
  onRenameFile,
  onReopenFile,
  onDirtyMapChange,
  canReopen,
}: {
  project: Project;
  active: boolean;
  openFiles: ActiveWorkspaceFile[];
  activeFile: ActiveWorkspaceFile | null;
  onOpenFile: (file: ActiveWorkspaceFile) => void;
  onActivateFile: (file: ActiveWorkspaceFile) => void;
  onCloseFiles: (paths: string[]) => void;
  onReorderFiles: (fromPath: string, toIndex: number) => void;
  /** UI-451 加映 v2 (P1-1) — rename/move 成功后重定向 tab（宿主=hook 的 handleRenameWorkspaceFile） */
  onRenameFile: (oldPath: string, nextFile: ActiveWorkspaceFile) => void;
  /** UI-451 加映 v3（Minor）— 重开最近关闭的 tab（Ctrl+Shift+T / 菜单项共用） */
  onReopenFile: () => void;
  /** UI-451 加映 v3（P2-7）— 脏位图上抛（v2 的计数版升级）：宿主守卫/淘汰环共用同一真相 */
  onDirtyMapChange?: (dirtyMap: Record<string, boolean>) => void;
  /** UI-451 加映 v3（Minor）— 存在可重开的关闭历史（hook 派生，右键菜单项可见性） */
  canReopen?: boolean;
}): React.ReactElement {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [treeOpen, setTreeOpen] = useState(true);
  const [treeWidth, setTreeWidth] = useState(220);
  // BLOCK-73 / UI-322 — 「显示隐藏文件」开关（方案 A）：默认关维持现状体感；偏好持久化。
  const [showHidden, setShowHidden] = useState<boolean>(() => {
    try { return window.localStorage.getItem('petri.fileTree.showHidden') === '1'; } catch { return false; }
  });

  const [refreshVersion, setRefreshVersion] = useState(0);
  // UI-451 — 预览刷新 token 按 path 计：手动刷新 / agent 写档（projectWorkspaceChanged
  // forcePreview）/ 本地轮询签名变化只 bump 活动 tab 的 token，其余 tab 不重载（草稿保留）。
  const [previewVersions, setPreviewVersions] = useState<Record<string, number>>({});
  // UI-451 — 各 tab 未保存草稿标记（WorkspaceFilePreview.onDirtyChange 上报）：
  // 驱动 tab 圆点 + 关闭确认；单 state 源仍是组件内 text !== textSaved。
  const [dirtyPaths, setDirtyPaths] = useState<Record<string, boolean>>({});
  // UI-451 — 关闭涉及脏 tab 时的确认弹层（复用 fileTreeDialog 样式族）。
  const [closeConfirm, setCloseConfirm] = useState<{ paths: string[]; dirtyNames: string[] } | null>(null);
  const [openError, setOpenError] = useState('');
  const [showInFolderNotice, setShowInFolderNotice] = useState('');
  const [opening, setOpening] = useState(false);
  const activeFileSignatureRef = useRef<string | null>(null);
  // UI-399 — 最新活动文件引用：refreshFiles 读 ref 而非闭包捕获，身份保持稳定。
  // 此前 refreshFiles 依赖 activeFile?.path，切换文件 → 身份变 → 初始加载 effect
  // 重跑（setLoading(true) 闪屏 + 整树重拉 + refreshVersion++ 令所有已展开目录
  // 重新 loadDir）——ssh 项目下每次点开文件都是 N 个目录的网络往返刷新。
  const activeFileRef = useRef<ActiveWorkspaceFile | null>(activeFile);
  activeFileRef.current = activeFile;

  // UI-451 加映 v2 — refreshFiles 身份必须稳定（UI-399 教训），openFiles/dirtyPaths 经
  // ref 镜像读取（渲染期写 ref 违反 react-hooks/refs，同步走 effect）。
  const openFilesRef = useRef(openFiles);
  useEffect(() => { openFilesRef.current = openFiles; }, [openFiles]);
  const dirtyPathsRef = useRef(dirtyPaths);
  useEffect(() => { dirtyPathsRef.current = dirtyPaths; }, [dirtyPaths]);

  // UI-451 加映 v3 — 脏位图上抛宿主（v2 计数版升级：守卫/软上限淘汰环共用；卸载清空防陈旧）
  useEffect(() => {
    onDirtyMapChange?.(dirtyPaths);
    return () => onDirtyMapChange?.({});
  }, [dirtyPaths, onDirtyMapChange]);

  // BLOCK-89 / UI-378 — 文件操作（右键菜单 + 拖拽）状态
  const [menuTarget, setMenuTarget] = useState<FileTreeMenuTarget | null>(null);
  const [dialog, setDialog] = useState<FileTreeDialog | null>(null);
  // UI-400-3 — 根目录落点：拖到树面板背景/文件行/非目录区 = 移动（Ctrl=复制）到根路径。
  // 此前只有目录行接受 drop（还需精准压在那一行上），没有「拖到根」的任何落点。
  const [rootDropActive, setRootDropActive] = useState(false);
  const rootDragDepthRef = useRef(0);
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
      (items) => resolve(items),
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
      const data = (await resp.json()) as { ok?: unknown; entries?: FileEntry[]; total?: number; truncated?: boolean };
      if (data.ok) return data.entries ?? [];
    } catch { /* ignore */ }
    return [];
  }, [project.id, showHidden]);

  // BLOCK-96 F2 — 分页拉取（服务端 limit+truncated；不传 limit 的全量走 fetchDir）
  const fetchDirPage = useCallback(async (prefix: string, offset: number): Promise<DirPage> => {
    try {
      const resp = await fetch(
        getApiPrefix() + `/workspaces/${encodeURIComponent(project.id)}/tree?prefix=${encodeURIComponent(prefix)}${showHidden ? '&showHidden=1' : ''}&limit=${TREE_DIR_PAGE_LIMIT}&offset=${offset}`
      );
      const data = (await resp.json()) as { ok?: unknown; entries?: FileEntry[]; total?: number; truncated?: boolean };
      if (data.ok) {
        return { entries: data.entries || [], total: Number(data.total || 0), truncated: data.truncated === true };
      }
    } catch { /* ignore */ }
    return { entries: [], total: 0, truncated: false };
  }, [project.id, showHidden]);

  // 根目录分页续拉（子目录的加载更多在 FileTreeItem 内）
  const [rootMore, setRootMore] = useState<{ total: number; done: number } | null>(null);
  const [rootLoadingMore, setRootLoadingMore] = useState(false);

  const loadMoreRoot = useCallback(async () => {
    if (!rootMore || rootLoadingMore) return;
    setRootLoadingMore(true);
    try {
      const page = await fetchDirPage('', rootMore.done);
      setTree((prev) => [...prev, ...page.entries]);
      setRootMore(page.truncated ? { total: page.total, done: rootMore.done + page.entries.length } : null);
    } finally {
      setRootLoadingMore(false);
    }
  }, [rootMore, rootLoadingMore, fetchDirPage]);

  const refreshFiles = useCallback(async (forcePreview = false) => {
    const rootPage = await fetchDirPage('', 0);
    setTree(rootPage.entries);
    setRootMore(rootPage.truncated ? { total: rootPage.total, done: rootPage.entries.length } : null);
    setLoading(false);
    setRefreshVersion((value) => value + 1);

    // UI-399 — 活动文件签名对账读 ref（闭包版依赖 activeFile 使本函数身份
    // 随切换文件变化，曾导致每次点开文件整树重拉，见上方 activeFileRef 注释）。
    const currentFile = activeFileRef.current;
    if (!currentFile?.path) return;
    const segments = currentFile.path.split('/').filter(Boolean);
    const fileName = segments.pop() || currentFile.name;
    const parent = segments.join('/');
    // 签名对账走全量（活动文件可能位于分页尾部之外，截断会造成假 missing）
    const entries = await fetchDir(parent);
    const current = entries.find((entry) => entry.type === 'file' && entry.name === fileName);
    const signature = current
      ? `${current.size ?? -1}:${current.modifiedAt ?? -1}`
      : 'missing';
    const previous = activeFileSignatureRef.current;
    activeFileSignatureRef.current = signature;
    if (forcePreview || (previous !== null && previous !== signature)) {
      // UI-451 加映 v2 (P2-1) — forcePreview（手动刷新/agent 写档）除活动 tab 外连带刷新
      // 全部**非脏**后台 tab（无草稿可丢，消除切回时的陈旧内容）；本地 2s 轮询的签名
      // 变化只验证活动文件 → 维持只 bump 活动 tab（语义不变）。
      const activePath = activeFileRef.current?.path;
      setPreviewVersions((prev) => {
        const next = { ...prev };
        const bump = (p: string) => { next[p] = (next[p] ?? 0) + 1; };
        if (activePath) bump(activePath);
        if (forcePreview) {
          for (const file of openFilesRef.current) {
            if (file.path === activePath || dirtyPathsRef.current[file.path]) continue;
            bump(file.path);
          }
        }
        return next;
      });
    }
  }, [fetchDir, fetchDirPage]);

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

  // UI-399 — 仅初始加载/切换项目时整树重拉并置 loading；refreshFiles 身份稳定后
  // 此 effect 不再因切换文件重跑（此前每次点开文件都闪屏+整树重拉，ssh 下体验差）。
  useEffect(() => {
    setLoading(true);
    void refreshFiles();
  }, [project.id, refreshFiles]);

  // UI-451 — 换项目清 tab 周边映射：跨项目同名 path 的脏点/刷新 token 不得串扰。
  // 用 React 官方「props 变化即调整 state」渲染期模式（同步 setState 进 effect 违反
  // react-hooks/set-state-in-effect；也不并入 [project.id, refreshFiles] effect——
  // refreshFiles 身份随 showHidden 等依赖变化，误清 token 会令全部 tab 重载丢草稿）。
  const [tabMapsProjectId, setTabMapsProjectId] = useState(project.id);
  if (tabMapsProjectId !== project.id) {
    setTabMapsProjectId(project.id);
    setPreviewVersions({});
    setDirtyPaths({});
    setCloseConfirm(null);
  }

  useEffect(() => {
    if (!active) return;
    void refreshFiles();
    // UI-327 加映 — SSH 远程项目不做 2s 轮询（每次都是网络往返，持续刷新造成不稳定感）；
    // 刷新触发：面板激活 / projectWorkspaceChanged（agent 写档等）/ 手动刷新按钮。
    // 切换文件不触发树刷新（UI-399：树没变，只有预览内容请求）。
    // 本地项目保持 2s 轮询原样（本地 fs 轮询零成本）。
    const isSsh = project.workspaceKind === 'ssh';
    let timer: number | undefined;
    if (!isSsh) {
      timer = window.setInterval(() => {
        if (!document.hidden) void refreshFiles();
      }, 2000);
    }
    const unsubscribe = subscribePetriEvent(petriEvents.projectWorkspaceChanged, (detail) => {
      if (detail.projectId === project.id) {
        void refreshFiles(true);
      }
    });
    return () => {
      if (timer) window.clearInterval(timer);
      unsubscribe();
    };
  }, [active, project.id, project.workspaceKind, refreshFiles]);

  const toggleDir = useCallback((dirPath: string) => {
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
    dispatchPetriEvent(petriEvents.projectWorkspaceChanged, { projectId: project.id, source: 'manual' });
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

  // ── UI-451 加映 v2 (P1-1) — rename/move 后的 tab 同步 ──
  const buildActiveFile = useCallback((path: string): ActiveWorkspaceFile => ({
    path,
    name: path.split('/').pop() || path,
    url: getApiPrefix() + `/workspaces/${encodeURIComponent(project.id)}/file?path=${encodeURIComponent(path)}`,
    workspaceDir: project.workspacePath,
    workspaceKind: project.workspaceKind,
  }), [project.id, project.workspacePath, project.workspaceKind]);

  // 旧 path 的脏点/刷新 token 一并清除（实例按 tabId 存活，内容按新 path 重载）
  const handleTabFileRenamed = useCallback((oldPath: string, nextPath: string) => {
    setPreviewVersions((prev) => {
      const next = { ...prev };
      delete next[oldPath];
      return next;
    });
    setDirtyPaths((prev) => {
      const next = { ...prev };
      delete next[oldPath];
      return next;
    });
    onRenameFile(oldPath, buildActiveFile(nextPath));
  }, [buildActiveFile, onRenameFile]);

  // 拖拽落点：目标目录预检唯一名（冲突自动 -2 后缀）后走 move/copy；
  // 移动成功后重定向已打开 tab（复制不影响原 tab）（UI-451 加映 v2 P1-1）
  const handleDropToDir = useCallback(async (item: DraggedTreeItem, targetDir: string, copy: boolean) => {
    setOpsError('');
    const entries = await fetchDir(targetDir);
    const toPath = joinPath(targetDir, uniqueTargetName(entries, item.name));
    const op = copy ? fsCopy : fsMove;
    const ok = await runTreeOp(() => op(project.id, item.path, toPath));
    if (ok && !copy) handleTabFileRenamed(item.path, toPath);
  }, [fetchDir, project.id, runTreeOp, handleTabFileRenamed]);

  // UI-451 加映 v2 (P2-5) — 在树中定位 tab：展开祖先目录 + 行滚入视野（懒加载迟到带重试）
  const revealPathInTree = useCallback((path: string) => {
    setTreeOpen(true);
    const segments = path.split('/').filter(Boolean);
    segments.pop();
    setExpandedDirs((current) => {
      const next = new Set(current);
      segments.forEach((_segment, index) => {
        next.add(segments.slice(0, index + 1).join('/'));
      });
      return next;
    });
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(path) : path;
    const attemptScroll = (attempt: number) => {
      window.setTimeout(() => {
        const row = document.querySelector(`[data-file-path="${escaped}"]`);
        if (row) row.scrollIntoView?.({ block: 'nearest' });
        else if (attempt < 8) attemptScroll(attempt + 1);
      }, 220);
    };
    attemptScroll(0);
  }, []);

  // UI-400-3 — 根目录落点（树面板容器级）：目录行自身接受 drop 并 stopPropagation，
  // 冒泡到这里的只有背景空区/文件行/非目录行 → 语义=移动（Ctrl=复制）到根路径。
  const handleRootDragEnter = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(TREE_DRAG_MIME)) return;
    rootDragDepthRef.current += 1;
    setRootDropActive(true);
  }, []);
  const handleRootDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(TREE_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = event.ctrlKey ? 'copy' : 'move';
  }, []);
  const handleRootDragLeave = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(TREE_DRAG_MIME)) return;
    rootDragDepthRef.current = Math.max(0, rootDragDepthRef.current - 1);
    if (rootDragDepthRef.current === 0) setRootDropActive(false);
  }, []);
  const handleRootDrop = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(TREE_DRAG_MIME)) return;
    event.preventDefault();
    rootDragDepthRef.current = 0;
    setRootDropActive(false);
    const raw = event.dataTransfer.getData(TREE_DRAG_MIME);
    if (!raw) return;
    try {
      const item = JSON.parse(raw) as { path: string; name: string; type: 'file' | 'dir' };
      if (!item.path || !item.path.includes('/')) return; // 已在根目录
      void handleDropToDir(item, '', event.ctrlKey);
    } catch { /* 载荷损坏：忽略 */ }
  }, [handleDropToDir]);

  // ── BLOCK-90 — OS 拖入导入 ──────────────────────────────────────────
  // 工作区窗口级 drop 接管（home 页 BLOCK-53 的姊妹面：/ =拖目录建项目，/project =导入文件）。
  // 落点：文件树目录行（data-tree-dir）=该目录，其余=根目录；重名 uniqueTargetName 自动 -2。
  // 本地项目：pathForFile（webUtils）取绝对路径 → fs/import-from 服务端拷贝（文件/目录递归）。
  // ssh 项目：源在桌面机、工作区在远端 → renderer 64KB 分片读 + fs/upload 串行追加；
  // 目录经 webkitGetAsEntry 递归走树逐个 mkdir+upload。
  const pathForOf = useCallback((file: File): string | null => {
    const pathFor = window.petriDesktop?.files?.pathForFile;
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
      const dirRow = hit && (hit).closest('[data-tree-dir]');
      const targetDir = (dirRow && dirRow.getAttribute('data-tree-dir')) || '';
      const droppedFiles = Array.from(event.dataTransfer?.files || []);
      const droppedEntries = Array.from(event.dataTransfer?.items || []).map((item) => {
        const anyItem = item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null };
        return typeof anyItem.webkitGetAsEntry === 'function' ? anyItem.webkitGetAsEntry() : null;
      });
      const seamPath = event.dataTransfer?.getData('application/x-petri-source-path') || null;
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
    const version = previewVersions[activeFile.path] ?? 0;
    return `${activeFile.url}${separator}workspaceRevision=${version}`;
  }, [activeFile?.path, activeFile?.url, previewVersions]);

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

  // UI-400-2 — 导出/下载到本地：优先走主进程 IPC（保存对话框 + 流式写盘，
  // Electron 对 blob 下载会以 GUID.tmp 落盘且无文件名）；桥能力缺失时兜底
  // fetch→blob objectURL（浏览器等非 Electron 场景）。
  const downloadActiveFile = useCallback(async () => {
    if (!activeFile || !activePreviewUrl) return;
    const filesBridge = getBridge('files');
    if (filesBridge?.downloadFromUrl) {
      setOpsError('');
      try {
        const result = await filesBridge.downloadFromUrl(activePreviewUrl, activeFile.name);
        if (result && result.ok === false && !result.canceled) {
          setOpsError(`下载失败：${result.error || '未知错误'}`);
        }
        return;
      } catch { /* 桥异常落兜底 */ }
    }
    try {
      const resp = await fetch(activePreviewUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = activeFile.name;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      setOpsError(`下载失败：${(error as Error).message || '未知错误'}`);
    }
  }, [activeFile, activePreviewUrl]);

  // ── UI-451 — 多 tab 常驻：脏标记上抛、关闭确认链与 tab 右键批量动作 ──
  const handleDirtyChange = useCallback((path: string, dirty: boolean) => {
    setDirtyPaths((prev) => (prev[path] === dirty ? prev : { ...prev, [path]: dirty }));
  }, []);

  const clearDirtyPaths = useCallback((paths: string[]) => {
    setDirtyPaths((prev) => {
      const next = { ...prev };
      for (const path of paths) delete next[path];
      return next;
    });
  }, []);

  // 关闭入口统一走这里：涉及脏 tab 先确认（列出文件名），干净 tab 直接关。
  const requestCloseFiles = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    const dirtyList = paths.filter((path) => dirtyPaths[path]);
    if (dirtyList.length > 0) {
      setCloseConfirm({
        paths,
        dirtyNames: dirtyList.map((path) => openFiles.find((item) => item.path === path)?.name || path),
      });
      return;
    }
    clearDirtyPaths(paths);
    onCloseFiles(paths);
  }, [clearDirtyPaths, dirtyPaths, onCloseFiles, openFiles]);

  const handleTabMenuAction = useCallback((action: FileTabMenuActionKind, path: string) => {
    const index = openFiles.findIndex((item) => item.path === path);
    if (action === 'close') {
      requestCloseFiles([path]);
    } else if (action === 'closeOthers') {
      requestCloseFiles(openFiles.filter((item) => item.path !== path).map((item) => item.path));
    } else if (action === 'closeRight') {
      requestCloseFiles(openFiles.slice(index + 1).map((item) => item.path));
    } else if (action === 'reveal') {
      revealPathInTree(path);
    } else if (action === 'reopen') {
      onReopenFile();
    } else {
      requestCloseFiles(openFiles.map((item) => item.path));
    }
  }, [openFiles, requestCloseFiles, revealPathInTree, onReopenFile]);

  const confirmCloseDirty = useCallback(() => {
    if (!closeConfirm) return;
    const { paths } = closeConfirm;
    setCloseConfirm(null);
    clearDirtyPaths(paths);
    onCloseFiles(paths);
  }, [clearDirtyPaths, closeConfirm, onCloseFiles]);

  // 关闭确认弹层 Esc（backdrop 外点在 JSX 上处理，模式同 FileTreeDialogHost）
  useEffect(() => {
    if (!closeConfirm) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCloseConfirm(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeConfirm]);

  // UI-451 加映 v2 (P2-2) — 文件 tab 键盘快捷键（右栏「文件」tab 激活时）：
  // Ctrl/Cmd+W 关当前 tab（复用脏确认链）；Ctrl+Tab / Ctrl+Shift+Tab 循环切换。
  // 终端让位：焦点在 xterm 内时跳过（readline Ctrl+W=删词，终端语义优先）。
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      const focusEl = document.activeElement as HTMLElement | null;
      if (focusEl && typeof focusEl.closest === 'function' && focusEl.closest('.xterm')) return;
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey
          && event.key.toLowerCase() === 'w') {
        event.preventDefault();
        if (event.repeat) return;
        const current = activeFileRef.current;
        if (current) requestCloseFiles([current.path]);
        return;
      }
      // UI-451 加映 v3（Minor）— Ctrl/Cmd+Shift+T 重开最近关闭的 tab
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey
          && event.key.toLowerCase() === 't') {
        event.preventDefault();
        if (event.repeat) return;
        onReopenFile();
        return;
      }
      if (event.ctrlKey && !event.metaKey && event.key === 'Tab') {
        if (openFiles.length < 2) return;
        event.preventDefault();
        const currentIndex = openFiles.findIndex((item) => item.path === activeFileRef.current?.path);
        const step = event.shiftKey ? -1 : 1;
        const next = openFiles[(currentIndex + step + openFiles.length) % openFiles.length];
        if (next) onActivateFile(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, openFiles, onActivateFile, requestCloseFiles, onReopenFile]);

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
      // UI-400-4 — 放开 320px 上限：只保留 96px 最小值，上限交给容器 maxWidth:65%
      // （用户反馈：文件树宽度有最大限制，能否不限制）
      setTreeWidth(Math.max(96, startWidth - (moveEvent.clientX - startX)));
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
        {/* UI-397 — 远程连接呼吸灯（仅 SSH 项目）：绿=在线 黄=连接中 红=断联，点击手动重试 */}
        {project.workspaceKind === 'ssh' && <SshStatusDot projectId={project.id} withLabel />}
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
            try { window.localStorage.setItem('petri.fileTree.showHidden', next ? '1' : '0'); } catch { /* ignore */ }
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
            onClick={() => void downloadActiveFile()}
            title="下载到本地"
            aria-label="下载到本地"
            data-testid="file-download"
          >
            <Icon name="download" size={13} />
          </button>
        )}
        {activeFile && (
          <button
            type="button"
            className={styles.workspaceTreeToggle}
            onClick={() => {
              if (!project.workspacePath) {
                setOpenError('当前项目没有本地工作区路径');
                return;
              }
              const filesBridge = getBridge('files');
              if (!filesBridge?.showInFolder) {
                setOpenError('桌面文件定位能力不可用');
                return;
              }
              setOpenError('');
              setShowInFolderNotice('');
              void filesBridge.showInFolder(project.workspacePath, activeFile.path).then((result) => {
                if (result.ok) {
                  setShowInFolderNotice(result.testInstance ? '已在文件管理器中显示（测试实例干跑）' : '已在文件管理器中显示');
                  return;
                }
                setOpenError(result.error || '无法在文件管理器中显示该文件');
              }).catch((error: Error) => {
                setOpenError(error.message || '无法在文件管理器中显示该文件');
              });
            }}
            title="在文件管理器中显示"
            aria-label="在文件管理器中显示"
            data-testid="file-show-in-folder"
          >
            <Icon name="folder" size={13} />
          </button>
        )}
        {activeFile && (
          <button
            type="button"
            className={styles.workspaceTreeToggle}
            onClick={() => requestCloseFiles([activeFile.path])}
            title="关闭当前文件"
            aria-label="关闭当前文件"
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </div>
      {showInFolderNotice ? (
        <div className={styles.workspaceTreeNotice} role="status" data-testid="file-show-in-folder-status">
          {showInFolderNotice}
        </div>
      ) : null}
      <div className={styles.workspaceFilesMain}>
        <div className={styles.workspaceFilePreviewPane}>
          {/* UI-451 — 多 tab 常驻：tab 条 + keep-alive 预览栈。每个打开文件一个常驻
              实例，非活动实例 visibility:hidden（保草稿/滚动/编辑器状态，模式同右栏
              tab 内容 rightPanelTabContent）；空态沿用 WorkspaceFilePreview 的
              file=null 空面。openError/opening 只挂活动实例（语义上只描述活动文件的
              系统打开动作）。 */}
          <div className={styles.workspaceFileTabbedPreview}>
            {openFiles.length > 0 && (
              <WorkspaceFileTabStrip
                files={openFiles}
                activePath={activeFile?.path || null}
                dirtyPaths={dirtyPaths}
                onActivate={onActivateFile}
                onRequestClose={(path) => requestCloseFiles([path])}
                onMenuAction={handleTabMenuAction}
                onReorder={onReorderFiles}
                canReopen={canReopen}
              />
            )}
            <div className={styles.workspaceFilePreviewStack} data-testid="file-preview-stack">
              {openFiles.length === 0 && (
                // BLOCK-216 Q5 — 非激活 tab 不得强制 visibility:visible（子级会覆盖
                // 父级 rightPanelTabContent 的 hidden，切走后空态仍盖在新 surface 上）。
                <div className={`${styles.workspaceFilePreviewKeepAlive} ${active ? styles.workspaceFilePreviewKeepAliveActive : ''}`}>
                  <WorkspaceFilePreview
                    file={null}
                    refreshVersion={0}
                    openError={openError}
                    opening={opening}
                    onOpen={openWithSystemApp}
                    onDownload={() => void downloadActiveFile()}
                    projectId={project.id}
                  />
                </div>
              )}
              {openFiles.map((file) => {
                const isActive = active && file.path === activeFile?.path;
                return (
                  <div
                    key={file.tabId ?? file.path}
                    id={fileTabPanelId(file)}
                    role="tabpanel"
                    aria-label={file.name}
                    data-file-preview-path={file.path}
                    className={`${styles.workspaceFilePreviewKeepAlive}${isActive ? ` ${styles.workspaceFilePreviewKeepAliveActive}` : ''}`}
                  >
                    <WorkspaceFilePreview
                      file={file}
                      refreshVersion={previewVersions[file.path] ?? 0}
                      openError={isActive ? openError : ''}
                      opening={isActive ? opening : false}
                      onOpen={openWithSystemApp}
                      onDownload={() => void downloadActiveFile()}
                      onOpenFile={handleOpenFile}
                      projectId={project.id}
                      onDirtyChange={(dirty) => handleDirtyChange(file.path, dirty)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {treeOpen && (
          <aside
            className={styles.workspaceFileTreePaneWrap}
            style={{ width: treeWidth, maxWidth: '65%' }}
          >
            <div
              className={styles.workspaceFileTreeResize}
              onMouseDown={startTreeResize}
              onPointerMove={trackResizeGlow}
              title="拖拽调整文件树宽度"
            />
            <div
              className={`${styles.workspaceFileTreePane} ${rootDropActive ? styles.workspaceFileTreeRootDropActive : ''}`}
              onDragEnter={handleRootDragEnter}
              onDragOver={handleRootDragOver}
              onDragLeave={handleRootDragLeave}
              onDrop={handleRootDrop}
            >
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
                  onFetchDirPage={fetchDirPage}
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
              {treeOpen && rootMore && (
                <button
                  type="button"
                  className={styles.fileTreeLoadMore}
                  onClick={() => { void loadMoreRoot(); }}
                  disabled={rootLoadingMore}
                  data-testid="file-tree-load-more-root"
                >
                  {rootLoadingMore ? '加载中…' : `加载更多（剩余 ${rootMore.total - rootMore.done} 项）`}
                </button>
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
          onDone={(result: FileTreeOpResult) => {
            closeOverlays();
            // UI-451 加映 v2 (P1-1) — 文件操作与 tab 同步：rename/move 重定向（保实例）；
            // delete 直接关闭已删文件的 tab（文件已不存在，无草稿可保，不走脏确认）。
            if (result.kind === 'delete') {
              const openDeleted = openFiles.filter((item) => result.paths.includes(item.path));
              if (openDeleted.length > 0) onCloseFiles(openDeleted.map((item) => item.path));
            } else if (result.kind === 'rename' || result.kind === 'move') {
              handleTabFileRenamed(result.fromPath, result.toPath);
            }
            notifyTreeChanged();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {/* UI-451 — 脏 tab 关闭确认（复用 fileTreeDialog 样式族，按钮用 danger 色表达「丢弃」） */}
      {closeConfirm && (
        <div
          className={styles.fileTreeDialogBackdrop}
          data-testid="file-tab-close-dialog"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCloseConfirm(null);
          }}
        >
          <div className={styles.fileTreeDialog}>
            <p className={styles.fileTreeDialogTitle}>
              {closeConfirm.paths.length === 1
                ? `关闭「${closeConfirm.dirtyNames[0]}」？`
                : `关闭 ${closeConfirm.paths.length} 个标签页？`}
            </p>
            <div className={styles.fileTreeDeleteList}>
              {closeConfirm.dirtyNames.map((name) => (
                <p key={name} className={styles.fileTreeDeleteItem}>
                  <Icon name="file" size={13} />
                  {name}
                </p>
              ))}
              <p className={styles.fileTreeDialogHint}>
                以上标签页有未保存的修改，关闭后将丢弃（自动保存已落盘的内容不受影响）。
              </p>
            </div>
            <div className={styles.fileTreeDialogActions}>
              <button
                type="button"
                className={styles.fileTreeDialogButton}
                onClick={() => setCloseConfirm(null)}
              >
                取消
              </button>
              <button
                type="button"
                className={`${styles.fileTreeDialogButton} ${styles.fileTreeDialogButtonDanger}`}
                data-testid="file-tab-close-confirm"
                onClick={confirmCloseDirty}
              >
                放弃修改并关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
