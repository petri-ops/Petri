import React from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { getBridge } from '@/lib/desktopBridge';
import { useWorkspacePanelsContext } from '../WorkspacePanelsContext';
import styles from '../TitleBar.module.css';
import { getIsMac, modeUsesRightRail, parseWorkspaceRoute, WindowControls } from './shared';

/**
 * BLOCK-62 P1a — TitleBar 右区片段（右栏标签 pills +「+」工具菜单 + 底部终端 /
 * 右侧栏 / 指挥中心开关 + 非 mac 自绘窗口控件）。
 *
 * 容器无关：既被 fixed 整条 [TitleBar.tsx](../TitleBar.tsx) 复用，也被 P1b
 * 列级 header-slot 复用。
 *
 * UI-359 — 路由上下文裁剪：右栏 tab pills 与「底部终端/右侧栏」两个开关只在
 * 工作区路由（/project/:id/*，results 除外——该子路径为独立 ResultStudio 页，
 * 无右栏/底部终端）渲染；其余路由这些面板不存在，不再渲染点了无可见效果的
 * 死开关。指挥中心（全局弹窗入口）与窗口控件恒在。
 *
 * UI-360 — 模式上下文裁剪：plugins / settings 是占满中栏的全屏工作面，右侧栏
 * 随模式隐藏（见 modeUsesRightRail），「右侧栏」开关与右栏 tab pills 一并裁剪，
 * 「底部终端」仍可用（终端与模式无关）。
 */
export function TitleBarRightZone(): React.ReactElement {
  const panels = useWorkspacePanelsContext();
  const location = useLocation();
  const isMac = getIsMac();
  const workspaceRoute = parseWorkspaceRoute(location.pathname);
  const workspacePanelsAvailable = !!workspaceRoute;
  const rightRailUsable = !!workspaceRoute && modeUsesRightRail(workspaceRoute.mode);
  // 快捷键监听器挂 ProjectWorkspace（useWorkspacePanelShortcuts），提示跟随平台记法。
  const rightToggleHint = isMac ? '（⌘⇧B）' : '（Ctrl+Shift+B）';
  const terminalToggleHint = isMac ? '（⌘`）' : '（Ctrl+`）';
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
      {panels.rightOpen && rightRailUsable && (
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
        {workspacePanelsAvailable && (
          <button
            type="button"
            className={`${styles.iconBtn} ${!panels.bottomTerminalOpen ? styles.iconBtnInactive : ''}`}
            onClick={panels.toggleBottomTerminal}
            title={`${panels.bottomTerminalOpen ? '收起底部终端' : '展开底部终端'}${terminalToggleHint}`}
            aria-label={panels.bottomTerminalOpen ? '收起底部终端' : '展开底部终端'}
          >
            <Icon name="panel-bottom" size={15} />
          </button>
        )}
        {rightRailUsable && (
          <button
            type="button"
            className={`${styles.iconBtn} ${!panels.rightOpen ? styles.iconBtnInactive : ''}`}
            onClick={panels.toggleRight}
            title={`${panels.rightOpen ? '收起右侧栏' : '展开右侧栏'}${rightToggleHint}`}
            aria-label={panels.rightOpen ? '收起右侧栏' : '展开右侧栏'}
          >
            <Icon name="panel-right" size={15} />
          </button>
        )}
      </div>

      {!isMac && <WindowControls />}
    </div>
  );
}
