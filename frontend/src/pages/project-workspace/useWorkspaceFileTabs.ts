import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ActiveWorkspaceFile } from './types';

// BLOCK-92 Wave B-1 — 工作区文件 tab 状态簇外迁（原 ProjectWorkspace 内联，纯搬运零行为变化）：
// 打开文件列表 + 活动文件 + 打开/关闭处理（关闭后活动文件回退到相邻 tab）。
export function useWorkspaceFileTabs(projectId: string | null | undefined): {
  openWorkspaceFiles: ActiveWorkspaceFile[];
  activeWorkspaceFile: ActiveWorkspaceFile | null;
  setActiveWorkspaceFile: Dispatch<SetStateAction<ActiveWorkspaceFile | null>>;
  handleOpenWorkspaceFile: (file: ActiveWorkspaceFile) => void;
  handleCloseWorkspaceFile: (pathToClose: string) => void;
} {
  const [openWorkspaceFiles, setOpenWorkspaceFiles] = useState<ActiveWorkspaceFile[]>([]);
  const [activeWorkspaceFile, setActiveWorkspaceFile] = useState<ActiveWorkspaceFile | null>(null);

  useEffect(() => {
    setActiveWorkspaceFile(null);
    setOpenWorkspaceFiles([]);
  }, [projectId]);

  const handleOpenWorkspaceFile = useCallback((file: ActiveWorkspaceFile) => {
    setOpenWorkspaceFiles((prev) => (
      prev.some((item) => item.path === file.path) ? prev : [...prev, file]
    ));
    setActiveWorkspaceFile(file);
  }, []);

  const handleCloseWorkspaceFile = useCallback((pathToClose: string) => {
    setOpenWorkspaceFiles((prev) => {
      const closingIndex = prev.findIndex((item) => item.path === pathToClose);
      const next = prev.filter((item) => item.path !== pathToClose);
      setActiveWorkspaceFile((current) => {
        if (current?.path !== pathToClose) return current;
        return next[Math.min(Math.max(closingIndex, 0), next.length - 1)] || null;
      });
      return next;
    });
  }, []);

  return {
    openWorkspaceFiles,
    activeWorkspaceFile,
    setActiveWorkspaceFile,
    handleOpenWorkspaceFile,
    handleCloseWorkspaceFile,
  };
}
