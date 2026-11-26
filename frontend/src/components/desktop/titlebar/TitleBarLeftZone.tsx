import React from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { useWorkspacePanelsContext } from '../WorkspacePanelsContext';
import styles from '../TitleBar.module.css';
import { getIsDesktop, getIsMac, isStandalonePagePath, useDesktopWindowControls } from './shared';

/**
 * BLOCK-62 P1a — TitleBar 左区片段（自绘交通灯 + 左栏收起按钮）。
 *
 * 容器无关：既被 fixed 整条 [TitleBar.tsx](../TitleBar.tsx) 复用，也被 P1b
 * 列级 header-slot 复用。渲染逻辑与提取前一字不动。
 */
export function TitleBarLeftZone(): React.ReactElement {
  const panels = useWorkspacePanelsContext();
  const win = useDesktopWindowControls();
  const isMac = getIsMac();
  const isDesktop = getIsDesktop();
  // UI-348 — 全局独立页顶栏左区不画分隔线（默认 span 与壳层左栏宽度错位）
  const bare = isStandalonePagePath(useLocation().pathname);

  return (
    <div className={`${styles.leftZone}${bare ? ` ${styles.leftZoneBare}` : ''}`}>
      {isMac && (
        <div className={styles.trafficZone}>
          {isDesktop ? (
            <>
              {/* tabIndex=-1: 这些窗口控件是 DOM 里最靠前的可聚焦元素，若参与
                  键盘焦点，页面加载后焦点会默认落在「关闭窗口」上，导致用户敲的
                  字被按钮吃掉（且空格/回车会误触关闭）。鼠标点击不受影响。 */}
              <button
                type="button"
                tabIndex={-1}
                className={`${styles.macTrafficBtn} ${styles.macTrafficBtnClose}`}
                onClick={win.close}
                aria-label="关闭窗口"
                title="关闭"
              >
                <Icon name="x" size={11} strokeWidth={2.4} />
              </button>
              <button
                type="button"
                tabIndex={-1}
                className={styles.macTrafficBtn}
                onClick={win.minimize}
                aria-label="最小化窗口"
                title="最小化"
              >
                <Icon name="minus" size={11} strokeWidth={2.4} />
              </button>
              <button
                type="button"
                tabIndex={-1}
                className={styles.macTrafficBtn}
                onClick={win.toggleFullScreen}
                aria-label="全屏"
                title="全屏"
              >
                <Icon name="expand" size={11} strokeWidth={2.2} />
              </button>
            </>
          ) : (
            <div className={styles.trafficPlaceholder} aria-hidden="true" />
          )}
        </div>
      )}

      <div className={styles.leftTools}>
        <button
          type="button"
          className={`${styles.iconBtn} ${!panels.leftOpen ? styles.iconBtnInactive : ''}`}
          onClick={panels.toggleLeft}
          title={panels.leftOpen ? '收起左侧栏' : '展开左侧栏'}
          aria-label={panels.leftOpen ? '收起左侧栏' : '展开左侧栏'}
        >
          <Icon name="panel-left" size={15} />
        </button>
      </div>
    </div>
  );
}
