/**
 * QuitSummaryDialog — BLOCK-223 退出摘要（Q9 续项）。
 *
 * 只做三件事：把主进程算好的活动计数如实列出来；给三个明确动作；
 * 托盘动作失败时在弹窗内如实报错（不假装已最小化）。
 * 计数与文案由主进程 `desktop-shell-model.quitSummaryRows` 单源产出，
 * 渲染侧不重复维护标签表。
 */

import React from 'react';
import styles from './QuitSummaryDialog.module.css';
import button from '@/components/ui/controls/button.module.css';

interface QuitSummaryRow {
  key: string;
  label: string;
  value: number;
}

export interface QuitSummaryRequest {
  counts: Record<string, number>;
  total: number;
  rows: QuitSummaryRow[];
  reason?: string;
  preview?: boolean;
}

export type QuitDecision = 'cancel' | 'tray' | 'quit';

interface QuitSummaryDialogProps {
  request: QuitSummaryRequest | null;
  error?: string | null;
  onDecision: (action: QuitDecision) => void;
}

export function QuitSummaryDialog({ request, error, onDecision }: QuitSummaryDialogProps): React.ReactElement | null {
  if (!request) return null;
  const rows = Array.isArray(request.rows) ? request.rows.filter((row) => Number(row.value) > 0) : [];
  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="quit-summary-title"
      data-testid="quit-summary-dialog"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDecision('cancel');
      }}
    >
      <div className={styles.card}>
        <h2 id="quit-summary-title" className={styles.title}>仍有正在进行的活动</h2>
        <p className={styles.lead}>
          退出 Petri 会停止本地后端与正在运行的工具。如果还想让它们继续跑，可以先最小化到托盘。
        </p>
        {rows.length > 0 ? (
          <ul className={styles.rows} data-testid="quit-summary-rows">
            {rows.map((row) => (
              <li key={row.key} className={styles.row}>
                <span className={styles.rowLabel}>{row.label}</span>
                <strong className={styles.rowValue}>{row.value}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.lead}>未读到具体活动明细，但仍建议确认后再退出。</p>
        )}
        {request.preview && (
          <p className={styles.note} data-testid="quit-summary-preview">
            这是测试实例的摘要预览：任何选择都不会真正退出应用。
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert" data-testid="quit-summary-error">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" className={button.ghost} onClick={() => onDecision('cancel')} autoFocus>
            取消
          </button>
          <button type="button" className={button.ghostCard} onClick={() => onDecision('tray')}>
            最小化到托盘
          </button>
          <button type="button" className={button.danger} onClick={() => onDecision('quit')}>
            停止并退出
          </button>
        </div>
      </div>
    </div>
  );
}
