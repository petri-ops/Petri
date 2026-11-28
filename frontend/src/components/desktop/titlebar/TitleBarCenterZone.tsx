import React from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { useWorkspacePanelsContext } from '../WorkspacePanelsContext';
import { BranchTabsWrapper } from '@/components/branch/BranchTabsWrapper';
import styles from '../TitleBar.module.css';
import { getFallbackTitle, isProjectionMobile, isStandalonePagePath, modeUsesSummaryCard, parseWorkspaceRoute } from './shared';

/**
 * BLOCK-62 P1a — TitleBar 中区片段（标题 + 分支 tabs + 摘要概览开关）。
 *
 * 容器无关：既被 fixed 整条 [TitleBar.tsx](../TitleBar.tsx) 复用，也被 P1b
 * 列级 header-slot 复用。
 *
 * UI-334 — 会话选择器（convSelector）整体移除；item 90 阶段二 — Result Studio
 * 结果选择器 pill 随 RS 物理退役移除。
 */
export function TitleBarCenterZone(): React.ReactElement {
  const location = useLocation();
  const panels = useWorkspacePanelsContext();
  const { title } = panels.titleBar;

  // UI-348 — 全局独立页（/skills /knowledge /backend）不渲染品牌 chip 与分区
  // 分隔线：页面自带「返回+标题」页头，顶栏只留可拖拽区与窗口控件。
  if (isStandalonePagePath(location.pathname)) {
    return <div className={`${styles.centerTitle} ${styles.centerTitleBare}`} aria-hidden="true" />;
  }

  // UI-360 — 摘要概览开关只在工作区路由的 chat / scheduled 模式渲染
  // （摘要卡 showPinnedSummary 同口径）；欢迎页 / 独立页与 plugins/settings
  // 等全屏工作面无摘要卡，开关是死开关。
  const summaryToggleAvailable = (() => {
    const ws = parseWorkspaceRoute(location.pathname);
    return !!ws && modeUsesSummaryCard(ws.mode);
  })();

  // UI-377 — 中区右缘分隔线只在「右栏真的在场」时渲染（工作区路由 + 右栏开 +
  // 非投影手机）。此前只看全局 rightOpen 偏好：欢迎页/独立页右栏并不在场，
  // 一条悬空分隔线挂在标题区右缘（用户截图指认「灰色分隔线多余」）。
  const rightRailPresent =
    !!parseWorkspaceRoute(location.pathname) && panels.rightOpen && !isProjectionMobile();

  const displayTitle = title || getFallbackTitle(location.pathname);

  return (
    <div className={`${styles.centerTitle} ${!rightRailPresent ? styles.centerTitleNoDivider : ''}`}>
      <div className={styles.centerTitleMain}>
        <Icon name="folder" size={15} />
        <span className={styles.centerTitleText}>{displayTitle}</span>
      </div>
      <BranchTabsWrapper />
      {/* UI-334 / item 90 阶段二 — 会话选择器与 RS 结果选择器 pill 均已移除 */}
      {/* UI-360 — 摘要概览开关只在工作区路由的 chat / scheduled 模式渲染
          （摘要卡 showPinnedSummary 同口径）；欢迎页 / 独立页与 plugins/settings
          等全屏工作面无摘要卡，开关是死开关。 */}
      {summaryToggleAvailable && (
        <button
          type="button"
          className={styles.iconBtn}
          onClick={panels.toggleSummary}
          title={panels.summaryOpen ? '收起摘要概览' : '展开摘要概览'}
          aria-label={panels.summaryOpen ? '收起摘要概览' : '展开摘要概览'}
          aria-pressed={panels.summaryOpen}
        >
          <Icon name="list-details" size={15} />
        </button>
      )}
    </div>
  );
}
