// ============================================================
// ReviewMode — BLOCK-28 主区一级审阅模式（方案 B）
//
// 取代 BLOCK-20 侧边抽屉形态（WorkingTreeReview.tsx 已删除）。
// 复用 useWorkingTreeReview 状态机 + CodeMirrorDiffView + CodeReviewDrawer，
// IPC 0 新增（git:working-tree-* 全家桶；diffForReview=git diff HEAD 修复保留）。
// 布局：顶部 summary 条 / 左栏文件列表 / 右栏大空间 diff（sticky 文件头）/
//       底部内嵌提交框（VS Code SCM 风格，⌘+Enter，提交成功面板内轻提示）。
// 键盘流与旧抽屉一致：A/Y accept · R reject · ↑↓ navigate · Esc 退出模式。
// ============================================================

import { Fragment, useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { WorkspaceFileIcon } from '@/components/workspace-panels/WorkspaceFileIcon';
import { useWorkingTreeReview, type DiffFile } from './useWorkingTreeReview';
import { getBridge } from '@/lib/desktopBridge';
// BLOCK-92 Wave B-3 — 界面逻辑簇外迁（./useReviewModeState.ts，纯搬运零行为变化）。
import {
  useDockAccordion,
  useGitInitPrompt,
  useGitWriteOps,
  useHoverPreview,
} from './useReviewModeState';
import { CodeMirrorDiffView } from './CodeMirrorDiffView';
import { HoverPreviewPopover } from './HoverPreviewPopover';
import { CodeReviewDrawer } from './CodeReviewDrawer';
import {
  computeFileDiffStats,
  groupDisplayName,
  groupFilesByDirectory,
  hunkDecisionKey,
  hunkDecisionList,
  isFileReviewed,
} from './reviewModeHelpers';
import './WorkingTreeReview.css';
import './ReviewMode.css';

/**
 * BLOCK-29 — 提交内单文件只读 diff：经 commitFileContent 取两版全文，
 * 组装 DiffRevision 交 CodeMirrorDiffView（revisionOverride，无 accept/reject 控件）。
 * BLOCK-29.4 — 两版全文本就持有，增加视图切换：diff / 全文·改动后 / 全文·改动前
 * （新增文件无改动前版本时禁用），全文用 CodeMirrorEditor 只读渲染。
 * BLOCK-29.5 — 对比模式传 fromRef/toRef（sha 区间），hash 为目标提交。
 */
export interface ReviewModeProps {
  /**
   * BLOCK-28.2 — 呈现形态：
   * - 'mode'（默认）：主区一级模式（/review 路由，占满 main 区域）
   * - 'dock'：右侧边栏 review tab（文件条横向、diff 最大化）
   */
  variant?: 'mode' | 'dock';
  /** dock 形态的关闭回调（Esc / 关闭动作触发）。 */
  onClose?: () => void;
}

export function ReviewMode({ variant = 'mode', onClose }: ReviewModeProps) {
  const navigate = useNavigate();
  const isDock = variant === 'dock';
  const review = useWorkingTreeReview({ isOpen: true });
  // BLOCK-53 P2 — 非 git 工作区一次性引导需要 projectId 定位工作区与记忆 dismiss。
  const { projectId } = useParams<{ projectId?: string }>();

  const [commitMsg, setCommitMsg] = useState('');
  const [commitSuccess, setCommitSuccess] = useState<CommitSuccess | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  // BLOCK-176 CP-17 — 工作树 checkpoint 安全网（审阅/还原前的无副作用快照）
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [checkpointNotice, setCheckpointNotice] = useState<string | null>(null);
  const [hasCheckpoint, setHasCheckpoint] = useState(false);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const [focusedHunk, setFocusedHunk] = useState(0);
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({});
  // UI-260 — 右侧文件树改为按钮切换：默认收起（不再常驻占据右侧栏），点击展开/再点收缩
  const [dockTreeOpen, setDockTreeOpen] = useState(false);
  // UI-231 — 历史行内展开（点行 = 行下展开详情，列表不动，可同开多条）
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  // UI-233 — 汇总统计上移到行（首次展开后加载并保留）
  const [commitSummaries, setCommitSummaries] = useState<Record<string, { files: number; added: number; removed: number }>>({});
  // BLOCK-29.6 UI-243 — 历史行 ⋯ 溢出菜单（收纳破坏性「撤销上次提交」）
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLInputElement>(null);

  // ============================================================
  // BLOCK-41 — git 写操作 UI 簇（staged 提交框 / 真实分支切换 / push-pull）
  // 已外迁 ./useReviewModeState.ts useGitWriteOps（调用点在 stagedFiles 就位后）。
  // ============================================================

  // ============================================================
  // BLOCK-53 P2 — 非 git 工作区一次性引导（UI-283）状态簇已外迁
  // ./useReviewModeState.ts useGitInitPrompt（dismiss 一次性记忆 + init 链）。
  // ============================================================
  const {
    gitInitBusy,
    gitInitConfirmOpen,
    setGitInitConfirmOpen,
    gitInitMessage,
    gitInitDismissed,
    dismissGitInitPrompt,
    handleGitInit,
  } = useGitInitPrompt({ projectId, refresh: review.refresh });

  const currentBranchName = review.branches?.find((b) => b.current)?.name ?? null;

  // BLOCK-29.1 — dock 手风琴簇已外迁 ./useReviewModeState.ts useDockAccordion。
  const { expandedPaths, toggleAccordionRow, anyFileExpanded, toggleExpandAllFiles } = useDockAccordion({
    review,
    setCollapsedDirs,
  });

  // UI-254 — 右侧文件树点击：展开/收起左侧行内 diff，并把该行滚入视野
  const openFileFromTree = (path: string) => {
    toggleAccordionRow(path);
    window.setTimeout(() => {
      document
        .querySelector(`[data-acc-path="${CSS.escape(path)}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 60);
  };

  // UI-250/UI-255 — 文件行悬停浮动预览簇已外迁 ./useReviewModeState.ts useHoverPreview
  //（与审阅详情同源同渲染；UI-255 起位置/尺寸由 HoverPreviewPopover 实测自适应）。
  const { hoverPreview, cancelHoverTimers, scheduleHoverClose, scheduleHoverPreview } = useHoverPreview();

  const exitReviewMode = () => {
    if (window.history.length > 1) void navigate(-1);
    else void navigate('/');
  };

  // Esc 语义：先关行内编辑抽屉 → dock 形态关闭面板 → 输入框失焦 → mode 形态退出
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isEditDrawerOpen) {
        setIsEditDrawerOpen(false);
        return;
      }
      if (isDock && onClose) {
        onClose();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
        target.blur();
        return;
      }
      exitReviewMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isEditDrawerOpen, isDock, onClose, navigate]);

  // 切换文件重置 hunk 焦点
  useEffect(() => { setFocusedHunk(0); }, [review.selectedFilePath]);

  // 键盘流：A/Y accept · R reject · ↑↓(j/k) navigate（与旧抽屉一致）
  useEffect(() => {
    const path = review.selectedFilePath;
    if (!path) return;
    // BLOCK-41 — staged 文件选中时 hunk 来自 stagedDiff（HEAD→index）
    const isStaged = review.status?.files.some((f) => f.path === path && f.staged);
    const file = (isStaged
      ? stagedDiffByPath.get(path) ?? review.diff?.files.find((f) => f.path === path)
      : review.diff?.files.find((f) => f.path === path)) || null;
    if (!file) return;
    const onKey = (e: KeyboardEvent) => {
      // BLOCK-29 — 历史分区为只读，A/R/↑↓ 只作用于「改动」分区
      if (review.historyView !== 'changes') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
      const hunks = file.hunks;
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        setFocusedHunk((prev) => Math.min(prev + 1, hunks.length - 1));
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        setFocusedHunk((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'a' || e.key === 'A' || e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        // BLOCK-147 #1 — 去重检查按 hunk 内容寻址（与 decideHunk 记账同键）
        const focusedH = file.hunks[focusedHunk];
        if (focusedH && review.decisions[hunkDecisionKey(file.path, focusedH)] !== 'accept') {
          void review.decideHunk(file.path, focusedHunk, 'accept');
        }
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        void review.decideHunk(file.path, focusedHunk, 'reject');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [review, focusedHunk]); // eslint-disable-line react-hooks/exhaustive-deps

  // P2 — diff 文件索引 + 目录分组 + 已审进度
  const diffByPath = useMemo(() => {
    const map = new Map<string, DiffFile>();
    for (const f of review.diff?.files ?? []) map.set(f.path, f);
    return map;
  }, [review.diff]);

  // BLOCK-41 — staged diff 索引（HEAD→index）+ 暂存两栏分组（porcelain X：index 状态非空 → staged）
  const stagedDiffByPath = useMemo(() => {
    const map = new Map<string, DiffFile>();
    for (const f of review.stagedDiff?.files ?? []) map.set(f.path, f);
    return map;
  }, [review.stagedDiff]);

  const statusFiles = review.status?.files ?? [];
  const stagedFiles = statusFiles.filter((f) => f.staged);
  const unstagedFiles = statusFiles.filter((f) => !f.staged);
  // BLOCK-92 Wave B-3 — git 写操作 UI 簇外迁（./useReviewModeState.ts useGitWriteOps：
  // staged 提交框状态与提交链、真实分支切换错误、push/pull 忙态、分支/远程状态加载）。
  const {
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
  } = useGitWriteOps({
    review,
    stagedFilePaths: stagedFiles,
    onCommitSuccess: setCommitSuccess,
  });
  // BLOCK-147 P2-2 — staged 提交框同款未决拦截：暂存文件仍有未决策 hunk 时先确认
  // （commitIndex 提交整个暂存区无 pathspec，未决 hunk 会随暂存区一并提交，不能无声放行）。
  const handleStagedCommitGuarded = async () => {
    const stagedSet = new Set(stagedFiles.map((f) => f.path));
    const stagedPending = review.pendingHunks.filter((p) => stagedSet.has(p.path));
    const stagedPendingCount = stagedPending.reduce((n, p) => n + p.count, 0);
    if (stagedPendingCount > 0) {
      const PENDING_FILE_CAP = 8;
      const lines = stagedPending.slice(0, PENDING_FILE_CAP).map((p) => `${p.path} ×${p.count}`);
      if (stagedPending.length > PENDING_FILE_CAP) lines.push(`…等共 ${stagedPending.length} 个文件`);
      const proceed = window.confirm(
        `暂存文件中仍有 ${stagedPendingCount} 个 hunk 未决：\n${lines.join('\n')}\n\n仍要提交整个暂存区？` +
        '未决改动将随暂存区一并提交；取消则回去继续审阅。'
      );
      if (!proceed) return;
    }
    await handleStagedCommit();
  };
  const stagedGroups = useMemo(() => groupFilesByDirectory(stagedFiles), [review.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const unstagedGroups = useMemo(() => groupFilesByDirectory(unstagedFiles), [review.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const fileGroups = useMemo(() => groupFilesByDirectory(statusFiles), [review.status]); // eslint-disable-line react-hooks/exhaustive-deps
  // 按栏取 diff：staged 行走 HEAD→index（staged diff），unstaged 行走既有组合 diff
  const diffForStatusFile = useCallback((f: { path: string; staged: boolean }) => {
    if (f.staged) return stagedDiffByPath.get(f.path) ?? diffByPath.get(f.path);
    return diffByPath.get(f.path);
  }, [stagedDiffByPath, diffByPath]);

  const selectedFile = (() => {
    const path = review.selectedFilePath;
    if (!path) return null;
    // BLOCK-41 — staged 文件选中时优先展示 staged diff（HEAD→index）
    const isStaged = stagedFiles.some((f) => f.path === path);
    if (isStaged) return stagedDiffByPath.get(path) ?? diffByPath.get(path) ?? null;
    return diffByPath.get(path) ?? null;
  })();

  const reviewedCount = useMemo(
    () => statusFiles.filter((f) => isFileReviewed(diffForStatusFile(f), review.decisions)).length,
    [statusFiles, diffForStatusFile, review.decisions]  
  );
  const totalFiles = statusFiles.length;

  // UI-235 — 历史分区汇总：当前 ref + 已加载提交数 + 已加载提交合计 ±
  //（替代误置的工作区 +0 −0/审阅进度；「已加载」措辞保证不冒充全分支总量）
  const historyAggregate = useMemo(() => {
    let added = 0;
    let removed = 0;
    let withStats = false;
    for (const c of review.commits ?? []) {
      if (c.stats) {
        withStats = true;
        added += c.stats.added;
        removed += c.stats.removed;
      }
    }
    return withStats ? { added, removed } : null;
  }, [review.commits]);

  const toggleDir = (dir: string) => {
    setCollapsedDirs((prev) => ({ ...prev, [dir]: !prev[dir] }));
  };

  const fileDecisionSummary = (path: string) => {
    const keys = Object.entries(review.decisions).filter(([k]) => k.startsWith(`${path}#`));
    if (keys.length === 0) return null;
    const accepted = keys.filter(([, v]) => v === 'accept').length;
    const rejected = keys.filter(([, v]) => v === 'reject').length;
    return { accepted, rejected, total: keys.length };
  };

  const hasDecisions = Object.keys(review.decisions).length > 0;
  const decisionCount = Object.keys(review.decisions).length;
  const acceptedCount = review.appliedCount;
  const rejectedCount = review.rejectedCount;

  // BLOCK-176 CP-17 — 创建无副作用快照（plumbing；不动工作树/索引/HEAD）
  const handleCheckpointCreate = useCallback(async () => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge?.checkpointCreate) return;
    setCheckpointBusy(true);
    setCheckpointNotice(null);
    try {
      const res = await bridge.checkpointCreate({ projectId });
      const data = res?.data;
      if (res?.ok && data?.ok) {
        if (data.created) {
          setHasCheckpoint(true);
          setCheckpointNotice(`已建安全网快照 ${(data.ref || '').slice(0, 7)}`);
        } else {
          setCheckpointNotice(data.message || '工作树与 HEAD 一致，无需快照');
        }
      } else {
        setCheckpointNotice(data?.message || res?.message || '快照创建失败');
      }
    } catch (e) {
      setCheckpointNotice('快照创建失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setCheckpointBusy(false);
    }
  }, [projectId]);

  // 回滚到最近快照：恢复跟踪文件 + 清理快照后新增文件（破坏性，二次确认）
  const handleCheckpointRollback = useCallback(async () => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge?.checkpointRollback) return;
    if (!window.confirm('回滚到最近的安全网快照？工作树将恢复到快照状态，快照后新增文件将被删除。')) return;
    setCheckpointBusy(true);
    setCheckpointNotice(null);
    try {
      const res = await bridge.checkpointRollback({ projectId });
      const data = res?.data;
      if (res?.ok && data?.ok) {
        setHasCheckpoint(false);
        setCheckpointNotice(`已回滚到快照 ${(data.ref || '').slice(0, 7)}`);
        await review.refresh();
      } else {
        setCheckpointNotice(data?.message || res?.message || '回滚失败');
      }
    } catch (e) {
      setCheckpointNotice('回滚失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setCheckpointBusy(false);
    }
  }, [projectId, review]);

  const handleCommitReviewClick = () => {
    if (!hasDecisions) return;
    if (!commitMsg) {
      setCommitMsg(`Review: accept ${acceptedCount} hunk(s), reject ${rejectedCount} hunk(s)`);
    }
    setCommitError(null);
    setCommitSuccess(null);
    // P4 — 内嵌提交框：聚焦 message 输入而非弹对话框
    textareaRef.current?.focus();
  };

  const handleCommitConfirm = async () => {
    if (!commitMsg.trim()) {
      setCommitError('Commit message is required.');
      textareaRef.current?.focus();
      return;
    }
    // BLOCK-147 #2 — 未决拦截：当前 diff 仍有未决策 hunk 时先确认（列文件与条数），
    // 用户可显式继续或取消回去审；⌘+Enter 与提交按钮同走本路径，不绕过拦截。
    if (review.pendingCount > 0) {
      const PENDING_FILE_CAP = 8;
      const lines = review.pendingHunks
        .slice(0, PENDING_FILE_CAP)
        .map((p) => `${p.path} ×${p.count}`);
      if (review.pendingHunks.length > PENDING_FILE_CAP) {
        lines.push(`…等共 ${review.pendingHunks.length} 个文件`);
      }
      const proceed = window.confirm(
        `仍有 ${review.pendingCount} 个 hunk 未决：\n${lines.join('\n')}\n\n仍要提交？` +
          '未决改动可能随所属文件一并提交；取消则回去继续审阅。'
      );
      if (!proceed) return;
    }
    setCommitError(null);
    try {
      const result = await review.commitReview(commitMsg.trim());
      setCommitSuccess({
        commit: result.commit,
        files: result.files,
        message: commitMsg.trim(),
      });
      setCommitMsg('');
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : String(e));
    }
  };

  // BLOCK-32 — 非 git 工作区诚实空态：不显示任何仓库数据，只说明原因。
  // BLOCK-53 P2 — 空态内嵌一次性「初始化 git 仓库」引导（dismiss 后不再出现）。
  if (review.workspaceNotGit) {
    return (
      <div
        className={`rvw-container${isDock ? ' rvw-container--dock' : ''}`}
        role="region"
        aria-label="审阅面板"
        data-testid="rvw-not-git"
      >
        <div className="wt-empty">
          <Icon name="git-branch" size={18} />
          <p>当前项目工作区不是 git 仓库</p>
          <p>审阅基于项目工作区的 git 版本历史。该工作区尚未初始化 git 仓库，暂无可审阅的改动与历史。</p>
          {!gitInitDismissed && (
            <div className="wt-gitinit-prompt" data-testid="git-init-prompt">
              {!gitInitConfirmOpen ? (
                <div className="wt-gitinit-actions">
                  <button
                    type="button"
                    className="petri-btn petri-btn--sm"
                    onClick={() => setGitInitConfirmOpen(true)}
                    disabled={gitInitBusy}
                  >
                    初始化 git 仓库…
                  </button>
                  <button
                    type="button"
                    className="petri-btn petri-btn--ghost petri-btn--sm"
                    onClick={dismissGitInitPrompt}
                    disabled={gitInitBusy}
                  >
                    不再提示
                  </button>
                </div>
              ) : (
                <div className="wt-gitinit-confirm">
                  <p className="wt-gitinit-confirm-lead">
                    将在当前项目工作区创建 <code>.git</code> 仓库，并把现有全部文件作为初始提交。
                  </p>
                  <div className="wt-gitinit-actions">
                    <button
                      type="button"
                      className="petri-btn petri-btn--sm"
                      onClick={() => void handleGitInit()}
                      disabled={gitInitBusy}
                    >
                      {gitInitBusy ? '初始化中…' : '确认初始化'}
                    </button>
                    <button
                      type="button"
                      className="petri-btn petri-btn--ghost petri-btn--sm"
                      onClick={() => setGitInitConfirmOpen(false)}
                      disabled={gitInitBusy}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
              {gitInitMessage && (
                <p className="wt-gitinit-message" role="alert">{gitInitMessage}</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`rvw-container${isDock ? ' rvw-container--dock' : ''}`} role="region" aria-label="审阅面板">
      {/* Commit success toast */}
      {commitSuccess && (
        <div className="wt-commit-success" role="status">
          <span>
            <strong>已提交</strong>
            {commitSuccess.commit && (
              <span className="wt-commit-hash"> {commitSuccess.commit.slice(0, 7)}</span>
            )}
            {' — '}
            {commitSuccess.files.length} 个文件
          </span>
          <button
            type="button"
            className="wt-commit-success-close"
            onClick={() => setCommitSuccess(null)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* 顶部 summary 条 + 审阅进度细条 */}
      <header className="rvw-summary">
        <div className="rvw-summary-left">
          <span className="wt-title">审阅</span>
          {/* BLOCK-29 — 改动 / 历史分区切换 */}
          <div className="rvw-view-switch" role="tablist" aria-label="审阅分区">
            <button
              type="button"
              role="tab"
              aria-selected={review.historyView === 'changes'}
              className={`rvw-view-switch-btn${review.historyView === 'changes' ? ' active' : ''}`}
              onClick={() => review.setHistoryView('changes')}
            >
              改动
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={review.historyView === 'history'}
              className={`rvw-view-switch-btn${review.historyView === 'history' ? ' active' : ''}`}
              onClick={() => {
                review.setHistoryView('history');
                void review.loadHistory();
                void review.loadBranches();
                void review.loadStashesAndTags();
              }}
            >
              历史
            </button>
          </div>
          {/* UI-247 — 分支选择/对比/文件过滤并入 tabs 行，历史第二行取消：
              控件紧邻分区切换，不再单独占一行 */}
          {review.historyView === 'history' && (
            <>
              {review.historyFileFilter ? (
                <span className="rvw-history-filter" title="仅显示该文件的提交">
                  文件: {review.historyFileFilter}
                  <span
                    role="button"
                    tabIndex={-1}
                    className="rvw-history-filter-clear"
                    aria-label="清除文件过滤"
                    title="清除过滤"
                    onClick={() => void review.loadHistory({ file: null })}
                  >
                    <Icon name="x" size={10} />
                  </span>
                </span>
              ) : null}
              {/* BLOCK-29.5 — 分支选择器：只读查看其他分支历史，不切换工作区分支 */}
              <select
                className="rvw-branch-select"
                aria-label="提交历史分支"
                value={review.activeBranch ?? ''}
                onChange={(e) => void review.switchBranch(e.target.value || null)}
                title="查看其他分支的提交历史（只读，不切换工作区分支）"
              >
                <option value="">当前分支 (HEAD)</option>
                {(review.branches ?? []).map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                    {b.current ? '（当前）' : ''}
                  </option>
                ))}
                {review.tags && review.tags.length > 0 && (
                  <optgroup label="标签">
                    {review.tags.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name}（tag）
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </>
          )}
          {review.historyView === 'changes' ? (
            <>
              <span className="rvw-summary-stats" data-testid="rvw-summary-stats">
                <span>{review.status?.totalFiles ?? 0} 个文件</span>
                {review.diff && (
                  <span className="rvw-stat-add">+{review.diff.summary.added}</span>
                )}
                {review.diff && (
                  <span className="rvw-stat-del">−{review.diff.summary.removed}</span>
                )}
                <span className="rvw-review-progress" data-testid="rvw-review-progress">
                  {reviewedCount}/{totalFiles} 已审
                </span>
              </span>
              {/* UI-248 — 批量展开/收起全部文件行内差异（dock 手风琴行可展开；主区文件列表为点选式不适用） */}
              {isDock && totalFiles > 0 && (
                <button
                  type="button"
                  className="wt-btn rvw-expand-all-btn"
                  onClick={toggleExpandAllFiles}
                  title={anyFileExpanded ? '收起所有文件的行内差异' : '展开所有文件的行内差异'}
                >
                  {anyFileExpanded ? '收起全部' : '展开全部'}
                </button>
              )}
              {/* BLOCK-41 — 真实分支切换（写 refs；脏树拒绝并列出冲突文件）。
                  与历史分区只读 ref 选择器（switchBranch）语义不同。 */}
              {(review.branches ?? []).length > 0 && (
                <select
                  className="rvw-branch-select"
                  aria-label="切换工作区分支"
                  data-testid="rvw-branch-switch"
                  value={currentBranchName ?? ''}
                  onChange={(e) => {
                    const name = e.target.value;
                    if (!name || name === currentBranchName) return;
                    if (window.confirm(`切换到分支 '${name}'？有未提交改动时切换将被阻止。`)) {
                      void handleCheckoutBranch(name);
                    }
                  }}
                  title="切换工作区分支（有未提交改动时会被阻止）"
                >
                  {(review.branches ?? []).map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                      {b.current ? '（当前）' : ''}
                    </option>
                  ))}
                </select>
              )}
            </>
          ) : (
            /* UI-235 — 历史分区：工作区统计不适用，改显分支/标签 + 已加载提交数 + 合计 */
            <span className="rvw-summary-stats" data-testid="rvw-history-summary-stats">
              <span>{review.activeBranch ?? '当前分支'}</span>
              <span>已加载 {review.commits?.length ?? 0} 条提交</span>
              {historyAggregate && (
                <>
                  <span>合计</span>
                  <span className="rvw-stat-add">+{historyAggregate.added}</span>
                  <span className="rvw-stat-del">−{historyAggregate.removed}</span>
                </>
              )}
            </span>
          )}
          {review.taskId && <span className="wt-task-id">task: {review.taskId}</span>}
        </div>
        <div className="rvw-summary-actions">
          {/* BLOCK-41 — ahead/behind 徽标 + push/pull（有上游才显徽标；无上游首推自动 -u） */}
          {review.remoteSync?.upstream && (
            <span className="rvw-sync-badge" title={`上游 ${review.remoteSync.upstream}`}>
              {(review.remoteSync.ahead ?? 0) > 0 && <span className="rvw-sync-ahead">↑{review.remoteSync.ahead}</span>}
              {(review.remoteSync.behind ?? 0) > 0 && <span className="rvw-sync-behind">↓{review.remoteSync.behind}</span>}
              {(review.remoteSync.ahead ?? 0) === 0 && (review.remoteSync.behind ?? 0) === 0 && <span>已同步</span>}
            </span>
          )}
          <button
            type="button"
            className="wt-icon-btn"
            onClick={() => { setSyncBusy('pull'); void review.pullRemote().finally(() => setSyncBusy(null)); }}
            disabled={syncBusy !== null}
            title={review.remoteSync?.upstream ? `拉取（${review.remoteSync.upstream}）` : '无上游分支，无法拉取'}
            aria-label="拉取"
            data-testid="rvw-pull-btn"
          >
            <Icon name="download" size={13} />
          </button>
          <button
            type="button"
            className="wt-icon-btn"
            onClick={() => { setSyncBusy('push'); void review.pushRemote().finally(() => setSyncBusy(null)); }}
            disabled={syncBusy !== null}
            title={review.remoteSync?.upstream ? `推送（${review.remoteSync.upstream}）` : '推送到远程并建立跟踪'}
            aria-label="推送"
            data-testid="rvw-push-btn"
          >
            <Icon name="arrow-up" size={13} />
          </button>
          {/* BLOCK-29.6 UI-243 — 快捷键提示收进 info tooltip，不再常驻占地 */}
          <span
            className="rvw-help-btn"
            title="快捷键：A/Y 接受 · R 拒绝 · ↑↓ 切换 hunk · Esc 退出"
            aria-label="快捷键说明"
          >
            <Icon name="info" size={13} />
          </span>
          {/* BLOCK-29.6 UI-243 — 刷新 icon 化 */}
          <button
            type="button"
            className="wt-icon-btn"
            onClick={() => void review.refresh()}
            title="刷新工作区差异"
            aria-label="刷新"
          >
            <Icon name="refresh" size={13} />
          </button>
          {/* BLOCK-176 CP-17 — 安全网：审阅/还原前无副作用快照 + 会话内回滚 */}
          <button
            type="button"
            className="wt-btn"
            onClick={() => void handleCheckpointCreate()}
            disabled={checkpointBusy}
            title="创建无副作用快照（不动工作树/暂存区/提交历史）"
            data-testid="checkpoint-create"
          >
            快照
          </button>
          {hasCheckpoint && (
            <button
              type="button"
              className="wt-btn"
              onClick={() => void handleCheckpointRollback()}
              disabled={checkpointBusy}
              title="回滚到最近快照（恢复跟踪文件+清理快照后新增文件）"
              data-testid="checkpoint-rollback"
            >
              回滚快照
            </button>
          )}
          {checkpointNotice && (
            <span style={{ color: 'var(--petri-text-tertiary)', fontSize: 12 }} role="status" data-testid="checkpoint-notice">{checkpointNotice}</span>
          )}
          <button
            type="button"
            className="wt-btn wt-btn-danger"
            onClick={() => void review.revertAll()}
            disabled={!review.status || review.status.files.length === 0}
          >
            全部还原
          </button>
          <button
            type="button"
            className={`wt-btn wt-btn-commit${!hasDecisions ? ' wt-btn-disabled' : ''}`}
            onClick={handleCommitReviewClick}
            disabled={!hasDecisions}
            title={
              hasDecisions
                ? `提交 ${decisionCount} 个决策：${acceptedCount} 接受，${rejectedCount} 拒绝`
                : '请先审阅（接受或拒绝 hunk）'
            }
          >
            提交审阅{hasDecisions ? ` (${decisionCount})` : ''}
          </button>
          {/* UI-247 — 历史 ⋯ 溢出菜单（收纳破坏性「撤销上次提交」）随行内控件并入顶部行 */}
          {review.historyView === 'history' && (
            <div className="rvw-history-menu">
              <button
                type="button"
                className="wt-icon-btn"
                aria-label="更多历史操作"
                aria-haspopup="menu"
                aria-expanded={historyMenuOpen}
                title="更多操作"
                onClick={() => setHistoryMenuOpen((open) => !open)}
              >
                ⋯
              </button>
              {historyMenuOpen && (
                <>
                  <div
                    className="rvw-menu-backdrop"
                    onClick={() => setHistoryMenuOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="rvw-overflow-menu" role="menu" aria-label="历史操作菜单">
                    <button
                      type="button"
                      role="menuitem"
                      className="rvw-overflow-menu-item rvw-overflow-menu-item--danger"
                      disabled={review.commitsLoading || !review.commits || review.commits.length === 0}
                      title="撤销最近一次提交（内容回到工作区）"
                      onClick={() => {
                        setHistoryMenuOpen(false);
                        if (window.confirm('撤销最近一次提交？提交内容将回到工作区，可重新审阅。')) {
                          void review.undoLastCommit();
                        }
                      }}
                    >
                      撤销上次提交
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {/* UI-260/261 — dock 最右侧：文件树开合（chevron + 文件夹，替换退出按钮；关面板走 tab × / Esc）；
              主区 /review 形态仍保留退出按钮 */}
          {isDock && totalFiles > 0 ? (
            <button
              type="button"
              className="wt-icon-btn rvw-tree-toggle-btn"
              onClick={() => setDockTreeOpen((v) => !v)}
              aria-pressed={dockTreeOpen}
              title={dockTreeOpen ? '收起文件树' : '展开文件树'}
              aria-label={dockTreeOpen ? '收起文件树' : '展开文件树'}
            >
              <span className={`rvw-caret${dockTreeOpen ? '' : ' rvw-caret-collapsed'}`}>
                <span className="rvw-caret-icon"><Icon name="chevron-down" size={12} /></span>
              </span>
              <WorkspaceFileIcon name="" type="dir" />
            </button>
          ) : (
            <button
              type="button"
              className="wt-icon-btn rvw-exit-btn"
              onClick={() => (isDock && onClose ? onClose() : exitReviewMode())}
              title={isDock ? '关闭审阅面板 (Esc)' : '退出审阅模式'}
              aria-label="退出审阅"
              data-testid="rvw-exit-button"
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      </header>
      {totalFiles > 0 && (
        <div className="rvw-progress-track" aria-hidden="true">
          <div
            className="rvw-progress-fill"
            style={{ width: `${totalFiles ? (reviewedCount / totalFiles) * 100 : 0}%` }}
          />
        </div>
      )}

      {review.error && (
        <div className="wt-error" role="alert">{review.error}</div>
      )}
      {/* BLOCK-41 — 分支切换失败（脏树拒绝等）：错误信息 + 冲突文件清单 */}
      {checkoutError && (
        <div className="wt-error rvw-checkout-error" role="alert" data-testid="rvw-checkout-error">
          <div>{checkoutError.message}</div>
          {checkoutError.conflicts.length > 0 && (
            <ul className="rvw-checkout-conflicts">
              {checkoutError.conflicts.map((p) => (
                <li key={p} className="rvw-checkout-conflict-path">{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={`rvw-body${isDock ? ' rvw-body--dock' : ''}`}>
        {review.historyView === 'history' && (
          <>
            {/* UI-249 — BLOCK-29.5 两提交区间对比（对比按钮 + compareMode 视图）已按用户裁决移除：
                低频且入口语义不自明；`git:commit-diff` IPC 保留（历史提交展开详情仍消费） */}
            <div className="rvw-history-list" data-testid="rvw-history-list">
              {/* UI-247 — 历史第二行（rvw-history-head：过滤徽标/分支/⋯）已并入顶部 summary 行 */}
              {/* BLOCK-29.5 — stash 只读列表（有内容才显示，不含写操作） */}
              {review.stashes && review.stashes.length > 0 && (
                <div className="rvw-stash-list" data-testid="rvw-stash-list">
                  {review.stashes.map((s) => (
                    <div key={s.ref} className="rvw-stash-row" title={s.subject}>
                      <span className="rvw-blame-sha">{s.ref}</span>
                      <span className="rvw-history-subject">{s.subject}</span>
                      <span className="rvw-history-meta">{formatCommitDate(s.isoDate)}</span>
                    </div>
                  ))}
                </div>
              )}
              {review.commitsLoading && <div className="wt-diff-loading">提交历史加载中…</div>}
              {review.commits && review.commits.length === 0 && (
                <div className="wt-empty">{review.historyFileFilter ? '该文件暂无提交记录。' : '暂无提交记录。'}</div>
              )}
              {review.commits?.map((c) => {
                // UI-234 — 统计默认随 log 到达；展开回退（旧桥桩无 stats 时）仍走 commitSummaries
                const rowStats = c.stats ?? commitSummaries[c.sha] ?? null;
                return (
                <Fragment key={c.sha}>
                  <button
                    type="button"
                    className="rvw-history-row"
                    aria-expanded={expandedCommits.has(c.sha)}
                    onClick={() => {
                      setExpandedCommits((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.sha)) next.delete(c.sha);
                        else next.add(c.sha);
                        return next;
                      });
                    }}
                    title={c.subject}
                  >
                    <span className="rvw-history-sha">{c.shortSha}</span>
                    <span className="rvw-history-subject">{c.subject}</span>
                    {rowStats && (
                      <span className="rvw-history-row-stats" title="该提交改动统计">
                        {rowStats.files} 文件
                        <span className="rvw-stat-add">+{rowStats.added}</span>
                        <span className="rvw-stat-del">−{rowStats.removed}</span>
                      </span>
                    )}
                    <span className="rvw-history-meta">{c.author} · {formatCommitDate(c.isoDate)}</span>
                  </button>
                  {expandedCommits.has(c.sha) && (
                    <ExpandedCommitDetail
                      commit={c}
                      onSummary={(s) => setCommitSummaries((prev) => ({ ...prev, [c.sha]: s }))}
                    />
                  )}
                </Fragment>
                );
              })}
              {review.hasMoreHistory && !review.commitsLoading && (
                <button
                  type="button"
                  className="rvw-history-more"
                  onClick={() => void review.loadHistory({ skip: review.commits?.length ?? 0, append: true })}
                >
                  加载更多
                </button>
              )}
            </div>
          </>
        )}
        {review.historyView === 'changes' && (<>
        {isDock ? (
          <div className="rvw-dock-split">
          <div className="rvw-accordion" data-testid="rvw-file-list" role="list" aria-label="改动文件">
            {review.status && review.status.files.length === 0 && (
              <div className="wt-empty">暂无工作区改动。</div>
            )}
            {/* BLOCK-41 — 暂存两栏分组（porcelain X）：staged 行 diff 走 HEAD→index，unstaged 行走组合 diff */}
            {([
              { key: 'staged', label: '暂存的更改', sectionIcon: 'minus' as const, groups: stagedGroups },
              { key: 'unstaged', label: '更改', sectionIcon: 'plus' as const, groups: unstagedGroups },
            ]).filter((section) => section.groups.length > 0).map((section) => (
              <div key={section.key} className={`rvw-stage-section rvw-stage-section--${section.key}`} data-testid={`rvw-section-${section.key}`}>
                <div className="rvw-stage-section-title">
                  <Icon name={section.sectionIcon} size={12} />
                  <span>{section.label}</span>
                  <span className="rvw-group-count">{section.groups.reduce((n, g) => n + g.files.length, 0)}</span>
                </div>
            {section.groups.map((group) => {
              const collapsed = !!collapsedDirs[group.dir];
              return (
                <div key={group.dir || '/'} className="rvw-acc-group">
                  <button
                    type="button"
                    className="rvw-group-header"
                    onClick={() => toggleDir(group.dir)}
                    aria-expanded={!collapsed}
                    title={group.dir || '（根目录）'}
                  >
                    <span className={`rvw-caret${collapsed ? ' rvw-caret-collapsed' : ''}`}>
                      <span className="rvw-caret-icon"><Icon name="chevron-down" size={12} /></span>
                    </span>
                    <span className="rvw-group-name">{groupDisplayName(group.dir)}</span>
                    <span className="rvw-group-count">{group.files.length}</span>
                  </button>
                  {!collapsed && (
                    <div className="rvw-acc-group-files">
                      {group.files.map((f) => {
                        const diffFile = diffForStatusFile(f);
                        const stats = computeFileDiffStats(diffFile);
                        const reviewed = isFileReviewed(diffFile, review.decisions);
                        const selected = review.selectedFilePath === f.path;
                        const expanded = expandedPaths.has(f.path);
                        const fileName = f.path.slice(f.path.lastIndexOf('/') + 1);
                        return (
                          <div
                            key={f.path}
                            className={`rvw-acc-item rvw-acc-item--nested${selected ? ' active' : ''}${reviewed ? ' rvw-file-reviewed' : ''}`}
                          >
                            <button
                              type="button"
                              className="rvw-acc-row"
                              aria-expanded={expanded}
                              data-acc-path={f.path}
                              onClick={() => toggleAccordionRow(f.path)}
                              onMouseEnter={(e) => {
                                // 行内 diff 已展开时不弹悬浮预览（信息重复）
                                if (!expandedPaths.has(f.path)) scheduleHoverPreview(f.path, e.currentTarget);
                              }}
                              onMouseLeave={scheduleHoverClose}
                              title={f.path}
                            >
                              <span className={`rvw-caret${expanded ? '' : ' rvw-caret-collapsed'}`}>
                                <span className="rvw-caret-icon"><Icon name="chevron-down" size={12} /></span>
                              </span>
                              <WorkspaceFileIcon name={f.path} type="file" />
                              <span className="rvw-acc-name">{fileName}</span>
                              {reviewed ? (
                                <span className="rvw-reviewed-mark"><Icon name="check" size={12} /></span>
                              ) : (stats.added > 0 || stats.removed > 0) ? (
                                <span className="rvw-file-stats">
                                  {stats.added > 0 && <span className="rvw-stat-add">+{stats.added}</span>}
                                  {stats.removed > 0 && <span className="rvw-stat-del">−{stats.removed}</span>}
                                </span>
                    ) : null}
                    {/* BLOCK-41 — 行内 stage/unstage（staged 行取消暂存，unstaged 行暂存） */}
                    <span
                      role="button"
                      tabIndex={-1}
                      className="rvw-acc-action rvw-acc-action-stage"
                      title={f.staged ? '取消暂存' : '暂存'}
                      aria-label={f.staged ? `取消暂存 ${fileName}` : `暂存 ${fileName}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void (f.staged ? review.unstagePaths([f.path]) : review.stagePaths([f.path]));
                      }}
                    >
                      <Icon name={f.staged ? 'minus' : 'plus'} size={12} />
                    </span>
                    {/* BLOCK-29.2 — 行内操作：查看该文件历史 / 放弃更改（span 嵌于按钮行内） */}
                    {/* BLOCK-29.6 UI-243 — 行内「编辑」取代原 summary 全局按钮（已知二进制才隐藏） */}
                    {!diffFile?.binary && (
                      <span
                        role="button"
                        tabIndex={-1}
                        className="rvw-acc-action rvw-acc-action-edit"
                        title={`在行内编辑器中打开 ${fileName}`}
                        aria-label={`编辑 ${fileName}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsEditDrawerOpen(true);
                        }}
                      >
                        <Icon name="wrench" size={12} />
                      </span>
                    )}
                    <span
                      role="button"
                      tabIndex={-1}
                      className="rvw-acc-action"
                      title="查看该文件的历史提交"
                      aria-label={`查看 ${fileName} 的历史提交`}
                      onClick={(e) => {
                        e.stopPropagation();
                        review.setHistoryView('history');
                        void review.loadHistory({ file: f.path });
                      }}
                    >
                      <Icon name="clock" size={12} />
                    </span>
                    <span
                      role="button"
                      tabIndex={-1}
                      className="rvw-acc-action rvw-acc-action-danger"
                      title="放弃更改（未跟踪文件将被删除）"
                      aria-label={`放弃对 ${fileName} 的更改`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`放弃对 ${fileName} 的更改？未跟踪文件将被删除，此操作不可撤销。`)) {
                          void review.discardFile(f.path);
                        }
                      }}
                    >
                      <Icon name="trash" size={12} />
                    </span>
                  </button>
                  {expanded && (
                    <div className="rvw-acc-diff">
                      {diffFile ? (
                        <CodeMirrorDiffView
                          filePath={f.path}
                          isBinary={diffFile.binary}
                          hunks={diffFile.hunks}
                          hunkDecisions={hunkDecisionList(diffFile, review.decisions)}
                          onAcceptHunk={(i) => void review.decideHunk(f.path, i, 'accept')}
                          onRejectHunk={(i) => void review.decideHunk(f.path, i, 'reject')}
                          focusedHunkIndex={review.selectedFilePath === f.path ? focusedHunk : -1}
                        />
                      ) : (
                        <UntrackedFilePreview path={f.path} />
                      )}
                    </div>
                  )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
              </div>
            ))}
          </div>
          {/* UI-254/260 — 右侧文件树：按钮切换显示（默认收起），树仅作导航（点击=展开/收起左侧行并滚动定位） */}
          {isDock && dockTreeOpen && (
          <aside className="rvw-dock-tree" data-testid="rvw-dock-tree" aria-label="改动文件树">
            <div className="rvw-dock-tree-title">文件树</div>
            {fileGroups.map((group) => {
              const collapsed = !!collapsedDirs[group.dir];
              return (
                <div key={group.dir || '/'} className="rvw-dock-tree-group">
                  <button
                    type="button"
                    className="rvw-dock-tree-dir"
                    aria-expanded={!collapsed}
                    title={group.dir || '（根目录）'}
                    onClick={() => toggleDir(group.dir)}
                  >
                    <span className={`rvw-caret${collapsed ? ' rvw-caret-collapsed' : ''}`}>
                      <span className="rvw-caret-icon"><Icon name="chevron-down" size={12} /></span>
                    </span>
                    <span className="rvw-group-name">{groupDisplayName(group.dir)}</span>
                    <span className="rvw-group-count">{group.files.length}</span>
                  </button>
                  {!collapsed && group.files.map((f) => {
                    const diffFile = diffByPath.get(f.path);
                    const stats = computeFileDiffStats(diffFile);
                    const reviewed = isFileReviewed(diffFile, review.decisions);
                    const fileName = f.path.slice(f.path.lastIndexOf('/') + 1);
                    const rowExpanded = expandedPaths.has(f.path);
                    return (
                      <button
                        key={f.path}
                        type="button"
                        className={`rvw-dock-tree-file${review.selectedFilePath === f.path ? ' active' : ''}${reviewed ? ' rvw-file-reviewed' : ''}`}
                        aria-expanded={rowExpanded}
                        title={f.path}
                        onClick={() => openFileFromTree(f.path)}
                      >
                        <WorkspaceFileIcon name={f.path} type="file" />
                        <span className="rvw-dock-tree-file-name">{fileName}</span>
                        {reviewed ? (
                          <span className="rvw-reviewed-mark"><Icon name="check" size={12} /></span>
                        ) : (stats.added > 0 || stats.removed > 0) ? (
                          <span className="rvw-file-stats">
                            {stats.added > 0 && <span className="rvw-stat-add">+{stats.added}</span>}
                            {stats.removed > 0 && <span className="rvw-stat-del">−{stats.removed}</span>}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </aside>
          )}
          </div>
        ) : (
        <aside className="rvw-sidebar" data-testid="rvw-file-list">
          <div className="wt-file-list-title">
            文件 ({review.status?.totalFiles ?? 0})
          </div>
          {review.status && review.status.files.length === 0 && (
            <div className="wt-empty">暂无工作区改动。</div>
          )}
          {/* BLOCK-41 — 暂存两栏分组（porcelain X）：staged 行 diff 走 HEAD→index，unstaged 行走组合 diff */}
          {([
            { key: 'staged', label: '暂存的更改', sectionIcon: 'minus' as const, groups: stagedGroups },
            { key: 'unstaged', label: '更改', sectionIcon: 'plus' as const, groups: unstagedGroups },
          ]).filter((section) => section.groups.length > 0).map((section) => (
            <div key={section.key} className={`rvw-stage-section rvw-stage-section--${section.key}`} data-testid={`rvw-section-${section.key}`}>
              <div className="rvw-stage-section-title">
                <Icon name={section.sectionIcon} size={12} />
                <span>{section.label}</span>
                <span className="rvw-group-count">{section.groups.reduce((n, g) => n + g.files.length, 0)}</span>
              </div>
          {section.groups.map((group) => {
            const collapsed = !!collapsedDirs[group.dir];
            return (
              <div key={group.dir || '/'} className="rvw-group">
                <button
                  type="button"
                  className="rvw-group-header"
                  onClick={() => toggleDir(group.dir)}
                  aria-expanded={!collapsed}
                >
                  <span className={`rvw-caret${collapsed ? ' rvw-caret-collapsed' : ''}`}>
                    <span className="rvw-caret-icon"><Icon name="chevron-down" size={12} /></span>
                  </span>
                  <span className="rvw-group-name">{groupDisplayName(group.dir)}</span>
                  <span className="rvw-group-count">{group.files.length}</span>
                </button>
                {!collapsed &&
                  group.files.map((f) => {
                    const diffFile = diffForStatusFile(f);
                    const stats = computeFileDiffStats(diffFile);
                    const reviewed = isFileReviewed(diffFile, review.decisions);
                    const summary = fileDecisionSummary(f.path);
                    const fileName = f.path.slice(f.path.lastIndexOf('/') + 1);
                    return (
                      <button
                        key={f.path}
                        type="button"
                        className={`wt-file-list-item rvw-file-row ${review.selectedFilePath === f.path ? 'active' : ''}${reviewed ? ' rvw-file-reviewed' : ''}`}
                        onClick={() => review.setSelectedFilePath(f.path)}
                        onMouseEnter={(e) => {
                          // 选中文件的 diff 已在主区展示，不弹悬浮预览（信息重复）
                          if (review.selectedFilePath !== f.path) scheduleHoverPreview(f.path, e.currentTarget);
                        }}
                        onMouseLeave={scheduleHoverClose}
                        title={f.path}
                      >
                        <span className={`wt-file-status wt-file-status-${f.status}`}>{f.status}</span>
                        <span className="rvw-file-icon"><Icon name="file" size={13} /></span>
                        <span className="wt-file-list-path">{fileName}</span>
                        <span className="wt-file-list-badge">
                          {summary && summary.accepted > 0 && (
                            <span className="wt-badge-mini wt-badge-accept-mini">{summary.accepted}</span>
                          )}
                          {summary && summary.rejected > 0 && (
                            <span className="wt-badge-mini wt-badge-reject-mini">{summary.rejected}</span>
                          )}
                          {reviewed && (
                            <span className="rvw-reviewed-mark" title="Reviewed"><Icon name="check" size={12} /></span>
                          )}
                        </span>
                        {!reviewed && (stats.added > 0 || stats.removed > 0) && (
                          <span className="rvw-file-stats">
                            {stats.added > 0 && <span className="rvw-stat-add">+{stats.added}</span>}
                            {stats.removed > 0 && <span className="rvw-stat-del">−{stats.removed}</span>}
                          </span>
                        )}
                        {/* BLOCK-41 — 行内 stage/unstage（span 嵌于按钮行内） */}
                        <span
                          role="button"
                          tabIndex={-1}
                          className="rvw-acc-action rvw-acc-action-stage"
                          title={f.staged ? '取消暂存' : '暂存'}
                          aria-label={f.staged ? `取消暂存 ${fileName}` : `暂存 ${fileName}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void (f.staged ? review.unstagePaths([f.path]) : review.stagePaths([f.path]));
                          }}
                        >
                          <Icon name={f.staged ? 'minus' : 'plus'} size={12} />
                        </span>
                      </button>
                    );
                  })}
              </div>
            );
          })}
            </div>
          ))}
        </aside>
        )}

        {/* 右栏大空间 diff（仅 mode 变体；dock 为手风琴行内 diff） */}
        {!isDock && (
        <main className="rvw-diff-area" data-testid="rvw-diff-area">
          {!selectedFile && !review.loading && !review.error && (
            <div className="rvw-empty-state">
              <span className="rvw-empty-icon"><Icon name="git-branch" size={22} /></span>
              <span className="rvw-empty-title">审阅</span>
              <span className="rvw-empty-hint">
                在这里审阅工作区改动：接受或拒绝 hunk，然后提交。
                A/Y 接受 · R 拒绝 · ↑↓ 切换 hunk。
              </span>
            </div>
          )}
          {selectedFile && (
            <div className="rvw-file">
              <div className="wt-file-header rvw-file-header">
                <span className={`wt-file-status wt-file-status-${review.status?.files.find((s) => s.path === selectedFile.path)?.status ?? '?'}`}>
                  {review.status?.files.find((s) => s.path === selectedFile.path)?.status ?? '?'}
                </span>
                <span className="wt-file-path">{selectedFile.path}</span>
                {selectedFile.oldPath && selectedFile.oldPath !== selectedFile.path && (
                  <span className="wt-file-old-path">← {selectedFile.oldPath}</span>
                )}
                <span className="rvw-file-stats">
                  <span className="rvw-stat-add">+{computeFileDiffStats(selectedFile).added}</span>
                  <span className="rvw-stat-del">−{computeFileDiffStats(selectedFile).removed}</span>
                </span>
                <span className="wt-file-hunk-count">{selectedFile.hunks.length} 个 hunk</span>
                {/* BLOCK-29.6 UI-243 — 编辑动作移到文件头行内（选中非二进制才出现） */}
                {!selectedFile.binary && (
                  <button
                    type="button"
                    className="wt-btn rvw-inline-edit-btn"
                    onClick={() => setIsEditDrawerOpen(true)}
                    title={`在行内编辑器中打开 ${selectedFile.path}`}
                  >
                    编辑
                  </button>
                )}
              </div>
              <CodeMirrorDiffView
                filePath={selectedFile.path}
                isBinary={selectedFile.binary}
                hunks={selectedFile.hunks}
                hunkDecisions={hunkDecisionList(selectedFile, review.decisions)}
                onAcceptHunk={(i) => void review.decideHunk(selectedFile.path, i, 'accept')}
                onRejectHunk={(i) => void review.decideHunk(selectedFile.path, i, 'reject')}
                focusedHunkIndex={focusedHunk}
              />
            </div>
          )}
        </main>
        )}
        </>)}
      </div>

      {/* BLOCK-28.9 — 底部提交条按需出现：有审阅决策才显示（单行紧凑条），
          无决策时隐藏底部输入框（用户反馈：不需要常驻输入框） */}
      {hasDecisions && (
        <footer className="rvw-commitbox" data-testid="rvw-commitbox">
          <div className="rvw-commitbox-meta">
            <span className="rvw-commitbox-stat">接受 {acceptedCount}</span>
            <span className="rvw-commitbox-stat rvw-commitbox-stat-reject">拒绝 {rejectedCount}</span>
            {review.pendingCount > 0 && (
              <span className="rvw-commitbox-stat rvw-commitbox-stat-pending" data-testid="rvw-pending-stat">
                待定 {review.pendingCount}
              </span>
            )}
            {review.diff?.truncated && <span className="wt-warning">输出已截断</span>}
            {review.loading && <span>加载中…</span>}
            {commitError && (
              <span className="rvw-commitbox-error" role="alert">{commitError}</span>
            )}
          </div>
          <input
            ref={textareaRef}
            className="rvw-commitbox-input"
            type="text"
            value={commitMsg}
            onChange={(e) => {
              setCommitMsg(e.target.value);
              if (commitError) setCommitError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleCommitConfirm();
              }
            }}
            placeholder={`提交信息（⌘+Enter 提交：接受 ${acceptedCount}，拒绝 ${rejectedCount}）`}
            aria-label="提交信息"
          />
          <button
            type="button"
            className={`wt-btn wt-btn-commit${!commitMsg.trim() ? ' wt-btn-disabled' : ''}`}
            onClick={() => void handleCommitConfirm()}
            disabled={!commitMsg.trim() || review.loading}
            title={`提交 ${decisionCount} 个决策：${acceptedCount} 接受，${rejectedCount} 拒绝`}
          >
            {review.loading ? '提交中…' : `提交 (${decisionCount})`}
          </button>
        </footer>
      )}

      {/* BLOCK-41 — staged 栏提交框：有暂存文件才出现（按需，单行 + ⌘Enter，空信息禁用） */}
      {review.historyView === 'changes' && stagedFiles.length > 0 && (
        <footer className="rvw-commitbox rvw-commitbox--staged" data-testid="rvw-staged-commitbox">
          <div className="rvw-commitbox-meta">
            <span className="rvw-commitbox-stat">暂存 {stagedFiles.length} 个文件</span>
            {stagedCommitError && (
              <span className="rvw-commitbox-error" role="alert">{stagedCommitError}</span>
            )}
          </div>
          <input
            className="rvw-commitbox-input"
            type="text"
            value={stagedCommitMsg}
            onChange={(e) => {
              setStagedCommitMsg(e.target.value);
              if (stagedCommitError) setStagedCommitError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleStagedCommitGuarded();
              }
            }}
            placeholder={`提交信息（⌘+Enter 提交暂存的 ${stagedFiles.length} 个文件）`}
            aria-label="暂存区提交信息"
          />
          <button
            type="button"
            className={`wt-btn wt-btn-commit${!stagedCommitMsg.trim() ? ' wt-btn-disabled' : ''}`}
            onClick={() => void handleStagedCommitGuarded()}
            disabled={!stagedCommitMsg.trim() || stagedCommitting}
            title={`提交暂存的 ${stagedFiles.length} 个文件`}
          >
            {stagedCommitting ? '提交中…' : '提交暂存'}
          </button>
        </footer>
      )}

      {/* 行内编辑抽屉（复用，非旧侧边抽屉） */}
      <CodeReviewDrawer
        isOpen={isEditDrawerOpen}
        onClose={() => {
          setIsEditDrawerOpen(false);
          // Refresh working tree so the diff reflects the saved content
          void review.refresh();
        }}
        filePath={review.selectedFilePath}
        workspacePath={null}
      />

      {/* UI-250/UI-255 — 文件行悬停浮动预览：只读 diff/内容 + 状态统计头（定位/尺寸自适应） */}
      {hoverPreview && (() => {
        // BLOCK-41 — staged 文件预览走 staged diff（HEAD→index）
        const previewDiff = diffForStatusFile({
          path: hoverPreview.path,
          staged: review.status?.files.some((f) => f.path === hoverPreview.path && f.staged) ?? false,
        });
        const previewStatus = review.status?.files.find((f) => f.path === hoverPreview.path);
        const previewStats = computeFileDiffStats(previewDiff);
        return (
          <HoverPreviewPopover
            anchor={hoverPreview.anchor}
            testid="rvw-hover-preview"
            className="rvw-hover-preview"
            onMouseEnter={cancelHoverTimers}
            onMouseLeave={scheduleHoverClose}
          >
            <div className="rvw-hover-preview-head">
              <span className={`wt-file-status wt-file-status-${previewStatus?.status ?? '?'}`}>
                {previewStatus?.status ?? '?'}
              </span>
              <span className="rvw-hover-preview-path" title={hoverPreview.path}>{hoverPreview.path}</span>
              <span className="rvw-file-stats">
                <span className="rvw-stat-add">+{previewStats.added}</span>
                <span className="rvw-stat-del">−{previewStats.removed}</span>
              </span>
            </div>
            <div className="rvw-hover-preview-body">
              {previewDiff && !previewDiff.binary ? (
                <CodeMirrorDiffView
                  filePath={hoverPreview.path}
                  isBinary={false}
                  hunks={previewDiff.hunks}
                />
              ) : previewDiff?.binary ? (
                <div className="wt-empty">二进制文件，无文本差异可预览。</div>
              ) : (
                <UntrackedFilePreview path={hoverPreview.path} />
              )}
            </div>
          </HoverPreviewPopover>
        );
      })()}
    </div>
  );
}

// UI-305 P2 - extracted inline components now live in sibling files:
import { ExpandedCommitDetail } from './ExpandedCommitDetail';
import { UntrackedFilePreview } from './UntrackedFilePreview';
import { formatCommitDate, type CommitSuccess } from './reviewModeHelpers';
