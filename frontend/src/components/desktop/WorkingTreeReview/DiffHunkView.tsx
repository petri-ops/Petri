// ============================================================
// DiffHunkView — BLOCK-16 thin-slice 单一 hunk 渲染
//
// 走 split-line 视角（add/del/ctx）+ 行号 + 颜色：
// - ctx 行透明背景
// - + 行绿底浅
// - - 行红底浅
// 与既有 ResultStudioChangeSetPanel 风格一致。
// ============================================================

import type { Hunk, HunkLine } from './useWorkingTreeReview';

export interface DiffHunkViewProps {
  hunk: Hunk;
  hunkIndex: number;
  onAccept?: () => void;
  onReject?: (feedback?: string) => void;
  decision?: 'accept' | 'reject' | 'pending' | undefined;
}

function linePrefix(type: HunkLine['type']): string {
  if (type === 'add') return '+';
  if (type === 'del') return '-';
  return ' ';
}

export function DiffHunkView({ hunk, hunkIndex, onAccept, onReject, decision }: DiffHunkViewProps) {
  let oldLineNo = hunk.oldStart;
  let newLineNo = hunk.newStart;
  const lines = hunk.lines || [];
  return (
    <div className="wt-hunk" data-hunk-index={hunkIndex} data-decision={decision || 'pending'}>
      <div className="wt-hunk-header">
        <span className="wt-hunk-marker">@@ -{hunk.oldStart} +{hunk.newStart} @@</span>
        <div className="wt-hunk-actions">
          <button
            type="button"
            className="wt-btn wt-btn-accept"
            onClick={onAccept}
            disabled={!onAccept || decision === 'accept'}
            data-action="accept"
          >
            Accept
          </button>
          <button
            type="button"
            className="wt-btn wt-btn-reject"
            onClick={() => onReject?.('')}
            disabled={!onReject || decision === 'reject'}
            data-action="reject"
          >
            Reject
          </button>
        </div>
      </div>
      <table className="wt-hunk-table">
        <tbody>
          {lines.map((line, idx) => {
            const oLine = line.type === 'add' ? null : ++oldLineNo;
            const nLine = line.type === 'del' ? null : ++newLineNo;
            // 上面 ++oldLineNo 的语义退化：重新计算
            const oldLineNumber = line.type === 'add' ? '' : Math.max(0, hunk.oldStart + lines.slice(0, idx + 1).filter((l) => l.type !== 'add').length - 1);
            const newLineNumber = line.type === 'del' ? '' : Math.max(0, hunk.newStart + lines.slice(0, idx + 1).filter((l) => l.type !== 'del').length - 1);
            return (
              <tr key={idx} className={`wt-line wt-line-${line.type}`}>
                <td className="wt-gutter wt-gutter-old">{oldLineNumber}</td>
                <td className="wt-gutter wt-gutter-new">{newLineNumber}</td>
                <td className="wt-marker">{linePrefix(line.type)}</td>
                <td className="wt-content">
                  <code>{line.text}</code>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hunk.truncated && (
        <div className="wt-hunk-truncated">... truncated ...</div>
      )}
    </div>
  );
}
