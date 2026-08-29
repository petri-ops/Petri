import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { useWorkspacePanelsContext } from './WorkspacePanelsContext';
import { getBridge } from '@/lib/desktopBridge';
import { biof3Events, subscribeBioF3Event } from '@/lib/events';
import { BranchTabsWrapper } from '@/components/branch/BranchTabsWrapper';
import styles from './TitleBar.module.css';

/**
 * True when running inside the BioF3 desktop app on macOS, where the OS
 * draws native traffic-light controls (left side) and we must NOT render
 * custom window controls. On Windows/Linux the window is frameless, so we
 * draw our own buttons.
 */
// 惰性求值（不要提成模块级常量）：模块级常量在 import 时就固化，测试里通过
// vi.stubGlobal 注入 window.biof3Desktop 发生在 import 之后，会导致这两个判定
// 永远为 false、窗口控件根本不渲染，整个测试文件集体失败。
function getIsMac(): boolean {
  return typeof window !== 'undefined' && window.biof3Desktop?.platform === 'darwin';
}

function getIsDesktop(): boolean {
  return typeof window !== 'undefined' && window.biof3Desktop?.isDesktop === true;
}

/**
 * Working Tree Review toggle button integrated into TitleBar.
 * BLOCK-28：改为打开主区一级审阅模式（路由 /review）——旧侧边抽屉已退役。
 * 再次点击返回上一页（无历史时回首页）。进入 /review 时清除圆点提示；
 * 不在审阅模式时收到 agent:task-done（agent 完成改动）则亮起圆点。
 * Desktop-only: in browser dev (no biof3Desktop.isDesktop) the button is hidden.
 */
function WorkingTreeReviewTitleBarButton(): React.ReactElement | null {
  const navigate = useNavigate();
  const location = useLocation();
  const isDesktop = getIsDesktop();
  const [hasNewChanges, setHasNewChanges] = useState(false);
  const isReviewMode = location.pathname === '/review';

  useEffect(() => {
    if (isReviewMode) {
      setHasNewChanges(false);
      return;
    }
    return subscribeBioF3Event(biof3Events.agentTaskDone, () => setHasNewChanges(true));
  }, [isReviewMode]);

  if (!isDesktop) return null;
  const handleClick = () => {
    if (isReviewMode) {
      if (window.history.length > 1) navigate(-1);
      else navigate('/');
    } else {
      navigate('/review');
    }
  };
  const title = isReviewMode ? '退出 Code Review' : '打开 Code Review';
  return (
    <button
      type="button"
      className={`${styles.iconBtn} ${isReviewMode ? '' : styles.iconBtnInactive}`}
      onClick={handleClick}
      title={title}
      aria-label={title}
      aria-pressed={isReviewMode}
      data-testid="working-tree-review-button"
    >
      <Icon name="git-branch" size={15} />
      {hasNewChanges && <span className={styles.reviewDot} aria-hidden="true" />}
    </button>
  );
}

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
  toggleFullScreen: () => void;
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
    toggleFullScreen: () => desktopWindow?.toggleFullScreen?.(),
    close: () => desktopWindow?.close?.(),
    onTitleBarDoubleClick: (event) => {
      const target = event.target as Element | null;
      if (target?.closest?.('button, a, input, select, textarea, [role="button"]')) {
        return;
      }
      desktopWindow?.toggleFullScreen?.();
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

  // Get conversations from WorkspacePanels context (set by ProjectWorkspace)
  const conversations = panels.titleBar.conversations || [];
  const activeConvId = panels.titleBar.activeConvId;
  const onSelectConversation = panels.titleBar.onSelectConversation;
  const [convDropdownOpen, setConvDropdownOpen] = useState(false);
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
  const isMac = getIsMac();
  const isDesktop = getIsDesktop();
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

      <div className={`${styles.centerTitle} ${!panels.rightOpen ? styles.centerTitleNoDivider : ''}`}>
        <div className={styles.centerTitleMain}>
          <Icon name="folder" size={15} />
          <span className={styles.centerTitleText}>{displayTitle}</span>
        </div>
        <BranchTabsWrapper />
        {/* Conversation selector — between branch tabs and result picker */}
        {conversations.length > 0 && (
          <div className={styles.convSelector}>
            <button
              type="button"
              className={styles.convSelectorBtn}
              onClick={() => setConvDropdownOpen((o) => !o)}
              title="切换会话"
              aria-label="切换会话"
              aria-expanded={convDropdownOpen}
            >
              <Icon name="message-circle" size={13} />
              <span className={styles.convSelectorText}>
                {conversations.find(c => c.id === activeConvId)?.title?.slice(0, 12) ||
                 conversations[0]?.title?.slice(0, 12) ||
                 '会话'}
              </span>
              <Icon name={convDropdownOpen ? 'chevron-up' : 'chevron-down'} size={11} />
            </button>
            {convDropdownOpen && (
              <>
                <button
                  type="button"
                  className={styles.convSelectorOverlay}
                  onClick={() => setConvDropdownOpen(false)}
                  aria-label="关闭会话列表"
                />
                <div className={styles.convSelectorDropdown}>
                  {conversations.map((conv) => (
                    <button
                      key={conv.id}
                      type="button"
                      className={styles.convSelectorItem}
                      onClick={() => {
                        onSelectConversation?.(conv.id);
                        setConvDropdownOpen(false);
                      }}
                    >
                      <Icon name={conv.parent_id ? 'git-branch' : 'message-circle'} size={12} />
                      <span>{conv.title || '无标题会话'}</span>
                      {conv.parent_id && (
                        <span className={styles.convSelectorBadge}>分支</span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
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
                aria-controls="titlebar-tool-menu"
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
                  <div id="titlebar-tool-menu" className={styles.toolMenu} role="menu">
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
          <WorkingTreeReviewTitleBarButton />
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
