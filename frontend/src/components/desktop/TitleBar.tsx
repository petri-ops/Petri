import React from 'react';
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
  } = panels.titleBar;

  const displayTitle = title || getFallbackTitle(location.pathname);
  const resizeRail = 1;
  const collapsedLeftRail = 122;
  const collapsedRightRail = 56;
  const leftSpan = panels.leftOpen ? leftPanelWidth + resizeRail : collapsedLeftRail;
  const rightSpan = panels.rightOpen ? rightPanelWidth + resizeRail : collapsedRightRail;
  const titleBarStyle = {
    ['--titlebar-left-span' as string]: `${leftSpan}px`,
    ['--titlebar-right-span' as string]: `${rightSpan}px`,
  } as React.CSSProperties;

  return (
    <header className={styles.titleBar} style={titleBarStyle}>
      <div className={`${styles.leftZone} ${!panels.leftOpen ? styles.leftZoneCollapsed : ''}`}>
        <div className={styles.trafficZone} aria-hidden="true" />

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
