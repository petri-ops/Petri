import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { useWorkspacePanelsContext } from './WorkspacePanelsContext';
import styles from './TitleBar.module.css';

function getFallbackTitle(pathname: string): string {
  if (pathname.startsWith('/project/')) return '梳理开发进展';
  if (pathname.startsWith('/tools')) return '分析结果';
  if (pathname.startsWith('/admin')) return '管理';
  return 'BioF3';
}

function useDesktopWindowControls(): {
  isMaximized: boolean;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  onTitleBarDoubleClick: (event: React.MouseEvent<HTMLElement>) => void;
} {
  const bridge = typeof window !== 'undefined' ? window.biof3Desktop : undefined;
  const desktopWindow = bridge?.isDesktop === true ? bridge.window : undefined;
  const [isMaximized, setIsMaximized] = useState<boolean>(false);

  useEffect(() => {
    if (!desktopWindow) return undefined;

    let active = true;
    let receivedLiveState = false;
    let unsubscribe: (() => void) | undefined;

    try {
      // Subscribe before hydrating from the query. A maximize event can arrive
      // between these operations, and the live event is the newer truth.
      unsubscribe = desktopWindow.onMaximizeChanged?.((value) => {
        receivedLiveState = true;
        if (active) setIsMaximized(value === true);
      });
    } catch {
      // A partially available preload bridge should leave the safe default in
      // place instead of preventing the title bar from rendering.
      unsubscribe = undefined;
    }

    if (desktopWindow.isMaximized) {
      // Promise.resolve().then(...) also catches a bridge that throws before it
      // can return its Promise (for example, an older preload implementation).
      void Promise.resolve()
        .then(() => desktopWindow.isMaximized?.())
        .then((value) => {
          // A live maximize/unmaximize event is newer than the initial query.
          // Never let a late query response overwrite that state.
          if (active && !receivedLiveState) setIsMaximized(value === true);
        })
        .catch(() => {
          // Older or partially available desktop bridges keep the safe default.
        });
    }

    return () => {
      active = false;
      try {
        unsubscribe?.();
      } catch {
        // Cleanup must remain safe even if an older bridge has a fragile
        // unsubscribe implementation.
      }
    };
  }, [desktopWindow?.isMaximized, desktopWindow?.onMaximizeChanged]);

  return {
    isMaximized,
    minimize: () => desktopWindow?.minimize?.(),
    toggleMaximize: () => desktopWindow?.maximize?.(),
    close: () => desktopWindow?.close?.(),
    onTitleBarDoubleClick: (event) => {
      // Only the drag region (header surface) should trigger maximize; clicking
      // a no-drag child (tool buttons, traffic lights, tabs) must not.
      const target = event.target as Element | null;
      if (target?.closest?.('button, a, input, select, textarea, [role="button"]')) {
        return;
      }
      desktopWindow?.maximize?.();
    },
  };
}

export function TitleBar(): React.ReactElement {
  const location = useLocation();
  const panels = useWorkspacePanelsContext();
  const win = useDesktopWindowControls();
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
  } = panels.titleBar;

  const displayTitle = title || getFallbackTitle(location.pathname);
  const resizeRail = 1;
  // 102px window-control rail + 32px panel-toggle rail. Keep this in sync
  // with the fixed rails in TitleBar.module.css so collapsed chrome cannot
  // overflow into the result title at narrow widths or renderer zoom levels.
  const collapsedLeftRail = 134;
  const collapsedRightRail = 56;
  const leftSpan = panels.leftOpen ? leftPanelWidth + resizeRail : collapsedLeftRail;
  const rightSpan = panels.rightOpen ? rightPanelWidth + resizeRail : collapsedRightRail;
  const titleBarStyle = {
    ['--titlebar-left-span' as string]: `${leftSpan}px`,
    ['--titlebar-right-span' as string]: `${rightSpan}px`,
  } as React.CSSProperties;

  const isDesktop = typeof window !== 'undefined' && window.biof3Desktop?.isDesktop === true;

  return (
    <header
      className={styles.titleBar}
      style={titleBarStyle}
      onDoubleClick={win.onTitleBarDoubleClick}
    >
      <div className={`${styles.leftZone} ${!panels.leftOpen ? styles.leftZoneCollapsed : ''}`}>
        <div className={styles.trafficZone}>
          {isDesktop ? (
            <>
              <button
                type="button"
                className={`${styles.winBtn} ${styles.winBtnClose}`}
                onClick={win.close}
                aria-label="关闭窗口"
                title="关闭"
              >
                <Icon name="x" size={11} strokeWidth={2.4} />
              </button>
              <button
                type="button"
                className={styles.winBtn}
                onClick={win.minimize}
                aria-label="最小化窗口"
                title="最小化"
              >
                <Icon name="minus" size={11} strokeWidth={2.4} />
              </button>
              <button
                type="button"
                className={styles.winBtn}
                onClick={win.toggleMaximize}
                aria-label={win.isMaximized ? '还原窗口' : '最大化窗口'}
                title={win.isMaximized ? '还原' : '最大化'}
              >
                <Icon
                  name={win.isMaximized ? 'square-stack' : 'square'}
                  size={win.isMaximized ? 10 : 11}
                  strokeWidth={2.2}
                />
              </button>
            </>
          ) : (
            <div className={styles.trafficPlaceholder} aria-hidden="true" />
          )}
        </div>

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

      <div className={`${styles.centerTitle} ${!panels.rightOpen ? styles.centerTitleNoDivider : ''}`}>
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
      </div>
    </header>
  );
}
