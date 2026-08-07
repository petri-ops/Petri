import React from 'react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { useWorkspacePanelsContext } from './WorkspacePanelsContext';
import { getBridge } from '@/lib/desktopBridge';
import styles from './TitleBar.module.css';

/**
 * True when running inside the BioF3 desktop app on macOS, where the OS
 * draws native traffic-light controls (left side) and we must NOT render
 * custom window controls. On Windows/Linux the window is frameless, so we
 * draw our own buttons.
 */
const isMac =
  typeof window !== 'undefined' && window.biof3Desktop?.platform === 'darwin';

/**
 * Custom frameless window controls (minimize / maximize-restore / close).
 * Rendered ONLY on non-macOS. Calls the existing `window` IPC bridge that
 * the preload already exposes (`minimize`, `maximize` [toggles], `close`,
 * `isMaximized`).
 */
export function WindowControls(): React.ReactElement {
  const bridge = getBridge('window');
  const [isMaximized, setIsMaximized] = useState<boolean>(false);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    bridge
      .isMaximized()
      .then((maximized) => {
        if (!cancelled) setIsMaximized(maximized);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  if (!bridge) return <></>;

  return (
    <div className={styles.windowControls}>
      <button
        type="button"
        className={styles.winBtn}
        onClick={() => bridge.minimize()}
        title="最小化"
        aria-label="最小化"
      >
        <Icon name="minus" size={14} />
      </button>
      <button
        type="button"
        className={styles.winBtn}
        onClick={() => {
          bridge.maximize();
          setIsMaximized((prev) => !prev);
        }}
        title={isMaximized ? '还原' : '最大化'}
        aria-label={isMaximized ? '还原' : '最大化'}
      >
        <Icon name={isMaximized ? 'restore' : 'square'} size={14} />
      </button>
      <button
        type="button"
        className={`${styles.winBtn} ${styles.winBtnClose}`}
        onClick={() => bridge.close()}
        title="关闭"
        aria-label="关闭"
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

function getFallbackTitle(pathname: string): string {
  if (pathname.startsWith('/project/')) return '梳理开发进展';
  if (pathname.startsWith('/tools')) return '分析结果';
  if (pathname.startsWith('/admin')) return '管理';
  return 'BioF3';
}

export function TitleBar(): React.ReactElement {
  const location = useLocation();
  const panels = useWorkspacePanelsContext();
  const {
    title,
    leftPanelWidth,
    rightPanelWidth,
    tabs,
    activeTabId,
    onSelectTab,
    onCloseTab,
    onMoreAction,
    toolMenuOpen,
    toolMenuItems,
    onSelectToolItem,
    canGoBack,
    canGoForward,
    onGoBack,
    onGoForward,
  } = panels.titleBar;

  const displayTitle = title || getFallbackTitle(location.pathname);
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
    <header className={styles.titleBar} style={titleBarStyle}>
      <div className={styles.leftZone}>
        {isMac && <div className={styles.trafficZone} aria-hidden="true" />}

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
          <button
            type="button"
            className={`${styles.iconBtn} ${!canGoBack ? styles.iconBtnDisabled : ''}`}
            onClick={canGoBack ? onGoBack || undefined : undefined}
            title="后退"
            aria-label="后退"
            aria-disabled={!canGoBack}
          >
            <Icon name="arrow-left" size={15} />
          </button>
          <button
            type="button"
            className={`${styles.iconBtn} ${!canGoForward ? styles.iconBtnDisabled : ''}`}
            onClick={canGoForward ? onGoForward || undefined : undefined}
            title="前进"
            aria-label="前进"
            aria-disabled={!canGoForward}
          >
            <Icon name="arrow-right" size={15} />
          </button>
        </div>
      </div>

      <div className={styles.centerTitle}>
        <div className={styles.centerTitleMain}>
          <Icon name="folder" size={15} />
          <span className={styles.centerTitleText}>{displayTitle}</span>
        </div>
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
      </div>

      <div className={`${styles.rightZone} ${!panels.rightOpen ? styles.rightZoneCollapsed : ''}`}>
        {panels.rightOpen && (
          <div className={styles.tabsRail}>
            {tabs.map((tab) => {
              const active = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  className={`${styles.tabPill} ${active ? styles.tabPillActive : ''}`}
                >
                  <button
                    type="button"
                    className={styles.tabPillMain}
                    onClick={() => onSelectTab?.(tab.id)}
                    title={tab.label}
                    aria-pressed={active}
                  >
                    <Icon name={tab.icon} size={14} />
                    <span className={styles.tabPillText}>{tab.label}</span>
                  </button>
                  {tab.closable && onCloseTab && (
                    <button
                      type="button"
                      className={styles.tabClose}
                      onClick={() => onCloseTab(tab.id)}
                      aria-label={`关闭${tab.label}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            <div className={styles.toolMenuAnchor}>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => onMoreAction?.()}
                title="展开更多工具"
                aria-label="展开更多工具"
                aria-haspopup="menu"
                aria-expanded={toolMenuOpen}
              >
                <Icon name="plus" size={15} />
              </button>
              {toolMenuOpen && (
                <>
                  <button
                    type="button"
                    className={styles.toolMenuOverlay}
                    onClick={() => onMoreAction?.()}
                    aria-label="关闭工具菜单"
                  />
                  <div className={styles.toolMenu} role="menu">
                    {toolMenuItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={item.isOpen ? styles.toolMenuItemActive : ''}
                        onClick={() => onSelectToolItem?.(item.id)}
                        role="menuitem"
                      >
                        <Icon name={item.icon} size={14} />
                        <span>{item.label}</span>
                        {item.isOpen && <Icon name="check" size={13} />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <div className={styles.windowTools}>
          <button
            type="button"
            className={`${styles.iconBtn} ${!panels.bottomTerminalOpen ? styles.iconBtnInactive : ''}`}
            onClick={panels.toggleBottomTerminal}
            title={panels.bottomTerminalOpen ? '收起底部终端' : '展开底部终端'}
            aria-label={panels.bottomTerminalOpen ? '收起底部终端' : '展开底部终端'}
          >
            <Icon name="panel-bottom" size={15} />
          </button>
          <button
            type="button"
            className={`${styles.iconBtn} ${!panels.rightOpen ? styles.iconBtnInactive : ''}`}
            onClick={panels.toggleRight}
            title={panels.rightOpen ? '收起右侧栏' : '展开右侧栏'}
            aria-label={panels.rightOpen ? '收起右侧栏' : '展开右侧栏'}
          >
            <Icon name="panel-right" size={15} />
          </button>
        </div>

        {!isMac && <WindowControls />}
      </div>
    </header>
  );
}
