// ============================================================
// WorkingTreeReview — BLOCK-16 thin-slice 模态浮层入口
//
// 顶部工具栏：关闭 / 任务 ID / 文件数 / 计数 / Revert All
// 中部 file list（左侧） + 选中文件的 hunk 视图（右侧）
// 底部状态栏：pending / applied / rejected 计数
// ============================================================

import { useEffect } from 'react';
import { useWorkingTreeReview } from './useWorkingTreeReview';
import { DiffFileView } from './DiffFileView';

export interface WorkingTreeReviewProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WorkingTreeReview({ isOpen, onClose }: WorkingTreeReviewProps) {
  const review = useWorkingTreeReview({ isOpen, onClose });

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) void review.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedFile = review.diff?.files.find((f) => f.path === review.selectedFilePath) || null;

  return (
    <div className="wt-overlay" role="dialog" aria-modal="true" aria-label="working tree review">
      <div className="wt-container">
        <div className="wt-toolbar">
          <div className="wt-toolbar-left">
            <span className="wt-title">Working Tree Review</span>
            {review.taskId && <span className="wt-task-id">task: {review.taskId}</span>}
          </div>
          <div className="wt-toolbar-right">
            <button type="button" className="wt-btn" onClick={() => void review.refresh()}>
              Refresh
            </button>
            <button type="button" className="wt-btn wt-btn-danger" onClick={() => void review.revertAll()}>
              Revert all
            </button>
            <button type="button" className="wt-btn wt-btn-close" onClick={onClose} aria-label="close">
              ✕
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
            {review.status?.files.map((f) => (
              <button
                key={f.path}
                type="button"
                className={`wt-file-list-item ${review.selectedFilePath === f.path ? 'active' : ''}`}
                onClick={() => review.setSelectedFilePath(f.path)}
              >
                <span className={`wt-file-status wt-file-status-${f.status}`}>{f.status}</span>
                <span className="wt-file-list-path">{f.path}</span>
              </button>
            ))}
          </aside>

          <main className="wt-main">
            {!selectedFile && (
              <div className="wt-empty">Select a file on the left to view hunks.</div>
            )}
            {selectedFile && (
              <DiffFileView
                file={selectedFile}
                decisions={review.decisions}
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
      </div>
    </div>
  );
}
