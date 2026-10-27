// ============================================================
// EmptyResult — 右栏「首页」空态。
// UI-305 P1 曾收敛为极简「图标+名称」卡片网格；UI-593（用户裁决 2026-10-27
// 「过于简约老土，需要大幅度布局合理性和提升美观程度；看 Qoder CN 怎么布局」）
// 对标 Qoder 0.4.8 工作区面板内容合同（ui-i18n-zh #3788255/#3788272：标题
// 「工作区」+ 描述「工作区就是 Agent 动手的地方：它会在这里看文件、改文件、
// 跑命令，也会读取这里的 Git 状态」）重排：顶部标题/描述块 + 富入口卡片
// （图标章 + 标题 + 一句说明）2 列网格，垂直居中。
// ============================================================
import React from 'react';
import { Icon } from '@/components/icons/Icon';
import { formatShortstatBadge } from '@/components/copilot/conversationChangesStore';
import styles from '../project-workspace.module.css';

export function EmptyResult({
  onOpenResults,
  onOpenBrowser,
  onOpenFiles,
  onOpenChat,
  onOpenReview,
  onOpenJobs,
  reviewCount,
  reviewStat,
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
  /** UI-446 v4 — 当前会话有未看工作区改动：审阅磁贴亮计数徽章引导。 */
  reviewCount?: number;
  /** UI-449（C-16）— ±行数（权威源=后端 git shortstat；缺省回落纯计数）。 */
  reviewStat?: { added: number; removed: number } | null;
}): React.ReactElement {
  return (
    <div className={styles.emptyResult}>
      <div className={styles.emptyResultInner}>
        <div className={styles.emptyResultHeader}>
          <span className={styles.emptyResultBadge} aria-hidden="true">
            <Icon name="layout-grid" size={20} />
          </span>
          <h3 className={styles.emptyResultTitle}>工作区</h3>
          <p className={styles.emptyResultDesc}>
            Agent 会在这里看文件、改文件、跑命令，也会读取 Git
            状态——选择一个面板开始。
          </p>
        </div>
        <div className={styles.emptyResultLaunchpad}>
          <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenResults} disabled={!onOpenResults}>
            <span className={styles.emptyResultLaunchIcon} aria-hidden="true"><Icon name="bar-chart" size={16} /></span>
            <span className={styles.emptyResultLaunchText}>
              <span className={styles.emptyResultLaunchTitle}>结果</span>
              <span className={styles.emptyResultLaunchDesc}>查看 Agent 作业的产物与运行结果</span>
            </span>
          </button>
          <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenBrowser} disabled={!onOpenBrowser}>
            <span className={styles.emptyResultLaunchIcon} aria-hidden="true"><Icon name="globe" size={16} /></span>
            <span className={styles.emptyResultLaunchText}>
              <span className={styles.emptyResultLaunchTitle}>浏览器</span>
              <span className={styles.emptyResultLaunchDesc}>内嵌浏览器，直接查看与操作网页</span>
            </span>
          </button>
          <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenFiles} disabled={!onOpenFiles}>
            <span className={styles.emptyResultLaunchIcon} aria-hidden="true"><Icon name="folder" size={16} /></span>
            <span className={styles.emptyResultLaunchText}>
              <span className={styles.emptyResultLaunchTitle}>文件</span>
              <span className={styles.emptyResultLaunchDesc}>浏览工作区文件与目录</span>
            </span>
          </button>
          <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenChat} disabled={!onOpenChat}>
            <span className={styles.emptyResultLaunchIcon} aria-hidden="true"><Icon name="sidebar" size={16} /></span>
            <span className={styles.emptyResultLaunchText}>
              <span className={styles.emptyResultLaunchTitle}>侧边聊天</span>
              <span className={styles.emptyResultLaunchDesc}>不离开工作区，继续与 Agent 对话</span>
            </span>
          </button>
          <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenReview} disabled={!onOpenReview}>
            <span className={styles.emptyResultLaunchIcon} aria-hidden="true"><Icon name="git-branch" size={16} /></span>
            <span className={styles.emptyResultLaunchText}>
              <span className={styles.emptyResultLaunchTitle}>审阅</span>
              <span className={styles.emptyResultLaunchDesc}>审查 Agent 的工作区改动</span>
            </span>
            {reviewCount ? <span className={styles.emptyResultLaunchCount} data-testid="review-tile-count">{formatShortstatBadge(reviewCount, reviewStat)}</span> : null}
          </button>
          <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenJobs} disabled={!onOpenJobs}>
            <span className={styles.emptyResultLaunchIcon} aria-hidden="true"><Icon name="command" size={16} /></span>
            <span className={styles.emptyResultLaunchText}>
              <span className={styles.emptyResultLaunchTitle}>指挥中心</span>
              <span className={styles.emptyResultLaunchDesc}>项目作业与编排俯瞰</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
