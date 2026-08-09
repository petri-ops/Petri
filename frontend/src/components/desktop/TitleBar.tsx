import React, { useEffect, useRef, useState } from 'react';
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

const isDesktop =
  typeof window !== 'undefined' && window.biof3Desktop?.isDesktop === true;

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
    resultItems,
    activeResultId,
    onSelectResult,
  } = panels.titleBar;

  const [resultMenuOpen, setResultMenuOpen] = useState(false);
  const resultTriggerRef = useRef<HTMLButtonElement>(null);
  const resultMenuItemsRef = useRef<Record<string, HTMLButtonElement | null>>({});
  const activeResult = resultItems.find((item) => item.id === activeResultId) || resultItems[0] || null;

  const closeResultMenu = () => {
    setResultMenuOpen(false);
    resultTriggerRef.current?.focus();
  };

  const selectResult = (id: string) => {
    onSelectResult?.(id);
    closeResultMenu();
  };

  useEffect(() => {
    if (resultItems.length < 2 && resultMenuOpen) {
      setResultMenuOpen(false);
    }
  }, [resultItems.length, resultMenuOpen]);

  useEffect(() => {
    if (!resultMenuOpen || resultItems.length < 2 || !activeResult) return;
    resultMenuItemsRef.current[activeResult.id]?.focus();
  }, [activeResult, resultItems, resultMenuOpen]);

  useEffect(() => {
    if (!resultMenuOpen) return undefined;

    const handleResultMenuDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeResultMenu();
    };
    const handleWindowResize = () => setResultMenuOpen(false);

    document.addEventListener('keydown', handleResultMenuDocumentKeyDown);
    window.addEventListener('resize', handleWindowResize);
    return () => {
      document.removeEventListener('keydown', handleResultMenuDocumentKeyDown);
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [resultMenuOpen]);

  const moveResultFocus = (currentIndex: number, offset: number) => {
    if (resultItems.length === 0) return;
    const nextIndex = (currentIndex + offset + resultItems.length) % resultItems.length;
    resultMenuItemsRef.current[resultItems[nextIndex].id]?.focus();
  };

  const handleResultMenuItemKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    itemId: string,
    itemIndex: number,
  ) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveResultFocus(itemIndex, 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveResultFocus(itemIndex, -1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      resultMenuItemsRef.current[resultItems[0].id]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      resultMenuItemsRef.current[resultItems[resultItems.length - 1].id]?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectResult(itemId);
    }
  };

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
    <header
      className={styles.titleBar}
      style={titleBarStyle}
      onDoubleClick={!isMac ? win.onTitleBarDoubleClick : undefined}
    >
      <div className={styles.leftZone}>
        {isMac && (
          <div className={styles.trafficZone}>
            {isDesktop ? (
              <>
                <button
                  type="button"
                  className={`${styles.macTrafficBtn} ${styles.macTrafficBtnClose}`}
                  onClick={win.close}
                  aria-label="关闭窗口"
                  title="关闭"
                >
                  <Icon name="x" size={11} strokeWidth={2.4} />
                </button>
                <button
                  type="button"
                  className={styles.macTrafficBtn}
                  onClick={win.minimize}
                  aria-label="最小化窗口"
                  title="最小化"
                >
                  <Icon name="minus" size={11} strokeWidth={2.4} />
                </button>
                <button
                  type="button"
                  className={styles.macTrafficBtn}
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

      <div className={`${styles.centerTitle} ${!panels.rightOpen ? styles.centerTitleNoDivider : ''}`}>
        <div className={styles.centerTitleMain}>
          <Icon name="folder" size={15} />
          <span className={styles.centerTitleText}>{displayTitle}</span>
        </div>
        {activeResult && (
          <div className={styles.resultPicker}>
            <button
              type="button"
              className={styles.resultPrimary}
              onClick={() => selectResult(activeResult.id)}
              title={`打开${activeResult.label}`}
            >
              <span>结果 {resultItems.length}</span>
            </button>
            {resultItems.length > 1 && (
              <button
                type="button"
                ref={resultTriggerRef}
                className={styles.resultMenuTrigger}
                onClick={() => setResultMenuOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setResultMenuOpen(true);
                  }
                }}
                title="展开结果列表"
                aria-label={resultMenuOpen ? '收起结果列表' : '展开结果列表'}
                aria-haspopup="menu"
                aria-expanded={resultMenuOpen}
                aria-controls="titlebar-result-menu"
              >
                <Icon name="chevron-down" size={13} />
              </button>
            )}
            {resultMenuOpen && resultItems.length > 1 && (
              <>
                <button
                  type="button"
                  className={styles.resultMenuOverlay}
                  onClick={closeResultMenu}
                  aria-label="关闭结果菜单"
                />
                <div
                  id="titlebar-result-menu"
                  className={styles.resultMenu}
                  role="menu"
                  aria-label="结果列表"
                >
                  {resultItems.map((item, itemIndex) => {
                    const isActive = item.id === activeResult.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        ref={(node) => {
                          resultMenuItemsRef.current[item.id] = node;
                        }}
                        className={`${styles.resultMenuItem} ${isActive ? styles.resultMenuItemActive : ''}`}
                        role="menuitem"
                        aria-current={isActive ? 'true' : undefined}
                        tabIndex={isActive ? 0 : -1}
                        data-result-id={item.id}
                        onClick={() => selectResult(item.id)}
                        onKeyDown={(event) => handleResultMenuItemKeyDown(event, item.id, itemIndex)}
                      >
                        <span className={styles.resultMenuItemLabel}>{item.label}</span>
                        <span className={styles.resultMenuItemStatus} data-status={item.status}>
                          {item.status}
                        </span>
                        {isActive && <Icon name="check" size={13} />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
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
