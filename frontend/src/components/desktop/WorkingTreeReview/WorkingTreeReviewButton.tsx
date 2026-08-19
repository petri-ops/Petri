// ============================================================
// WorkingTreeReviewButton — BLOCK-16 thin-slice 工具栏手动按钮
//
// 触发 useWorkingTreeReviewMount().open() 弹出浮层。
// 入口可放在 TitleBar / Toolbar / CommandPalette 之后；这里 default 入口是
// 一个浮动 button（不侵入既有 layout）。
// ============================================================

import { useWorkingTreeReviewMount } from './WorkingTreeReviewMount';

export function WorkingTreeReviewButton() {
  const review = useWorkingTreeReviewMount();
  return (
    <button
      type="button"
      className="wt-launch-button"
      onClick={review.open}
      title="Review working tree changes"
      aria-label="open working tree review"
    >
      <span className="wt-launch-icon" aria-hidden="true">⇄</span>
      <span className="wt-launch-label">Review</span>
    </button>
  );
}
