import React from 'react';
import { useWorkspacePanelsContext } from './WorkspacePanelsContext';
import styles from './TitleBar.module.css';
import { getIsMac, handleTitleBarDoubleClick } from './titlebar/shared';
import { TitleBarLeftZone } from './titlebar/TitleBarLeftZone';
import { TitleBarCenterZone } from './titlebar/TitleBarCenterZone';
import { TitleBarRightZone } from './titlebar/TitleBarRightZone';

/**
 * BLOCK-62 P1a — fixed 整条 TitleBar（非列体化路由：home / skills / review /
 * result-studio 用）。
 *
 * 三段内容已提取到 [titlebar/](./titlebar/) 下的容器无关片段（P1b 列级
 * header-slot 复用同一组片段）。本组件只保留 fixed 条特有的：整宽 grid
 * （`--titlebar-*-span` 模拟三列宽）+ 非 mac 双击最大化。
 *
 * ProjectWorkspace 路由在 P1b 改走列级 header-slot，不再渲染本组件的 fixed 条；
 * P1a 阶段行为与提取前完全一致（span 注入 / grid / 双击均保留）。
 */
export function TitleBar(): React.ReactElement {
  const panels = useWorkspacePanelsContext();
  const isMac = getIsMac();
  const { leftPanelWidth, rightPanelWidth } = panels.titleBar;

  const resizeRail = 1;
  const collapsedLeftRail = isMac ? 180 : 146;
  // Collapsed right rail must fit the windowTools (bottom-terminal + right-panel
  // toggles) AND, on Windows/Linux, the custom WindowControls (minimize /
  // maximize / close). 56px only covered windowTools, so once WindowControls
  // render the centered summary button slid under the minimize button.
  const collapsedRightRail = isMac ? 80 : 196;
  const leftSpan = panels.leftOpen ? leftPanelWidth + resizeRail : collapsedLeftRail;
  const rightSpan = panels.rightOpen ? rightPanelWidth + resizeRail : collapsedRightRail;
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
