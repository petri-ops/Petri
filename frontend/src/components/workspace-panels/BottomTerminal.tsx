import React, { useEffect } from 'react';
import { Icon } from '@/components/icons/Icon';
import { useTerminalTabs } from '@/hooks/useTerminalTabs';
import { terminalTabLabel, terminalTabSubtitle } from '@/hooks/terminalTabs';
import { useTheme } from '@/themes/ThemeProvider';
import { getBridge } from '@/lib/desktopBridge';
import styles from '@/pages/project-workspace.module.css';

export interface BottomTerminalProps {
  open: boolean;
  height: number;
  /** number 或 CSS var() 字符串（UI-309 拖动期实时跟随侧栏宽度） */
  leftOffset: number | string;
  rightOffset: number | string;
  workspacePath?: string;
  /** BLOCK-67：SSH 远程项目终端（ssh pty 直挂）。 */
  ssh?: { alias: string; remotePath: string };
  onResize: (event: React.MouseEvent) => void;
  onClose: () => void;
}

/**
 * BLOCK-54 P2 — 底部多 Tab 终端面板。
 *
 * - 每个 tab 独立 xterm 实例与 node-pty 会话（会话归 `useTerminalTabs` 管），
 *   本组件只负责布局、tab 条与清空/关闭面板等 affordance。
 * - 打开面板且无 tab 时自动开第一个（保持旧单终端「打开即用」体验）。
 * - 上限 4：后端 terminal.js 与前端 terminalTabs.ts 双端同值，第 5 个诚实拒绝。
 * - UI-363（用户裁决：外层「终端 新标签/清空/×」标题行冗余）——砍掉独立
 *   header，对标 VS Code 面板单行布局：tab 与「+」居左，清空/关闭面板居右。
 *   面板开关仍可经顶栏「底部终端」toggle 与 Ctrl/Cmd+`。
 */
export function BottomTerminal({
  open,
  height,
  leftOffset,
  rightOffset,
  workspacePath,
  ssh,
  onResize,
  onClose,
}: BottomTerminalProps): React.ReactElement {
  const { resolvedTheme } = useTheme();
  // BLOCK-59 P2 — 终端 Tab 升格为独立窗（同一会话第二活视图，主窗 tab 保活）
  const windowManagerBridge = getBridge('windowManager');
  const [splitId, setSplitId] = React.useState<string | null>(null);
  const {
    tabs,
    activeId,
    setActive,
    openTab,
    closeTab,
    registerHost,
    limitNotice,
    dismissLimitNotice,
    clear,
    runningBy,
  } = useTerminalTabs({ open, workspacePath, ssh, theme: resolvedTheme, secondaryId: splitId });
  // 双 pane 不允许同一 tab 同时占两栏；关闭/切换后自动收敛。
  if (splitId && (!tabs.some((tab) => tab.id === splitId) || splitId === activeId)) setSplitId(null);

  // 打开面板且尚无任何 tab → 自动开第一个（懒启动，此刻才拉起 pty）。
  useEffect(() => {
    if (open && tabs.length === 0) openTab();
  }, [open, tabs.length, openTab]);

  const activateTab = (id: string) => {
    // 点已分屏 tab = 两栏交换，保持两个 pane 不同 tab。
    if (splitId === id) setSplitId(activeId);
    setActive(id);
  };
  const closeOne = (id: string) => {
    closeTab(id);
    if (splitId === id) setSplitId(null);
  };
  const toggleSplit = () => {
    if (splitId) { setSplitId(null); return; }
    const other = tabs.find((tab) => tab.id !== activeId);
    if (other) { setSplitId(other.id); return; }
    const previous = activeId;
    const newId = openTab();
    if (newId) {
      setSplitId(newId);
      if (previous) setActive(previous);
    }
  };

  // 上限提示 4s 自动消隐。
  useEffect(() => {
    if (!limitNotice) return undefined;
    const handle = window.setTimeout(dismissLimitNotice, 4000);
    return () => window.clearTimeout(handle);
  }, [limitNotice, dismissLimitNotice]);

  return (
    <section
      className={`${styles.embeddedTerminal} ${open ? styles.embeddedTerminalOpen : ''}`}
      style={{ height: open ? height : 0, left: leftOffset, right: rightOffset }}
      aria-hidden={!open}
      data-petri-motion="functional"
    >
      <div className={styles.embeddedTerminalResize} onMouseDown={onResize} />
      <div className={styles.embeddedTerminalTabs} role="tablist" aria-label="终端标签">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          const label = terminalTabLabel(tab);
          return (
            <div
              key={tab.id}
              className={`${styles.embeddedTerminalTab} ${isActive ? styles.embeddedTerminalTabActive : ''} ${tab.id === splitId ? styles.embeddedTerminalTabSplit : ''}`}
              data-exited={tab.exited ? 'true' : 'false'}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                title={tab.cwd || label}
                className={styles.embeddedTerminalTabLabel}
                onClick={() => activateTab(tab.id)}
              >
                <span
                  aria-hidden
                  className={styles.embeddedTerminalTabDot}
                  data-running={runningBy[tab.id] ? 'true' : 'false'}
                />
                <span>{label}</span>
                {terminalTabSubtitle(tab) ? (
                  <small>{terminalTabSubtitle(tab)}</small>
                ) : null}
              </button>
              {windowManagerBridge && (
                <button
                  type="button"
                  className={styles.embeddedTerminalTabClose}
                  aria-label={`升格 ${label} 为独立窗`}
                  title="升格为独立窗（同一会话第二视图，主窗标签保活）"
                  onClick={() => void windowManagerBridge.popOut('terminal', tab.id)}
                >
                  <Icon name="arrow-right" size={10} />
                </button>
              )}
              <button
                type="button"
                className={styles.embeddedTerminalTabClose}
                aria-label={`关闭 ${label}`}
                onClick={() => closeOne(tab.id)}
              >
                <Icon name="x" size={10} />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className={styles.embeddedTerminalTabAdd}
          aria-label="新建终端标签"
          title={tabs.length >= 4 ? '最多同时打开 4 个终端标签' : '新建终端标签'}
          onClick={openTab}
        >
          <Icon name="plus" size={12} />
        </button>
        <div className={styles.embeddedTerminalTabActions}>
          {limitNotice ? (
            <span className={styles.embeddedTerminalNotice} role="status">
              {limitNotice}
            </span>
          ) : null}
          <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" onClick={toggleSplit} data-testid="terminal-split-toggle" aria-pressed={Boolean(splitId)} title={splitId ? '退出分屏' : '分屏（第二个终端 pane）'}>
            <Icon name="panel-right" size={12} />
            {splitId ? '取消分屏' : '分屏'}
          </button>
          <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" onClick={clear}>清空</button>
          <button className="petri-btn petri-btn--icon" type="button" onClick={onClose} aria-label="关闭终端面板" title="关闭终端面板">
            <Icon name="x" size={13} />
          </button>
        </div>
      </div>
      <div className={`${styles.embeddedTerminalBody} ${splitId ? styles.embeddedTerminalBodySplit : ''}`} data-split={splitId ? 'true' : 'false'}>
        {tabs.map((tab) => {
          const visible = tab.id === activeId || tab.id === splitId;
          return (
            <div
              key={tab.id}
              ref={registerHost(tab.id)}
              className={`${styles.embeddedTerminalHost} ${visible ? '' : styles.embeddedTerminalHostHidden}`}
              data-tab-body={tab.id}
              aria-hidden={!visible}
            />
          );
        })}
      </div>
    </section>
  );
}
