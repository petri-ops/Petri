import React, { useEffect } from 'react';
import { Icon } from '@/components/icons/Icon';
import { useTerminalTabs } from '@/hooks/useTerminalTabs';
import { terminalTabLabel, terminalTabSubtitle } from '@/hooks/terminalTabs';
import { useTheme } from '@/themes/ThemeProvider';
import styles from '@/pages/project-workspace.module.css';

export interface BottomTerminalProps {
  open: boolean;
  height: number;
  leftOffset: number;
  rightOffset: number;
  workspacePath?: string;
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
 */
export function BottomTerminal({
  open,
  height,
  leftOffset,
  rightOffset,
  workspacePath,
  onResize,
  onClose,
}: BottomTerminalProps): React.ReactElement {
  const { resolvedTheme } = useTheme();
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
    activeRunning,
    runningBy,
  } = useTerminalTabs({ open, workspacePath, theme: resolvedTheme });

  const activeTab = tabs.find((t) => t.id === activeId) || null;

  // 打开面板且尚无任何 tab → 自动开第一个（懒启动，此刻才拉起 pty）。
  useEffect(() => {
    if (open && tabs.length === 0) openTab();
  }, [open, tabs.length, openTab]);

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
    >
      <div className={styles.embeddedTerminalResize} onMouseDown={onResize} />
      <div className={styles.embeddedTerminalHeader}>
        <div>
          <span
            aria-hidden
            className={styles.embeddedTerminalStatusDot}
            data-running={activeRunning ? 'true' : 'false'}
          />
          <span>终端</span>
          <small>{activeTab ? terminalTabSubtitle(activeTab) || '新标签' : '未连接'}</small>
          {limitNotice ? (
            <span className={styles.embeddedTerminalNotice} role="status">
              {limitNotice}
            </span>
          ) : null}
        </div>
        <div>
          <button className="biof3-btn biof3-btn--ghost biof3-btn--sm" type="button" onClick={clear}>清空</button>
          <button className="biof3-btn biof3-btn--icon" type="button" onClick={onClose} aria-label="关闭终端面板">
            <Icon name="x" size={13} />
          </button>
        </div>
      </div>
      <div className={styles.embeddedTerminalTabs} role="tablist" aria-label="终端标签">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          const label = terminalTabLabel(tab);
          return (
            <div
              key={tab.id}
              className={`${styles.embeddedTerminalTab} ${isActive ? styles.embeddedTerminalTabActive : ''}`}
              data-exited={tab.exited ? 'true' : 'false'}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                title={tab.cwd || label}
                className={styles.embeddedTerminalTabLabel}
                onClick={() => setActive(tab.id)}
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
              <button
                type="button"
                className={styles.embeddedTerminalTabClose}
                aria-label={`关闭 ${label}`}
                onClick={() => closeTab(tab.id)}
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
      </div>
      <div className={styles.embeddedTerminalBody}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            ref={registerHost(tab.id)}
            className={`${styles.embeddedTerminalHost} ${tab.id === activeId ? '' : styles.embeddedTerminalHostHidden}`}
            data-tab-body={tab.id}
            aria-hidden={tab.id !== activeId}
          />
        ))}
      </div>
    </section>
  );
}
