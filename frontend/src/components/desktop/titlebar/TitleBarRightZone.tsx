import React from 'react';
import { Icon } from '@/components/icons/Icon';
import { getBridge } from '@/lib/desktopBridge';
import { useWorkspacePanelsContext } from '../WorkspacePanelsContext';
import styles from '../TitleBar.module.css';
import { getIsMac, WindowControls } from './shared';

/**
 * BLOCK-62 P1a — TitleBar 右区片段（右栏标签 pills +「+」工具菜单 + 底部终端 /
 * 右侧栏 / 指挥中心开关 + 非 mac 自绘窗口控件）。
 *
 * 容器无关：既被 fixed 整条 [TitleBar.tsx](../TitleBar.tsx) 复用，也被 P1b
 * 列级 header-slot 复用。逻辑与提取前一字不动。
 */
export function TitleBarRightZone(): React.ReactElement {
  const panels = useWorkspacePanelsContext();
  const isMac = getIsMac();
  const {
    tabs,
    activeTabId,
    onSelectTab,
    onCloseTab,
    onMoreAction,
    toolMenuOpen,
    toolMenuItems,
    onSelectToolItem,
  } = panels.titleBar;

  return (
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
        {/* BLOCK-59 P3 — 指挥中心入口（多任务俯瞰单例窗，随开随关） */}
        {getBridge('windowManager') && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => void getBridge('windowManager')!.popOut('command-center')}
            title="打开指挥中心（全部作业实时俯瞰）"
            aria-label="打开指挥中心"
          >
            <Icon name="cpu" size={15} />
          </button>
        )}
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
  );
}
