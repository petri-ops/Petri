import React from 'react';
import { useLocation } from 'react-router-dom';
import { useWorkspacePanelsContext } from './WorkspacePanelsContext';
import styles from './TitleBar.module.css';
import { getIsMac, handleTitleBarDoubleClick, isProjectionMobile, parseWorkspaceRoute } from './titlebar/shared';
import { TitleBarLeftZone } from './titlebar/TitleBarLeftZone';
import { TitleBarCenterZone } from './titlebar/TitleBarCenterZone';
import { TitleBarRightZone } from './titlebar/TitleBarRightZone';

/**
 * BLOCK-62 P1a/P2 — fixed 整条 TitleBar。
 *
 * 渲染场景（ProjectWorkspace regular 分支的顶栏是三个列内 ColumnHeader，不用本组件）：
 * ① 非列体化路由（home / skills / review / result-studio）——AppShell 渲染，无真实
 *    可拖列，用默认宽；② ProjectWorkspace 的 compact(≤960) / loading / error——
 *    由页面自持渲染，compact 浮层列与 grid span 对齐所需的栏宽经 **props 同树直传**
 *    （P2：取代原 updateTitleBar context 跨树推送——那条链每拖拽帧触发全部 context
 *    消费者重渲染，且列体化 regular 分支根本不消费宽度，是死链 + 无谓 churn）。
 *
 * 三段内容在 [titlebar/](./titlebar/) 下的容器无关片段（列级 header 复用同一组）。
 */
export interface TitleBarProps {
  /** 左栏当前宽（仅 compact 浮层对齐需要；非工作区路由省略用默认） */
  leftPanelWidth?: number;
  rightPanelWidth?: number;
}

export function TitleBar({ leftPanelWidth = 240, rightPanelWidth = 340 }: TitleBarProps = {}): React.ReactElement {
  const panels = useWorkspacePanelsContext();
  const location = useLocation();
  const isMac = getIsMac();

  const resizeRail = 1;
  const collapsedLeftRail = isMac ? 180 : 146;
  // Collapsed right rail must fit the windowTools (bottom-terminal + right-panel
  // toggles) AND, on Windows/Linux, the custom WindowControls (minimize /
  // maximize / close). 56px only covered windowTools, so once WindowControls
  // render the centered summary button slid under the minimize button.
  const collapsedRightRail = isMac ? 80 : 196;
  // UI-360/UI-365 — compact 固定条的右栏 grid span 与右栏实际在场状态对齐：
  // 非工作区路由（settings 模式已独立页化）右栏不在场，按收起宽计算。
  const workspaceRoute = parseWorkspaceRoute(location.pathname);
  const rightRailVisible = !!workspaceRoute && panels.rightOpen;
  // BLOCK-87 L3-2 — 投影手机端左侧栏=App 壳层覆盖式抽屉（leftOpen 被征用为
  // 抽屉开合），覆盖层不推挤顶栏布局：左右 span 恒按收起宽计算。
  const projectionMobile = isProjectionMobile();
  const leftSpan = !projectionMobile && panels.leftOpen ? leftPanelWidth + resizeRail : collapsedLeftRail;
  const rightSpan = !projectionMobile && rightRailVisible ? rightPanelWidth + resizeRail : collapsedRightRail;
  const titleBarStyle = {
    ['--titlebar-left-span' as string]: `${leftSpan}px`,
    ['--titlebar-right-span' as string]: `${rightSpan}px`,
  } as React.CSSProperties;

  return (
    <header
      className={styles.titleBar}
      style={titleBarStyle}
      onDoubleClick={!isMac ? handleTitleBarDoubleClick : undefined}
    >
      <TitleBarLeftZone />
      <TitleBarCenterZone />
      <TitleBarRightZone />
    </header>
  );
}
