/**
 * QuitSummaryDialog — BLOCK-223 退出摘要（Q9 续项）。
 *
 * 只做三件事：把主进程算好的活动计数如实列出来；给三个明确动作；
 * 托盘动作失败时在弹窗内如实报错（不假装已最小化）。
 * 计数与文案由主进程 `desktop-shell-model.quitSummaryRows` 单源产出，
 * 渲染侧不重复维护标签表。
 */

import React, { useCallback, useState } from 'react';
import styles from './QuitSummaryDialog.module.css';
import button from '@/components/ui/controls/button.module.css';
import { describeActivityAction } from '@/lib/activity-control';
import type { ActivityActionOutcome } from '@/lib/activity-control';

interface QuitSummaryRow {
  key: string;
  label: string;
  value: number;
}

export interface QuitSummaryItem {
  kind: 'toolJob' | 'task' | 'subagentTask' | 'approval';
  id: string;
  label: string;
  status?: string;
  projectId?: string | null;
  conversationId?: string | null;
  taskId?: string | null;
}

export interface QuitSummaryRequest {
  counts: Record<string, number>;
  total: number;
  rows: QuitSummaryRow[];
  items?: QuitSummaryItem[];
  fetchedAt?: string | null;
  reason?: string;
  preview?: boolean;
}

export type QuitDecision = 'cancel' | 'tray' | 'quit';

interface ItemActionState {
  busy: boolean;
  outcome: ActivityActionOutcome | null;
}

interface QuitSummaryDialogProps {
  request: QuitSummaryRequest | null;
  error?: string | null;
  /** 每次主进程重新出摘要就 +1；动作结果只属于出它的那一轮，避免旧结果误导。 */
  summaryVersion?: number;
  onDecision: (action: QuitDecision) => void;
  onOpenItem?: (item: QuitSummaryItem) => void;
  onStopItem?: (item: QuitSummaryItem) => Promise<ActivityActionOutcome>;
}

const EMPTY_ACTIONS = new Map<string, ItemActionState>();

export function QuitSummaryDialog({
  request,
  error,
  summaryVersion = 0,
  onDecision,
  onOpenItem,
  onStopItem,
}: QuitSummaryDialogProps): React.ReactElement | null {
  const [stored, setStored] = useState<{ version: number; actions: Map<string, ItemActionState> }>({
    version: 0,
    actions: EMPTY_ACTIONS,
  });
  const actions = stored.version === summaryVersion ? stored.actions : EMPTY_ACTIONS;

  const mark = useCallback((key: string, state: ItemActionState): void => {
    setStored((prev) => {
      const base = prev.version === summaryVersion ? prev.actions : EMPTY_ACTIONS;
      const next = new Map(base);
      next.set(key, state);
      return { version: summaryVersion, actions: next };
    });
  }, [summaryVersion]);

  const runStop = useCallback((item: QuitSummaryItem): void => {
    if (!onStopItem) return;
    const key = `${item.kind}:${item.id}`;
    mark(key, { busy: true, outcome: null });
    void onStopItem(item).then(
      (outcome) => mark(key, { busy: false, outcome }),
      () => mark(key, { busy: false, outcome: { ok: false, reason: 'renderer_error', message: '停止请求未能发出。' } }),
    );
  }, [mark, onStopItem]);

  if (!request) return null;
  const rows = Array.isArray(request.rows) ? request.rows.filter((row) => Number(row.value) > 0) : [];
  const items = Array.isArray(request.items) ? request.items.slice(0, 10) : [];
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
        {items.length > 0 && (
          <ul className={styles.rows} data-testid="quit-summary-items">
            {items.map((item) => {
              const key = `${item.kind}:${item.id}`;
              const action = describeActivityAction(item);
              const state = actions.get(key);
              return (
                <li key={key} className={styles.row} data-item-kind={item.kind}>
                  <span className={styles.rowLabel}>{item.label}</span>
                  <span className={styles.itemActions}>
                    {onOpenItem && item.projectId ? (
                      <button
                        type="button"
                        className={button.ghost}
                        data-testid={`quit-summary-open-${item.id}`}
                        onClick={() => onOpenItem(item)}
                      >
                        查看
                      </button>
                    ) : null}
                    {onStopItem ? (
                      <button
                        type="button"
                        className={button.ghost}
                        data-testid={`quit-summary-stop-${item.id}`}
                        disabled={state?.busy === true || !action.label}
                        title={action.label || action.unavailable}
                        onClick={() => runStop(item)}
                      >
                        {state?.busy ? '处理中…' : action.label || '无法停止'}
                      </button>
                    ) : null}
                    <span
                      className={state?.outcome && !state.outcome.ok ? styles.itemError : styles.rowValue}
                      data-testid={`quit-summary-stop-result-${item.id}`}
                    >
                      {state?.outcome ? state.outcome.message : (!action.label && action.unavailable) || item.status || ''}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
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
          <button type="button" className={button.ghost} data-testid="quit-summary-decision-cancel" onClick={() => onDecision('cancel')} autoFocus>
            取消
          </button>
          <button type="button" className={button.ghostCard} data-testid="quit-summary-decision-tray" onClick={() => onDecision('tray')}>
            最小化到托盘
          </button>
          <button type="button" className={button.danger} data-testid="quit-summary-decision-quit" onClick={() => onDecision('quit')}>
            停止并退出
          </button>
        </div>
      </div>
    </div>
  );
}
