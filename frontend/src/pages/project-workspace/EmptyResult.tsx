// ============================================================
// EmptyResult — UI-305 P1 从 project-workspace.tsx 尾部整簇平移（原 3389-3463 行）。
// BLOCK-68 / UI-317 — 空态极简：删头部四件套（闪电图标/标题/描述/项目行）与
// 六卡片 <small> 副标题，仅留「图标 + 名称」卡片网格。
// ============================================================
import React from 'react';
import { Icon } from '@/components/icons/Icon';
import styles from '../project-workspace.module.css';

export function EmptyResult({
  onOpenResults,
  onOpenBrowser,
  onOpenFiles,
  onOpenChat,
  onOpenReview,
  onOpenJobs,
  reviewDot,
}: {
  onOpenResults?: () => void;
  // UI-348 — 「后端」卡已删除（BLOCK-72 后端管理面在左栏入口的全局 /backend 页，
  // 右栏不再保留跳转卡；用户裁决：右侧栏中的后端应该删除）
  onOpenBrowser?: () => void;
  onOpenFiles?: () => void;
  onOpenChat?: () => void;
  /** BLOCK-28.2 — 打开右侧审阅停靠面板（CodeReview）。 */
  onOpenReview?: () => void;
  /** UI-362 — 打开指挥中心 tab（项目绑定作业俯瞰）。 */
  onOpenJobs?: () => void;
  /** UI-446 加映 v3 — 当前会话有未看工作区改动：审阅磁贴亮圆点引导。 */
  reviewDot?: boolean;
}): React.ReactElement {
  return (
    <div className={styles.emptyResult}>
      <div className={styles.emptyResultLaunchpad}>
        <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenResults} disabled={!onOpenResults}>
          <Icon name="bar-chart" size={16} />
          <span className={styles.emptyResultLaunchText}>结果</span>
        </button>
        <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenBrowser} disabled={!onOpenBrowser}>
          <Icon name="globe" size={16} />
          <span className={styles.emptyResultLaunchText}>浏览器</span>
        </button>
        <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenFiles} disabled={!onOpenFiles}>
          <Icon name="folder" size={16} />
          <span className={styles.emptyResultLaunchText}>文件</span>
        </button>
        <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenChat} disabled={!onOpenChat}>
          <Icon name="sidebar" size={16} />
          <span className={styles.emptyResultLaunchText}>侧边聊天</span>
        </button>
        <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenReview} disabled={!onOpenReview}>
          <Icon name="git-branch" size={16} />
          <span className={styles.emptyResultLaunchText}>审阅</span>
          {reviewDot && <span className={styles.emptyResultLaunchDot} data-testid="review-tile-dot" aria-hidden="true" />}
        </button>
        <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenJobs} disabled={!onOpenJobs}>
          <Icon name="command" size={16} />
          <span className={styles.emptyResultLaunchText}>指挥中心</span>
        </button>
      </div>
    </div>
  );
}
