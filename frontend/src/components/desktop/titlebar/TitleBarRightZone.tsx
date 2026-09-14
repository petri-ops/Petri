import React from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { useWorkspacePanelsContext } from '../WorkspacePanelsContext';
import styles from '../TitleBar.module.css';
import { getIsMac, parseWorkspaceRoute, WindowControls } from './shared';

/**
 * BLOCK-62 P1a — TitleBar 右区片段（右栏标签 pills +「+」工具菜单 + 底部终端 /
 * 右侧栏开关 + 非 mac 自绘窗口控件）。
 *
 * 容器无关：既被 fixed 整条 [TitleBar.tsx](../TitleBar.tsx) 复用，也被 P1b
 * 列级 header-slot 复用。
 *
 * UI-359 — 路由上下文裁剪：右栏 tab pills 与「底部终端/右侧栏」两个开关只在
 * 工作区路由（/project/:id/*，results 除外——该子路径为独立 ResultStudio 页，
 * 无右栏/底部终端）渲染；其余路由这些面板不存在，不再渲染点了无可见效果的
 * 死开关。窗口控件恒在。
 *
 * UI-361/362 — 指挥中心入口迁入右栏 tab 体系（原 windowTools cpu 按钮移除）。
 * UI-365 — modeUsesRightRail 随 settings 模式退役移除：右栏开合只由路由
 * 与用户偏好决定。
 */
export function TitleBarRightZone(): React.ReactElement {
  const panels = useWorkspacePanelsContext();
  const location = useLocation();
  const isMac = getIsMac();
  const workspacePanelsAvailable = !!parseWorkspaceRoute(location.pathname);
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
      {panels.rightOpen && workspacePanelsAvailable && (
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
        {/* UI-361 — 指挥中心入口迁入壳层左栏底部（LeftSidebarFooter）：
            它是全局单例窗（跨项目/会话的全部作业俯瞰），不属于列级 chrome，
            原先在右栏 header 里视觉上像右栏的附属控件。快捷键 Ctrl/Cmd+Shift+C
            仍为全局（App.tsx）。 */}
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
        {workspacePanelsAvailable && (
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
