// ============================================================
// DiffFileView — BLOCK-16 thin-slice 单文件 diff 视图
//
// 选中文件的所有 hunk 列表 + 顶部 file meta + 每个 hunk 的 Accept/Reject UI。
// Reject 弹 textarea 输入 feedback（可选）。
// ============================================================

import { useState } from 'react';
import type { DiffFile, HunkDecision } from './useWorkingTreeReview';
import { DiffHunkView } from './DiffHunkView';

export interface DiffFileViewProps {
  file: DiffFile;
  decisions: Record<string, HunkDecision>;
  onAccept: (hunkIndex: number) => void;
  onReject: (hunkIndex: number, feedback?: string) => void;
}

export function DiffFileView({ file, decisions, onAccept, onReject }: DiffFileViewProps) {
  const [rejectTarget, setRejectTarget] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');

  if (file.binary) {
    return (
      <div className="wt-file-binary">
        <div className="wt-file-path">{file.path}</div>
        <div className="wt-binary-marker">Binary file changed</div>
      </div>
    );
  }

  const handleRejectClick = (hunkIndex: number) => {
    setRejectTarget(hunkIndex);
    setFeedback('');
  };

  const handleRejectConfirm = () => {
    if (rejectTarget !== null) {
      onReject(rejectTarget, feedback || undefined);
      setRejectTarget(null);
      setFeedback('');
    }
  };

  return (
    <div className="wt-file">
      <div className="wt-file-header">
        <span className="wt-file-path">{file.path}</span>
        {file.oldPath && file.oldPath !== file.path && (
          <span className="wt-file-old-path">← {file.oldPath}</span>
        )}
        <span className="wt-file-hunk-count">{file.hunks.length} hunk(s)</span>
      </div>
      <div className="wt-file-hunks">
        {file.hunks.map((hunk, idx) => {
          const key = `${file.path}#${idx}`;
          const decision = decisions[key];
          return (
            <DiffHunkView
              key={idx}
              hunk={hunk}
              hunkIndex={idx}
              decision={decision}
              onAccept={() => onAccept(idx)}
              onReject={() => handleRejectClick(idx)}
            />
          );
        })}
      </div>
      {rejectTarget !== null && (
        <div className="wt-reject-dialog" role="dialog" aria-label="reject feedback">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="(optional) feedback for the AI agent on why this hunk was rejected..."
            className="wt-reject-textarea"
            rows={4}
          />
          <div className="wt-reject-actions">
            <button type="button" className="wt-btn" onClick={() => setRejectTarget(null)}>
              Cancel
            </button>
            <button type="button" className="wt-btn wt-btn-reject" onClick={handleRejectConfirm}>
              Confirm reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
