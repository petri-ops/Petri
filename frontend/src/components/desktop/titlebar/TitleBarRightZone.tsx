import React from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { formatShortstatBadge } from '@/components/copilot/conversationChangesStore';
import { useWorkspacePanelsContext } from '../WorkspacePanelsContext';
import styles from '../TitleBar.module.css';
import { getIsMac, getIsProjection, parseWorkspaceRoute, WindowControls } from './shared';
import { NotificationCenterBell } from './NotificationCenterBell';

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
    onCloseOtherTabs,
    onCloseTabsToRight,
    onCloseAllTabs,
    onMoreAction,
    toolMenuOpen,
    toolMenuItems,
    onSelectToolItem,
  } = panels.titleBar;
  // BLOCK-216 Q5 — tab 生命周期菜单（close / others / right / all）
  const [tabMenu, setTabMenu] = React.useState<{ x: number; y: number; id: string; label: string } | null>(null);
  const moreButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const [menuAnchor, setMenuAnchor] = React.useState<{ top: number; right: number } | null>(null);
  const tabsRailRef = React.useRef<HTMLDivElement | null>(null);

  // 多 surface 横向滚动后，激活项必须自动回到视野（新开 pack 视图不在首屏时尤其重要）。
  React.useEffect(() => {
    if (!activeTabId) return;
    const rail = tabsRailRef.current;
    if (!rail) return;
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(activeTabId) : activeTabId;
    const el = rail.querySelector(`[data-tab-id="${escaped}"]`);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId, tabs.length]);

  React.useEffect(() => {
    if (!tabMenu) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTabMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tabMenu]);

  return (
    <div className={`${styles.rightZone} ${!panels.rightOpen ? styles.rightZoneCollapsed : ''}`}>
      {panels.rightOpen && workspacePanelsAvailable && (
        <div className={styles.tabsRail} ref={tabsRailRef}>
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                data-tab-id={tab.id}
                className={`${styles.tabPill} ${active ? styles.tabPillActive : ''}`}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setTabMenu({ x: event.clientX, y: event.clientY, id: tab.id, label: tab.label });
                }}
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
                  {/* UI-446 v4 — tab 级未审文件数徽章；UI-449（C-16）带 ±行数（git shortstat 权威源） */}
                  {tab.reviewCount ? (
                    <span className={styles.tabCountBadge} data-testid="review-tab-count">{formatShortstatBadge(tab.reviewCount, tab.reviewStat)}</span>
                  ) : null}
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
              ref={moreButtonRef}
              type="button"
              className={styles.iconBtn}
              onClick={() => {
                const rect = moreButtonRef.current?.getBoundingClientRect();
                if (rect) setMenuAnchor({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
                onMoreAction?.();
              }}
              title="展开更多工具"
              aria-label="展开更多工具"
              aria-haspopup="menu"
              aria-expanded={toolMenuOpen}
              aria-controls="titlebar-tool-menu"
            >
              {/* UI-606 — 图标从 plus 换 more-horizontal：plus 语义是「新建」，与
                  「更多工具面板」菜单行为错位——用户点 + 预期新建项，弹出工具清单
                  即体感「点击无效」。more-horizontal（⋯）准确表达「更多」。 */}
              <Icon name="more-horizontal" size={15} />
              {/* UI-446 v4 — 审阅 tab 未打开时，计数徽章挂此按钮引导入口（点开审阅即熄）。
                  注意 >0 判定：&& 直接接 reviewCount 会在 0 时把数字渲染出来（React 渲染 falsy 数字）。 */}
              {(panels.titleBar.reviewCount ?? 0) > 0 && !tabs.some((tab) => tab.id === 'review') && (
                <span className={styles.tabCountBadge} data-testid="review-menu-count">{formatShortstatBadge(panels.titleBar.reviewCount ?? 0, panels.titleBar.reviewStat)}</span>
              )}
            </button>
            {toolMenuOpen && createPortal(
              <>
                <button
                  type="button"
                  className={styles.toolMenuOverlay}
                  onClick={() => onMoreAction?.()}
                  aria-label="关闭工具菜单"
                />
                <div
                  id="titlebar-tool-menu"
                  className={styles.toolMenu}
                  role="menu"
                  style={{ position: 'fixed', top: menuAnchor?.top ?? 42, right: menuAnchor?.right ?? 12, left: 'auto' }}
                >
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
                      {/* UI-446 v4 — 菜单内审阅入口的未审文件数徽章（与 + 钮/药丸同源） */}
                      {item.id === 'review' && panels.titleBar.reviewCount ? (
                        <span className={styles.tabCountBadge} data-testid="review-menu-item-count">{panels.titleBar.reviewCount}</span>
                      ) : null}
                      {item.isOpen && <Icon name="check" size={13} />}
                    </button>
                  ))}
                </div>
              </>,
              document.body,
            )}
          </div>
        </div>
      )}

      {tabMenu && (
        <>
          <button
            type="button"
            className={styles.toolMenuOverlay}
            onClick={() => setTabMenu(null)}
            aria-label="关闭标签菜单"
          />
          <div
            className={styles.toolMenu}
            role="menu"
            data-testid="work-surface-tab-menu"
            style={{ position: 'fixed', left: tabMenu.x, top: tabMenu.y, zIndex: 60 }}
          >
            <button
              type="button"
              className={styles.toolMenuItem}
              role="menuitem"
              disabled={!onCloseTab}
              onClick={() => { onCloseTab?.(tabMenu.id); setTabMenu(null); }}
            >
              关闭
            </button>
            <button
              type="button"
              className={styles.toolMenuItem}
              role="menuitem"
              disabled={!onCloseOtherTabs}
              onClick={() => { onCloseOtherTabs?.(tabMenu.id); setTabMenu(null); }}
            >
              关闭其他
            </button>
            <button
              type="button"
              className={styles.toolMenuItem}
              role="menuitem"
              disabled={!onCloseTabsToRight}
              onClick={() => { onCloseTabsToRight?.(tabMenu.id); setTabMenu(null); }}
            >
              关闭右侧
            </button>
            <button
              type="button"
              className={styles.toolMenuItem}
              role="menuitem"
              disabled={!onCloseAllTabs}
              onClick={() => { onCloseAllTabs?.(); setTabMenu(null); }}
            >
              全部关闭
            </button>
          </div>
        </>
      )}

      <div className={styles.windowTools}>
        <NotificationCenterBell />
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

      {/* BLOCK-87 L3-2 — 投影环境（手机/平板浏览器）下窗口控件是垫片 no-op
          死按钮（截图实证：— □ × 常驻手机顶栏右端），一律隐藏。
          UI-377 — 非工作区路由 windowTools 为空，windowControls 左缘分隔线
          无所分隔（悬空线），随路由撤下。 */}
      {!isMac && !getIsProjection() && <WindowControls divider={workspacePanelsAvailable} />}
    </div>
  );
}
