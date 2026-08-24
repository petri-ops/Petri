// ============================================================
// WorkingTreeReview — BLOCK-20 thin-slice 常驻右侧审阅面板
//
// 顶部工具栏：刷新 / Commit Review / Revert all
// 中部 file list（左侧） + 选中文件的 hunk 视图（右侧）
// 底部状态栏：pending / accepted / rejected 计数
// Commit Review 点击后弹出 commit message dialog。
// 由 useWorkspacePanels.workingTreeOpen 控制显隐（见 TitleBar 按钮）。
// ============================================================

import { useEffect, useState, useRef } from 'react';
import { useWorkingTreeReview } from './useWorkingTreeReview';
import { DiffFileView } from './DiffFileView';
import { CodeReviewDrawer } from './CodeReviewDrawer';

export interface WorkingTreeReviewProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CommitSuccess {
  commit: string | null;
  files: string[];
  message: string;
}

export function WorkingTreeReview({ isOpen, onClose }: WorkingTreeReviewProps) {
  const review = useWorkingTreeReview({ isOpen, onClose });

  const [commitMsg, setCommitMsg] = useState('');
  const [showCommitDialog, setShowCommitDialog] = useState(false);
  const [commitSuccess, setCommitSuccess] = useState<CommitSuccess | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isEditDrawerOpen) {
          setIsEditDrawerOpen(false);
        } else if (showCommitDialog) {
          setShowCommitDialog(false);
          setCommitError(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, showCommitDialog, isEditDrawerOpen, onClose]);

  useEffect(() => {
    if (isOpen) void review.refresh();
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // 自动 focus textarea
  useEffect(() => {
    if (showCommitDialog && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [showCommitDialog]);

  // BLOCK-20 keyboard navigation state
  const [focusedHunk, setFocusedHunk] = useState(0);

  // Reset focus when switching files
  useEffect(() => { setFocusedHunk(0); }, [review.selectedFilePath]);

  // Keyboard shortcuts: A/Y accept, R reject, ↑↓ navigate hunks
  useEffect(() => {
    if (!isOpen) return;
    const file = review.diff?.files.find((f) => f.path === review.selectedFilePath) || null;
    if (!file) return;
    const onKey = (e: KeyboardEvent) => {
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
  }, [review, focusedHunk, review.decisions, review.selectedFilePath, isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  const selectedFile = review.diff?.files.find((f) => f.path === review.selectedFilePath) || null;

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
    // 预填默认 message
    if (!commitMsg) {
      setCommitMsg(`Review: accept ${acceptedCount} hunk(s), reject ${rejectedCount} hunk(s)`);
    }
    setCommitError(null);
    setCommitSuccess(null);
    setShowCommitDialog(true);
  };

  const handleCommitConfirm = async () => {
    if (!commitMsg.trim()) {
      setCommitError('Commit message is required.');
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
      setShowCommitDialog(false);
      setCommitMsg('');
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCommitCancel = () => {
    setShowCommitDialog(false);
    setCommitError(null);
  };

  return (
    <div className="wt-container" role="region" aria-label="code review panel">
      {/* Commit success toast */}
      {commitSuccess && (
        <div className="wt-commit-success" role="status">
          <span>
            <strong>Committed</strong>
            {commitSuccess.commit && (
              <span className="wt-commit-hash"> {commitSuccess.commit.slice(0, 7)}</span>
            )}
            {' — '}
            {commitSuccess.files.length} file(s)
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

      <div className="wt-toolbar">
        <div className="wt-toolbar-left">
          <span className="wt-title">Code Review</span>
          {review.taskId && <span className="wt-task-id">task: {review.taskId}</span>}
        </div>
        <div className="wt-toolbar-right">
          <span className="wt-shortcut-hint">
            <kbd>A</kbd>/<kbd>Y</kbd> accept &nbsp;
            <kbd>R</kbd> reject &nbsp;
            <kbd>↑↓</kbd> navigate
          </span>
          <button
            type="button"
            className="wt-btn wt-edit-btn"
            onClick={() => setIsEditDrawerOpen(true)}
            disabled={!selectedFile || selectedFile.binary}
            title={
              selectedFile?.binary
                ? 'Binary file — cannot edit inline'
                : selectedFile
                  ? `Open ${selectedFile.path} in the inline editor`
                  : 'Select a file first'
            }
          >
            Edit file
          </button>
          <button
            type="button"
            className="wt-btn"
            onClick={() => void review.refresh()}
            title="Refresh working tree diff"
          >
            Refresh
          </button>
          <button
            type="button"
            className={`wt-btn wt-btn-commit${!hasDecisions ? ' wt-btn-disabled' : ''}`}
            onClick={handleCommitReviewClick}
            disabled={!hasDecisions}
            title={
              hasDecisions
                ? `Commit ${decisionCount} decision(s): ${acceptedCount} accept, ${rejectedCount} reject`
                : 'Review files first (Accept or Reject hunks)'
            }
          >
            Commit Review{hasDecisions ? ` (${decisionCount})` : ''}
          </button>
          <button
            type="button"
            className="wt-btn wt-btn-danger"
            onClick={() => void review.revertAll()}
            disabled={!review.status || review.status.files.length === 0}
          >
            Revert all
          </button>
        </div>
      </div>

      {review.error && (
        <div className="wt-error" role="alert">{review.error}</div>
      )}

      <div className="wt-body">
        <aside className="wt-file-list">
          <div className="wt-file-list-title">
            Files ({review.status?.totalFiles ?? 0})
          </div>
          {review.status?.files.length === 0 && (
            <div className="wt-empty">No working tree changes.</div>
          )}
          {review.status?.files.map((f) => {
            const summary = fileDecisionSummary(f.path);
            return (
              <button
                key={f.path}
                type="button"
                className={`wt-file-list-item ${review.selectedFilePath === f.path ? 'active' : ''}${summary ? ' wt-file-list-item-decided' : ''}`}
                onClick={() => review.setSelectedFilePath(f.path)}
              >
                <span className={`wt-file-status wt-file-status-${f.status}`}>{f.status}</span>
                <span className="wt-file-list-path">{f.path}</span>
                {summary && (
                  <span className="wt-file-list-badge">
                    {summary.accepted > 0 && (
                      <span className="wt-badge-mini wt-badge-accept-mini">{summary.accepted}</span>
                    )}
                    {summary.rejected > 0 && (
                      <span className="wt-badge-mini wt-badge-reject-mini">{summary.rejected}</span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </aside>

        <main className="wt-main">
          {!selectedFile && (
            <div className="wt-empty">Select a file on the left to view hunks.</div>
          )}
          {selectedFile && (
            <DiffFileView
              file={selectedFile}
              decisions={review.decisions}
              focusedHunk={focusedHunk}
              onAccept={(hunkIndex) => void review.decideHunk(selectedFile.path, hunkIndex, 'accept')}
              onReject={(hunkIndex, feedback) => void review.decideHunk(selectedFile.path, hunkIndex, 'reject', feedback)}
            />
          )}
        </main>
      </div>

      <div className="wt-statusbar">
        <span>pending: {review.pendingCount}</span>
        <span>accepted: {review.appliedCount}</span>
        <span>rejected: {review.rejectedCount}</span>
        {review.diff?.truncated && <span className="wt-warning">output truncated</span>}
        {review.loading && <span>loading...</span>}
      </div>

      {/* Commit message dialog (overlay) */}
      {showCommitDialog && (
        <div className="wt-dialog-overlay" role="dialog" aria-modal="true" aria-label="Commit message">
          <div className="wt-dialog">
            <div className="wt-dialog-header">
              <span className="wt-dialog-title">Commit Review</span>
              <button
                type="button"
                className="wt-dialog-close"
                onClick={handleCommitCancel}
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            <div className="wt-dialog-body">
              <div className="wt-dialog-summary">
                <span className="wt-badge wt-badge-accept">{acceptedCount} accepted</span>
                <span className="wt-badge wt-badge-reject">{rejectedCount} rejected</span>
                <span className="wt-dialog-files">
                  {acceptedCount > 0
                    ? `Will stage ${acceptedCount} file(s) and commit.`
                    : 'No files will be committed.'}
                </span>
              </div>

              <label htmlFor="wt-commit-message" className="wt-dialog-label">
                Commit message
              </label>
              <textarea
                id="wt-commit-message"
                ref={textareaRef}
                className="wt-dialog-textarea"
                value={commitMsg}
                onChange={(e) => {
                  setCommitMsg(e.target.value);
                  if (commitError) setCommitError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    void handleCommitConfirm();
                  }
                  if (e.key === 'Escape') handleCommitCancel();
                }}
                placeholder="Describe what changed and why..."
                rows={4}
              />

              {commitError && (
                <div className="wt-dialog-error" role="alert">{commitError}</div>
              )}

              <div className="wt-dialog-hint">
                {acceptedCount === 0
                  ? 'No hunks accepted — nothing will be staged or committed.'
                  : `Accepted hunks will be staged and committed. Press ⌘+Enter to confirm.`}
              </div>
            </div>

            <div className="wt-dialog-footer">
              <button type="button" className="wt-btn" onClick={handleCommitCancel}>
                Cancel
              </button>
              <button
                type="button"
                className={`wt-btn wt-btn-commit${acceptedCount === 0 ? ' wt-btn-disabled' : ''}`}
                onClick={() => void handleCommitConfirm()}
                disabled={acceptedCount === 0 || review.loading}
              >
                {review.loading ? 'Committing...' : `Commit (${acceptedCount})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BLOCK-20 PHASE 3 — inline-edit drawer */}
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
