import React from 'react';
import { useLocation } from 'react-router-dom';
import { useWorkspacePanelsContext } from '../WorkspacePanelsContext';
import { getIsMac, handleTitleBarDoubleClick, modeUsesRightRail, parseWorkspaceRoute } from './shared';
import { TitleBarLeftZone } from './TitleBarLeftZone';
import { TitleBarCenterZone } from './TitleBarCenterZone';
import { TitleBarRightZone } from './TitleBarRightZone';
import styles from './ColumnizedTitleBar.module.css';

/**
 * BLOCK-62 P1b — 列级 header（ProjectWorkspace regular 分支专用）。
 *
 * 作为对应栏 aside（flex-column）的第一个子元素：交叉轴默认 stretch → header 宽
 * = aside 宽 = 栏宽（aside 消费 `--gewu-live-*`），header 与栏体同属一个 aside、
 * 同一次 React commit 渲染 → 顶栏分隔线与栏体边缘物理一体，刚性由构造保证
 * （跨树同步契约 --titlebar-*-span grid 模拟 / collapsedRail 魔数在本路由退役）。
 *
 * 收起态内联：左栏收起时 LeftZone（交通灯 + 展开按钮，mac 关窗始终可达）内联进
 * 中列 header 左缘；右栏收起时 RightZone（windowTools + 非 mac 窗口控件）内联进
 * 中列 header 右缘。zone 组件自带条件渲染，无 collapsedRail 魔数。
 *
 * 菜单（工具/会话/结果）向下开在栏体之上（aside 全高，overflow:hidden 只在栏
 * 水平边缘裁切；右栏右缘=视口右缘，与 fixed 条时代裁切一致）。
 */
export function ColumnHeader({ side }: { side: 'left' | 'center' | 'right' }): React.ReactElement {
  const panels = useWorkspacePanelsContext();
  const location = useLocation();
  const isMac = getIsMac();
  // UI-360 — 右栏随 plugins/settings 模式物理隐藏（aside 宽 0、header 随之），
  // 此时右区片段必须内联进中列 header 右缘，否则窗口控件/终端开关不可达。
  const rightRailVisible = (() => {
    const ws = parseWorkspaceRoute(location.pathname);
    return !!ws && panels.rightOpen && modeUsesRightRail(ws.mode);
  })();

  return (
    <header
      className={styles.columnHeader}
      onDoubleClick={!isMac ? handleTitleBarDoubleClick : undefined}
    >
      {side === 'left' && <TitleBarLeftZone />}
      {side === 'center' && (
        <>
          {!panels.leftOpen && (
            <div className={styles.inlineZone}>
              <TitleBarLeftZone />
            </div>
          )}
          <div className={styles.mainZone}>
            <TitleBarCenterZone />
          </div>
          {!rightRailVisible && (
            <div className={styles.inlineZone}>
              <TitleBarRightZone />
            </div>
          )}
        </>
      )}
      {side === 'right' && <TitleBarRightZone />}
    </header>
  );
}
