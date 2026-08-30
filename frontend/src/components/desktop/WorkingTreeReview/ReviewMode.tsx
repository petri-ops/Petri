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

import { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { getBridge } from '@/lib/desktopBridge';
import type { DiffRevision } from '@/components/editor/CodeMirror/types';
import { WorkspaceFileIcon } from '@/components/workspace-panels/WorkspaceFileIcon';
import { useWorkingTreeReview, type DiffFile } from './useWorkingTreeReview';
import { CodeMirrorDiffView } from './CodeMirrorDiffView';
import { CodeReviewDrawer } from './CodeReviewDrawer';
import {
  computeFileDiffStats,
  groupDisplayName,
  groupFilesByDirectory,
  isFileReviewed,
} from './reviewModeHelpers';
import './WorkingTreeReview.css';
import './ReviewMode.css';

interface CommitSuccess {
  commit: string | null;
  files: string[];
  message: string;
}

/**
 * BLOCK-29 — 提交内单文件只读 diff：经 commitFileContent 取两版全文，
 * 组装 DiffRevision 交 CodeMirrorDiffView（revisionOverride，无 accept/reject 控件）。
 */
function CommitDiffFileView({ hash, file }: { hash: string; file: DiffFile }) {
  const [revision, setRevision] = useState<DiffRevision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (file.binary) return;
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRevision(null);
    bridge.commitFileContent({ hash, path: file.path })
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data) {
          setRevision({
            filePath: file.path,
            originalText: res.data.original,
            modifiedText: res.data.modified,
          });
        } else {
          setError(res.message || res.error || '加载提交文件内容失败。');
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [hash, file.path, file.binary]);

  if (file.binary) return <div className="wt-file-binary">二进制文件变更</div>;
  if (loading) return <div className="wt-diff-loading">差异加载中…</div>;
  if (error) return <div className="wt-diff-error" role="alert">{error}</div>;
  if (!revision) return null;
  return (
    <CodeMirrorDiffView
      filePath={file.path}
      isBinary={file.binary}
      hunks={file.hunks}
      revisionOverride={revision}
    />
  );
}

function formatCommitDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export interface ReviewModeProps {
  /**
   * BLOCK-28.2 — 呈现形态：
   * - 'mode'（默认）：主区一级模式（/review 路由，占满 main 区域）
   * - 'dock'：右侧停靠面板（wt-dock 容器内，文件条横向、diff 最大化）
   */
  variant?: 'mode' | 'dock';
  /** dock 形态的关闭回调（Esc / 关闭动作触发）。 */
  onClose?: () => void;
}

export function ReviewMode({ variant = 'mode', onClose }: ReviewModeProps) {
  const navigate = useNavigate();
  const isDock = variant === 'dock';
  const review = useWorkingTreeReview({ isOpen: true });

  const [commitMsg, setCommitMsg] = useState('');
  const [commitSuccess, setCommitSuccess] = useState<CommitSuccess | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const [focusedHunk, setFocusedHunk] = useState(0);
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({});
  const textareaRef = useRef<HTMLInputElement>(null);

  // BLOCK-29.1 — dock 手风琴：每文件一行，点击展开/收起行内 diff。
  // selectedFilePath 变化（聊天卡片跳转等）时自动展开对应行。
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const target = review.selectedFilePath;
    if (!target) return;
    setExpandedPaths((prev) => (prev.has(target) ? prev : new Set(prev).add(target)));
  }, [review.selectedFilePath]);
  const toggleAccordionRow = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    review.setSelectedFilePath(path);
  };

  const exitReviewMode = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
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
    const file = review.diff?.files.find((f) => f.path === review.selectedFilePath) || null;
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
        const key = `${file.path}#${focusedHunk}`;
        if (review.decisions[key] !== 'accept') void review.decideHunk(file.path, focusedHunk, 'accept');
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        void review.decideHunk(file.path, focusedHunk, 'reject');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [review, focusedHunk]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedFile = review.diff?.files.find((f) => f.path === review.selectedFilePath) || null;

  // P2 — diff 文件索引 + 目录分组 + 已审进度
  const diffByPath = useMemo(() => {
    const map = new Map<string, DiffFile>();
    for (const f of review.diff?.files ?? []) map.set(f.path, f);
    return map;
  }, [review.diff]);

  const statusFiles = review.status?.files ?? [];
  const fileGroups = useMemo(() => groupFilesByDirectory(statusFiles), [review.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const reviewedCount = useMemo(
    () => statusFiles.filter((f) => isFileReviewed(diffByPath.get(f.path), review.decisions)).length,
    [statusFiles, diffByPath, review.decisions]
  );
  const totalFiles = statusFiles.length;

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
              }}
            >
              历史
            </button>
          </div>
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
          {review.taskId && <span className="wt-task-id">task: {review.taskId}</span>}
        </div>
        <div className="rvw-summary-actions">
          <span className="wt-shortcut-hint">
            <kbd>A</kbd>/<kbd>Y</kbd> 接受 &nbsp;
            <kbd>R</kbd> 拒绝 &nbsp;
            <kbd>↑↓</kbd> 切换 &nbsp;
            <kbd>Esc</kbd> 退出
          </span>
          <button
            type="button"
            className="wt-btn wt-edit-btn"
            onClick={() => setIsEditDrawerOpen(true)}
            disabled={!selectedFile || selectedFile.binary}
            title={
              selectedFile?.binary
                ? '二进制文件 — 无法行内编辑'
                : selectedFile
                  ? `在行内编辑器中打开 ${selectedFile.path}`
                  : '请先选择文件'
            }
          >
            编辑文件
          </button>
          <button
            type="button"
            className="wt-btn"
            onClick={() => void review.refresh()}
            title="刷新工作区差异"
          >
            刷新
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
            className="wt-btn wt-exit-btn"
            onClick={() => (isDock && onClose ? onClose() : exitReviewMode())}
            title={isDock ? '关闭审阅面板 (Esc)' : '退出审阅模式'}
            aria-label="退出审阅"
            data-testid="rvw-exit-button"
          >
            <Icon name="x" size={13} />
            退出
          </button>
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

      <div className={`rvw-body${isDock ? ' rvw-body--dock' : ''}`}>
        {review.historyView === 'history' && (
          review.selectedCommit ? (
            <>
              {/* BLOCK-29 — 提交内：文件条 + 只读 diff（vs 第一父提交） */}
              <div className="rvw-filestrip" role="tablist" aria-label="提交改动文件">
                <button
                  type="button"
                  className="rvw-history-back"
                  onClick={review.backToCommitList}
                  title="返回提交历史"
                >
                  ← 返回历史
                </button>
                {(review.commitDiff?.files ?? []).map((f) => {
                  const stats = computeFileDiffStats(f);
                  const selected = review.selectedCommitFilePath === f.path;
                  const fileName = f.path.slice(f.path.lastIndexOf('/') + 1);
                  return (
                    <button
                      key={f.path}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      className={`rvw-filechip${selected ? ' active' : ''}`}
                      onClick={() => review.setSelectedCommitFilePath(f.path)}
                      title={f.path}
                    >
                      <span className="rvw-filechip-name">{fileName}</span>
                      {(stats.added > 0 || stats.removed > 0) && (
                        <span className="rvw-file-stats">
                          {stats.added > 0 && <span className="rvw-stat-add">+{stats.added}</span>}
                          {stats.removed > 0 && <span className="rvw-stat-del">−{stats.removed}</span>}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <main className="rvw-diff-area" data-testid="rvw-commit-diff-area">
                {review.commitDiffLoading && <div className="wt-diff-loading">提交差异加载中…</div>}
                {!review.commitDiffLoading && (() => {
                  const file = review.commitDiff?.files.find((f) => f.path === review.selectedCommitFilePath) || null;
                  if (!file) {
                    return <div className="wt-empty">该提交没有可显示的文件差异。</div>;
                  }
                  return (
                    <div className="rvw-file">
                      <div className="wt-file-header rvw-file-header">
                        <span className="rvw-history-sha">{review.selectedCommit.shortSha}</span>
                        <span className="wt-file-path">{file.path}</span>
                        <span className="rvw-file-stats">
                          <span className="rvw-stat-add">+{computeFileDiffStats(file).added}</span>
                          <span className="rvw-stat-del">−{computeFileDiffStats(file).removed}</span>
                        </span>
                        <span className="wt-file-hunk-count">{file.hunks.length} 个 hunk</span>
                      </div>
                      <CommitDiffFileView hash={review.selectedCommit.sha} file={file} />
                    </div>
                  );
                })()}
              </main>
            </>
          ) : (
            <div className="rvw-history-list" data-testid="rvw-history-list">
              {review.commitsLoading && <div className="wt-diff-loading">提交历史加载中…</div>}
              {review.commits && review.commits.length === 0 && (
                <div className="wt-empty">暂无提交记录。</div>
              )}
              {review.commits?.map((c) => (
                <button
                  key={c.sha}
                  type="button"
                  className="rvw-history-row"
                  onClick={() => void review.openCommit(c)}
                  title={c.subject}
                >
                  <span className="rvw-history-sha">{c.shortSha}</span>
                  <span className="rvw-history-subject">{c.subject}</span>
                  <span className="rvw-history-meta">{c.author} · {formatCommitDate(c.isoDate)}</span>
                </button>
              ))}
            </div>
          )
        )}
        {review.historyView === 'changes' && (<>
        {isDock ? (
          <div className="rvw-accordion" data-testid="rvw-file-list" role="list" aria-label="改动文件">
            {review.status && review.status.files.length === 0 && (
              <div className="wt-empty">暂无工作区改动。</div>
            )}
            {statusFiles.map((f) => {
              const diffFile = diffByPath.get(f.path);
              const stats = computeFileDiffStats(diffFile);
              const reviewed = isFileReviewed(diffFile, review.decisions);
              const selected = review.selectedFilePath === f.path;
              const expanded = expandedPaths.has(f.path);
              const fileName = f.path.slice(f.path.lastIndexOf('/') + 1);
              const dirPath = f.path.slice(0, f.path.lastIndexOf('/'));
              return (
                <div
                  key={f.path}
                  className={`rvw-acc-item${selected ? ' active' : ''}${reviewed ? ' rvw-file-reviewed' : ''}`}
                >
                  <button
                    type="button"
                    className="rvw-acc-row"
                    aria-expanded={expanded}
                    onClick={() => toggleAccordionRow(f.path)}
                    title={f.path}
                  >
                    <span className={`rvw-caret${expanded ? '' : ' rvw-caret-collapsed'}`}>
                      <span className="rvw-caret-icon"><Icon name="chevron-down" size={12} /></span>
                    </span>
                    <WorkspaceFileIcon name={f.path} type="file" />
                    <span className="rvw-acc-name">{fileName}</span>
                    {dirPath && <span className="rvw-acc-dir">{dirPath}/</span>}
                    {reviewed ? (
                      <span className="rvw-reviewed-mark"><Icon name="check" size={12} /></span>
                    ) : (stats.added > 0 || stats.removed > 0) ? (
                      <span className="rvw-file-stats">
                        {stats.added > 0 && <span className="rvw-stat-add">+{stats.added}</span>}
                        {stats.removed > 0 && <span className="rvw-stat-del">−{stats.removed}</span>}
                      </span>
                    ) : null}
                  </button>
                  {expanded && (
                    <div className="rvw-acc-diff">
                      {diffFile ? (
                        <CodeMirrorDiffView
                          filePath={f.path}
                          isBinary={diffFile.binary}
                          hunks={diffFile.hunks}
                          hunkDecisions={diffFile.hunks.map(
                            (_, i) => review.decisions[`${f.path}#${i}`] ?? null,
                          )}
                          onAcceptHunk={(i) => void review.decideHunk(f.path, i, 'accept')}
                          onRejectHunk={(i) => void review.decideHunk(f.path, i, 'reject')}
                        />
                      ) : (
                        <div className="wt-empty">未跟踪文件 — 暂无行级 diff。</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
        <aside className="rvw-sidebar" data-testid="rvw-file-list">
          <div className="wt-file-list-title">
            文件 ({review.status?.totalFiles ?? 0})
          </div>
          {review.status && review.status.files.length === 0 && (
            <div className="wt-empty">暂无工作区改动。</div>
          )}
          {fileGroups.map((group) => {
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
                    const diffFile = diffByPath.get(f.path);
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
                      </button>
                    );
                  })}
              </div>
            );
          })}
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
              </div>
              <CodeMirrorDiffView
                filePath={selectedFile.path}
                isBinary={selectedFile.binary}
                hunks={selectedFile.hunks}
                hunkDecisions={selectedFile.hunks.map(
                  (_, i) => review.decisions[`${selectedFile.path}#${i}`] ?? null,
                )}
                onAcceptHunk={(i) => void review.decideHunk(selectedFile.path, i, 'accept')}
                onRejectHunk={(i) => void review.decideHunk(selectedFile.path, i, 'reject')}
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
            {review.pendingCount > 0 && <span className="rvw-commitbox-stat">待定 {review.pendingCount}</span>}
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
    </div>
  );
}
