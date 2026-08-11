import React from 'react';
import { Icon } from '@/components/icons/Icon';
import { useTerminalSession } from '@/hooks/useTerminalSession';
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
 * Bottom-docked terminal panel that proxies to a desktop node-pty session
 * through `window.biof3Desktop.terminal.*`. The session itself is owned by
 * `useTerminalSession`; this component only handles layout, header, and
 * the clear/close affordances.
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
  const { hostRef, running, clear } = useTerminalSession({
    open,
    workspacePath,
    theme: resolvedTheme,
  });

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
            data-running={running ? 'true' : 'false'}
          />
          <span>终端</span>
          <small>{running ? `${workspacePath || '运行中'}` : '未连接'}</small>
        </div>
        <div>
          <button className="biof3-btn biof3-btn--ghost biof3-btn--sm" type="button" onClick={clear}>清空</button>
          <button className="biof3-btn biof3-btn--icon" type="button" onClick={onClose} aria-label="关闭终端">
            <Icon name="x" size={13} />
          </button>
        </div>
      </div>
      <div ref={hostRef} className={styles.embeddedTerminalHost} />
    </section>
  );
}
