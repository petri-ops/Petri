import React from 'react';
import { Icon } from '@/components/icons/Icon';
import { buildMessageStatsView } from './messageStats';
import styles from './MessageStatsPanel.module.css';
import type { SimpleMessage } from './types';

export interface MessageStatsPanelProps {
  message: SimpleMessage;
  onClose: () => void;
  id?: string;
}

/**
 * BLOCK-255 C4 — 本条助手回复的统计面板。
 *
 * 纯展示：数据全部来自消息本身（耗时/工具/迭代/字符 + meta.usage 或实时合计）。
 * 无 usage 时显示「未记录」与原因，不把不可算写成 0。
 */
export function MessageStatsPanel({ message, onClose, id }: MessageStatsPanelProps): React.ReactElement {
  const view = buildMessageStatsView(message);
  return (
    <div className={styles.panel} id={id} role="region" aria-label="本条消息统计" data-testid="msg-stats-panel">
      <div className={styles.head}>
        <span className={styles.title}>本条统计</span>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="关闭统计"
          data-testid="msg-stats-close"
        >
          <Icon name="x" size={12} />
        </button>
      </div>
      <dl className={styles.grid}>
        {view.rows.map((row) => (
          <div className={styles.row} key={row.label}>
            <dt>{row.label}</dt>
            <dd title={row.title}>{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.note} data-testid="msg-stats-note">{view.note}</p>
    </div>
  );
}
