import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ActiveWorkspaceFile } from './types';
import {
  closeWorkspaceFileTabs,
  moveWorkspaceFileTab,
  openWorkspaceFileTab,
  renameWorkspaceFileTab,
} from './workspaceFileTabOps';

// BLOCK-92 Wave B-1 — 工作区文件 tab 状态簇外迁（原 ProjectWorkspace 内联）。
// UI-451 — 多 tab 常驻：open 改原位替换语义 + 新增激活（不重载）/批量关闭/拖拽重排，
// 数组逻辑全部落在 ./workspaceFileTabOps.ts 纯函数（单测覆盖），本 hook 只做 setState 接线。
export function useWorkspaceFileTabs(projectId: string | null | undefined): {
  openWorkspaceFiles: ActiveWorkspaceFile[];
  activeWorkspaceFile: ActiveWorkspaceFile | null;
  setActiveWorkspaceFile: Dispatch<SetStateAction<ActiveWorkspaceFile | null>>;
  handleOpenWorkspaceFile: (file: ActiveWorkspaceFile) => void;
  handleActivateWorkspaceFile: (file: ActiveWorkspaceFile) => void;
  handleCloseWorkspaceFiles: (pathsToClose: string[]) => void;
  handleReorderWorkspaceFiles: (fromPath: string, toIndex: number) => void;
  handleRenameWorkspaceFile: (oldPath: string, nextFile: ActiveWorkspaceFile) => void;
} {
  const [openWorkspaceFiles, setOpenWorkspaceFiles] = useState<ActiveWorkspaceFile[]>([]);
  const [activeWorkspaceFile, setActiveWorkspaceFile] = useState<ActiveWorkspaceFile | null>(null);

  // 活动文件镜像 ref：closeTabs 纯函数需要同帧读到当前活动 path（两个 state 无法
  // 在一个 updater 内原子互读；右栏 adjacent 回退语义由 closeTabs 单点承载）。
  // 同步走 effect（渲染期写 ref 违反 react-hooks/refs；用户事件都在 commit 后触发，
  // effect 已先行同步）。
  const activeRef = useRef<ActiveWorkspaceFile | null>(activeWorkspaceFile);
  useEffect(() => {
    activeRef.current = activeWorkspaceFile;
  }, [activeWorkspaceFile]);

  useEffect(() => {
    setActiveWorkspaceFile(null);
    setOpenWorkspaceFiles([]);
  }, [projectId]);

  const handleOpenWorkspaceFile = useCallback((file: ActiveWorkspaceFile) => {
    // 已存在 path 原位替换（新对象 → 预览重载拉最新），新 path 追加尾部
    setOpenWorkspaceFiles((prev) => openWorkspaceFileTab(prev, file));
    setActiveWorkspaceFile(file);
  }, []);

  const handleActivateWorkspaceFile = useCallback((file: ActiveWorkspaceFile) => {
    // tab 点击切换：传 openWorkspaceFiles 内的既有对象，身份不变 → 预览不重载 → 草稿保留
    setActiveWorkspaceFile(file);
  }, []);

  const handleCloseWorkspaceFiles = useCallback((pathsToClose: string[]) => {
    if (pathsToClose.length === 0) return;
    setOpenWorkspaceFiles((prev) => {
      const { files, nextActivePath } = closeWorkspaceFileTabs(
        prev,
        activeRef.current?.path ?? null,
        pathsToClose,
      );
      setActiveWorkspaceFile(
        nextActivePath ? files.find((item) => item.path === nextActivePath) ?? null : null,
      );
      return files;
    });
  }, []);

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
  }, []);

  return {
    openWorkspaceFiles,
    activeWorkspaceFile,
    setActiveWorkspaceFile,
    handleOpenWorkspaceFile,
    handleActivateWorkspaceFile,
    handleCloseWorkspaceFiles,
    handleReorderWorkspaceFiles,
    handleRenameWorkspaceFile,
  };
}
