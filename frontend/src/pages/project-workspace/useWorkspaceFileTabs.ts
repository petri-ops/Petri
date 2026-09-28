import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ActiveWorkspaceFile } from './types';
import {
  MAX_FILE_TABS,
  closeWorkspaceFileTabs,
  moveWorkspaceFileTab,
  openWorkspaceFileTab,
  pickLruEviction,
  renameWorkspaceFileTab,
} from './workspaceFileTabOps';

/** UI-451 加映 v3（P2-7）— 淘汰环需要脏位图（宿主 RightFileTree 上抛，经 ProjectWorkspace 注入稳定 getter） */
export interface WorkspaceFileTabsOptions {
  getDirtyPaths?: () => Record<string, boolean>;
}

/** 关闭历史容量（UI-451 加映 v3 Minor：Ctrl+Shift+T 重开最近关闭） */
const CLOSED_HISTORY_CAP = 8;

// BLOCK-92 Wave B-1 — 工作区文件 tab 状态簇外迁（原 ProjectWorkspace 内联）。
// UI-451 — 多 tab 常驻：open 改原位替换语义 + 新增激活（不重载）/批量关闭/拖拽重排，
// 数组逻辑全部落在 ./workspaceFileTabOps.ts 纯函数（单测覆盖），本 hook 只做 setState 接线。
// UI-451 加映 v3（P2-7）— 软上限 MAX_FILE_TABS：超出按 LRU 淘汰非脏后台 tab（淘汰进关闭历史可重开）。
export function useWorkspaceFileTabs(
  projectId: string | null | undefined,
  options?: WorkspaceFileTabsOptions,
): {
  openWorkspaceFiles: ActiveWorkspaceFile[];
  activeWorkspaceFile: ActiveWorkspaceFile | null;
  setActiveWorkspaceFile: Dispatch<SetStateAction<ActiveWorkspaceFile | null>>;
  handleOpenWorkspaceFile: (file: ActiveWorkspaceFile) => void;
  handleActivateWorkspaceFile: (file: ActiveWorkspaceFile) => void;
  handleCloseWorkspaceFiles: (pathsToClose: string[]) => void;
  handleReorderWorkspaceFiles: (fromPath: string, toIndex: number) => void;
  handleRenameWorkspaceFile: (oldPath: string, nextFile: ActiveWorkspaceFile) => void;
  /** UI-451 加映 v3（Minor）— 重开最近关闭且未重新打开的 tab（无则 no-op） */
  handleReopenClosedFile: () => void;
  /** UI-451 加映 v3（Minor）— 是否存在可重开的关闭历史（右键菜单项可见性） */
  hasReopenableClosedFile: boolean;
  closedHistory: ActiveWorkspaceFile[];
} {
  const [openWorkspaceFiles, setOpenWorkspaceFiles] = useState<ActiveWorkspaceFile[]>([]);
  const [activeWorkspaceFile, setActiveWorkspaceFile] = useState<ActiveWorkspaceFile | null>(null);
  // UI-451 加映 v3 — 关闭/淘汰历史（最近在后，容量 8）：重开（Ctrl+Shift+T）数据源
  const [closedHistory, setClosedHistory] = useState<ActiveWorkspaceFile[]>([]);

  // 各镜像 ref：事件处理器在 commit 后触发，值恒新（渲染期写 ref 违反 react-hooks/refs）
  const activeRef = useRef<ActiveWorkspaceFile | null>(activeWorkspaceFile);
  useEffect(() => {
    activeRef.current = activeWorkspaceFile;
  }, [activeWorkspaceFile]);
  const openFilesRef = useRef(openWorkspaceFiles);
  useEffect(() => {
    openFilesRef.current = openWorkspaceFiles;
  }, [openWorkspaceFiles]);
  const closedHistoryRef = useRef(closedHistory);
  useEffect(() => {
    closedHistoryRef.current = closedHistory;
  }, [closedHistory]);
  // LRU 使用序（旧→新）：激活/打开移尾，关闭/淘汰移除
  const lruRef = useRef<string[]>([]);
  const getDirtyRef = useRef(options?.getDirtyPaths);
  useEffect(() => {
    getDirtyRef.current = options?.getDirtyPaths;
  });

  const bumpLru = useCallback((path: string) => {
    const rest = lruRef.current.filter((item) => item !== path);
    rest.push(path);
    lruRef.current = rest;
  }, []);
  const dropLru = useCallback((paths: string[]) => {
    const closing = new Set(paths);
    lruRef.current = lruRef.current.filter((item) => !closing.has(item));
  }, []);
  const pushClosedHistory = useCallback((files: ActiveWorkspaceFile[]) => {
    if (files.length === 0) return;
    setClosedHistory((prev) => [...prev, ...files].slice(-CLOSED_HISTORY_CAP));
  }, []);

  useEffect(() => {
    setActiveWorkspaceFile(null);
    setOpenWorkspaceFiles([]);
    setClosedHistory([]);
    lruRef.current = [];
  }, [projectId]);

  const handleOpenWorkspaceFile = useCallback((file: ActiveWorkspaceFile) => {
    const prev = openFilesRef.current;
    let next = openWorkspaceFileTab(prev, file);
    bumpLru(file.path);
    // P2-7 — 超软上限：LRU 淘汰非脏后台 tab（不淘汰刚打开的；全脏诚实超额放行）
    if (next.length > MAX_FILE_TABS) {
      const victim = pickLruEviction(
        next,
        lruRef.current,
        getDirtyRef.current?.() ?? {},
        [file.path],
      );
      if (victim) {
        const victimFile = next.find((item) => item.path === victim) || null;
        next = next.filter((item) => item.path !== victim);
        dropLru([victim]);
        if (victimFile) pushClosedHistory([victimFile]);
      }
    }
    setOpenWorkspaceFiles(next);
    setActiveWorkspaceFile(file);
  }, [bumpLru, dropLru, pushClosedHistory]);

  const handleActivateWorkspaceFile = useCallback((file: ActiveWorkspaceFile) => {
    // tab 点击切换：传 openWorkspaceFiles 内的既有对象，身份不变 → 预览不重载 → 草稿保留
    bumpLru(file.path);
    setActiveWorkspaceFile(file);
  }, [bumpLru]);

  const handleCloseWorkspaceFiles = useCallback((pathsToClose: string[]) => {
    if (pathsToClose.length === 0) return;
    const prev = openFilesRef.current;
    const { files, nextActivePath } = closeWorkspaceFileTabs(
      prev,
      activeRef.current?.path ?? null,
      pathsToClose,
    );
    if (files === prev) return; // 一个都没命中：原样
    pushClosedHistory(prev.filter((item) => pathsToClose.includes(item.path)));
    dropLru(pathsToClose);
    setOpenWorkspaceFiles(files);
    setActiveWorkspaceFile(
      nextActivePath ? files.find((item) => item.path === nextActivePath) ?? null : null,
    );
  }, [dropLru, pushClosedHistory]);

  const handleReorderWorkspaceFiles = useCallback((fromPath: string, toIndex: number) => {
    setOpenWorkspaceFiles((prev) => moveWorkspaceFileTab(prev, fromPath, toIndex));
  }, []);

  // UI-451 加映 v2（P1-1）— rename/move 成功后重定向 tab（携 tabId 保实例，活动 tab 同步换指向）
  const handleRenameWorkspaceFile = useCallback((oldPath: string, nextFile: ActiveWorkspaceFile) => {
    setOpenWorkspaceFiles((prev) => {
      const next = renameWorkspaceFileTab(prev, oldPath, nextFile);
      if (activeRef.current?.path === oldPath) setActiveWorkspaceFile(nextFile);
      return next;
    });
    const rest = lruRef.current.filter((item) => item !== oldPath);
    rest.push(nextFile.path);
    lruRef.current = rest;
  }, []);

  // UI-451 加映 v3（Minor）— 重开最近关闭且未重新打开的 tab
  const handleReopenClosedFile = useCallback(() => {
    const history = closedHistoryRef.current;
    const openSet = new Set(openFilesRef.current.map((item) => item.path));
    let targetIndex = -1;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (!openSet.has(history[i].path)) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex === -1) return;
    const [target] = history.slice(targetIndex, targetIndex + 1);
    setClosedHistory((prev) => prev.filter((_item, index) => index !== targetIndex));
    handleOpenWorkspaceFile(target);
  }, [handleOpenWorkspaceFile]);

  const hasReopenableClosedFile = closedHistory.some(
    (item) => !openWorkspaceFiles.some((open) => open.path === item.path),
  );

  return {
    openWorkspaceFiles,
    activeWorkspaceFile,
    setActiveWorkspaceFile,
    handleOpenWorkspaceFile,
    handleActivateWorkspaceFile,
    handleCloseWorkspaceFiles,
    handleReorderWorkspaceFiles,
    handleRenameWorkspaceFile,
    handleReopenClosedFile,
    hasReopenableClosedFile,
    closedHistory,
  };
}
