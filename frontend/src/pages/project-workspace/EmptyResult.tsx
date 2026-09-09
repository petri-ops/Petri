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
  onOpenTerminal,
  onOpenBrowser,
  onOpenFiles,
  onOpenChat,
  onOpenReview,
}: {
  onOpenResults?: () => void;
  onOpenTerminal?: () => void;
  onOpenBrowser?: () => void;
  onOpenFiles?: () => void;
  onOpenChat?: () => void;
  /** BLOCK-28.2 — 打开右侧审阅停靠面板（CodeReview）。 */
  onOpenReview?: () => void;
}): React.ReactElement {
  return (
    <div className={styles.emptyResult}>
      <div className={styles.emptyResultLaunchpad}>
        <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenResults} disabled={!onOpenResults}>
          <Icon name="bar-chart" size={16} />
          <span className={styles.emptyResultLaunchText}>结果</span>
        </button>
        <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenTerminal} disabled={!onOpenTerminal}>
          <Icon name="terminal" size={16} />
          <span className={styles.emptyResultLaunchText}>后端</span>
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
        </button>
      </div>
    </div>
  );
}
