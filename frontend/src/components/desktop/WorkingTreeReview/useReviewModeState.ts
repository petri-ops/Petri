import { useCallback, useEffect, useRef, useState } from 'react';
import { getBridge } from '@/lib/desktopBridge';
import type { UseWorkingTreeReviewReturn } from './useWorkingTreeReview';
import type { CommitSuccess } from './reviewModeHelpers';

// BLOCK-92 Wave B-3 — ReviewMode 界面逻辑簇外迁（原 ReviewMode.tsx 内联，纯搬运零行为变化）。

/**
 * BLOCK-53 P2 — 非 git 工作区一次性「初始化 git 仓库」引导状态簇（UI-283）：
 * dismiss 记一次性（localStorage 按 projectId）；init 成功后 refresh 让空态
 * 自动切换为正常审阅视图；非 git 诚实空态仍是引导后的稳态兜底。
 */
export function useGitInitPrompt(options: {
  projectId?: string;
  refresh: () => Promise<void>;
}): {
  gitInitBusy: boolean;
  gitInitConfirmOpen: boolean;
  setGitInitConfirmOpen: (open: boolean) => void;
  gitInitMessage: string | null;
  gitInitDismissed: boolean;
  dismissGitInitPrompt: () => void;
  handleGitInit: () => Promise<void>;
} {
  const { projectId, refresh } = options;
  const [gitInitBusy, setGitInitBusy] = useState(false);
  const [gitInitConfirmOpen, setGitInitConfirmOpen] = useState(false);
  const [gitInitMessage, setGitInitMessage] = useState<string | null>(null);
  const [gitInitDismissed, setGitInitDismissed] = useState(false);

  useEffect(() => {
    try {
      setGitInitDismissed(
        window.localStorage.getItem(`gewu.gitinit.dismissed.${projectId || 'default'}`) === '1'
        || window.localStorage.getItem(`biof3.gitinit.dismissed.${projectId || 'default'}`) === '1',
      );
    } catch {
      // localStorage 不可用（私有模式等）时按「未 dismiss」处理，引导仍可用
      setGitInitDismissed(false);
    }
  }, [projectId]);

  const dismissGitInitPrompt = useCallback(() => {
    setGitInitDismissed(true);
    try {
      // projectId 缺席（异常路由）时也按一次性记忆处理，用兜底 key
      window.localStorage.setItem(`gewu.gitinit.dismissed.${projectId || 'default'}`, '1');
    } catch {
      // ignore：记忆失败仅影响「不再弹」，本次 dismiss 仍然生效
    }
  }, [projectId]);

  const handleGitInit = useCallback(async () => {
    if (gitInitBusy) return;
    if (!projectId) {
      setGitInitMessage('无法定位当前项目（缺少路由参数），请从项目工作台进入审阅。');
      return;
    }
    setGitInitBusy(true);
    setGitInitMessage(null);
    try {
      const bridge = getBridge('workingTreeReview');
      const res = await bridge?.initRepository?.({ projectId });
      if (!res || !res.ok) {
        setGitInitMessage(res?.message || res?.error || 'git 初始化失败');
        return;
      }
      if (res.data?.warning) {
        // init 已成功但初始提交未完成（如 git 身份未配置）——如实展示，审阅已可用
        setGitInitMessage(res.data.warning);
        return;
      }
      setGitInitConfirmOpen(false);
      await refresh();
    } catch (e) {
      setGitInitMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setGitInitBusy(false);
    }
  }, [gitInitBusy, projectId, refresh]);

  return {
    gitInitBusy,
    gitInitConfirmOpen,
    setGitInitConfirmOpen,
    gitInitMessage,
    gitInitDismissed,
    dismissGitInitPrompt,
    handleGitInit,
  };
}

/** UI-250/UI-255 — 文件行悬停浮动预览：hover 350ms 后弹出、离行 120ms 后收起。 */
export function useHoverPreview(): {
  hoverPreview: { path: string; anchor: DOMRect } | null;
  cancelHoverTimers: () => void;
  scheduleHoverClose: () => void;
  scheduleHoverPreview: (path: string, el: HTMLElement) => void;
} {
  const [hoverPreview, setHoverPreview] = useState<{ path: string; anchor: DOMRect } | null>(null);
  const hoverOpenTimer = useRef<number | null>(null);
  const hoverCloseTimer = useRef<number | null>(null);

  const cancelHoverTimers = useCallback(() => {
    if (hoverOpenTimer.current !== null) {
      window.clearTimeout(hoverOpenTimer.current);
      hoverOpenTimer.current = null;
    }
    if (hoverCloseTimer.current !== null) {
      window.clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = null;
    }
  }, []);

  const scheduleHoverClose = useCallback(() => {
    if (hoverOpenTimer.current !== null) {
      window.clearTimeout(hoverOpenTimer.current);
      hoverOpenTimer.current = null;
    }
    if (hoverCloseTimer.current !== null) window.clearTimeout(hoverCloseTimer.current);
    hoverCloseTimer.current = window.setTimeout(() => setHoverPreview(null), 120);
  }, []);

  const scheduleHoverPreview = useCallback((path: string, el: HTMLElement) => {
    if (hoverCloseTimer.current !== null) {
      window.clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = null;
    }
    if (hoverOpenTimer.current !== null) window.clearTimeout(hoverOpenTimer.current);
    hoverOpenTimer.current = window.setTimeout(() => {
      hoverOpenTimer.current = null;
      setHoverPreview({ path, anchor: el.getBoundingClientRect() });
    }, 350);
  }, []);

  return { hoverPreview, cancelHoverTimers, scheduleHoverClose, scheduleHoverPreview };
}

/**
 * BLOCK-29.1 — dock 手风琴：每文件一行，点击展开/收起行内 diff。
 * selectedFilePath 变化（聊天卡片跳转等）时自动展开对应行。
 * UI-248 — 批量展开/收起全部文件行内差异（展开时同时打开全部目录分组）。
 */
export function useDockAccordion(options: {
  review: Pick<UseWorkingTreeReviewReturn, 'selectedFilePath' | 'setSelectedFilePath' | 'status'>;
  setCollapsedDirs: (next: Record<string, boolean>) => void;
}): {
  expandedPaths: Set<string>;
  toggleAccordionRow: (path: string) => void;
  anyFileExpanded: boolean;
  toggleExpandAllFiles: () => void;
} {
  const { review, setCollapsedDirs } = options;
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const target = review.selectedFilePath;
    if (!target) return;
    setExpandedPaths((prev) => (prev.has(target) ? prev : new Set(prev).add(target)));
  }, [review.selectedFilePath]);
  const toggleAccordionRow = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    review.setSelectedFilePath(path);
  }, [review]);
  // UI-248 — 展开时同时打开全部目录分组，保证行在树中可见；收起只清行内 diff，不动目录分组。
  const changeFilePaths = (review.status?.files ?? []).map((f) => f.path);
  const anyFileExpanded = changeFilePaths.some((p) => expandedPaths.has(p));
  const toggleExpandAllFiles = useCallback(() => {
    if (anyFileExpanded) {
      setExpandedPaths(new Set());
      return;
    }
    setCollapsedDirs({});
    setExpandedPaths(new Set(changeFilePaths));
  }, [anyFileExpanded, changeFilePaths, setCollapsedDirs]);
  return { expandedPaths, toggleAccordionRow, anyFileExpanded, toggleExpandAllFiles };
}

/**
 * BLOCK-41 — git 写操作 UI 簇（staged 提交框 / 真实分支切换错误 / push-pull 忙态）。
 * 分支列表 + 远程同步状态的加载 effect（改动分区挂载时）随簇内聚。
 */
export function useGitWriteOps(options: {
  review: UseWorkingTreeReviewReturn;
  stagedFilePaths: Array<{ path: string }>;
  onCommitSuccess: (success: CommitSuccess) => void;
}): {
  stagedCommitMsg: string;
  setStagedCommitMsg: (msg: string) => void;
  stagedCommitError: string | null;
  setStagedCommitError: (error: string | null) => void;
  stagedCommitting: boolean;
  handleStagedCommit: () => Promise<void>;
  checkoutError: { message: string; conflicts: string[] } | null;
  handleCheckoutBranch: (name: string) => Promise<void>;
  syncBusy: 'push' | 'pull' | null;
  setSyncBusy: (busy: 'push' | 'pull' | null) => void;
} {
  const { review, stagedFilePaths, onCommitSuccess } = options;
  const [stagedCommitMsg, setStagedCommitMsg] = useState('');
  const [stagedCommitError, setStagedCommitError] = useState<string | null>(null);
  const [stagedCommitting, setStagedCommitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<{ message: string; conflicts: string[] } | null>(null);
  const [syncBusy, setSyncBusy] = useState<'push' | 'pull' | null>(null);

  // 改动分区挂载时取分支列表 + 远程同步状态（切换选择器与 push/pull 徽标消费）
  useEffect(() => {
    if (review.historyView !== 'changes') return;
    void review.loadBranches();
    void review.loadRemoteStatus();
  }, [review.historyView]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStagedCommit = useCallback(async () => {
    const msg = stagedCommitMsg.trim();
    if (!msg || stagedCommitting) return;
    setStagedCommitting(true);
    setStagedCommitError(null);
    try {
      const res = await review.commitIndex(msg);
      onCommitSuccess({ commit: res.commit, files: stagedFilePaths.map((f) => f.path), message: msg });
      setStagedCommitMsg('');
    } catch (e) {
      setStagedCommitError(e instanceof Error ? e.message : String(e));
    } finally {
      setStagedCommitting(false);
    }
  }, [onCommitSuccess, review, stagedCommitMsg, stagedCommitting, stagedFilePaths]);

  const handleCheckoutBranch = useCallback(async (name: string) => {
    setCheckoutError(null);
    const res = await review.checkoutBranch(name);
    if (!res.ok) {
      setCheckoutError({ message: res.message ?? '切换分支失败。', conflicts: res.conflicts ?? [] });
    }
  }, [review]);

  return {
    stagedCommitMsg,
    setStagedCommitMsg,
    stagedCommitError,
    setStagedCommitError,
    stagedCommitting,
    handleStagedCommit,
    checkoutError,
    handleCheckoutBranch,
    syncBusy,
    setSyncBusy,
  };
}
