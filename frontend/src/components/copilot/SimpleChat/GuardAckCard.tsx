import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

/**
 * GuardAckCard — 动态防护/用户规则 require-ack 确认卡（BLOCK-171 CP-2）。
 *
 * 后端 dynamic_guard / user_rule_require_ack 拒绝已携带 guardKey（存量缺陷
 * 修复后透出）；本卡=确认通道的用户可见面：放行一次 / 本任务总是放行 /
 * 拒绝（dismiss）。ack 写 task 内确认集（策略读侧即时生效，模型重试即过），
 * guard_ack 事件入 task_events（审批记录可复审）。
 */
export interface GuardAckCardProps {
  toolName: string;
  guardKey: string;
  message: string;
  busy?: boolean;
  onAck: (mode: 'once' | 'always') => void;
  onDismiss: () => void;
}

export function GuardAckCard({ toolName, guardKey, message, busy = false, onAck, onDismiss }: GuardAckCardProps): React.ReactElement {
  return (
    <div className="sc-guard-card" role="alertdialog" aria-label="动态防护确认" data-testid="guard-ack-card">
      <div className="sc-guard-card__head">
        <span className="sc-guard-card__icon" aria-hidden="true">
          <Icon name="shield" size={14} />
        </span>
        <span className="sc-guard-card__title">动态防护确认</span>
        <code className="sc-guard-card__key" title={guardKey}>{guardKey}</code>
      </div>
      <p className="sc-guard-card__message">{message || `工具 ${toolName} 命中动态审批维度，需要你确认后放行。`}</p>
      <div className="sc-guard-card__actions">
        <button
          type="button"
          className="sc-guard-card__btn sc-guard-card__btn-primary"
          disabled={busy}
          data-testid="guard-ack-once"
          onClick={() => onAck('once')}
        >
          放行一次
        </button>
        <button
          type="button"
          className="sc-guard-card__btn"
          disabled={busy}
          data-testid="guard-ack-always"
          onClick={() => onAck('always')}
        >
          本任务总是放行
        </button>
        <button
          type="button"
          className="sc-guard-card__btn sc-guard-card__btn-ghost"
          disabled={busy}
          onClick={onDismiss}
        >
          拒绝
        </button>
      </div>
    </div>
  );
}

/** 审批复审面板数据行（/ai/agent/guard-events 投影）。 */
export interface GuardAckRecord {
  taskId: string;
  guardKey: string;
  always: boolean;
  at: string;
}

export function useGuardAckHistory(enabled: boolean): { records: GuardAckRecord[]; loading: boolean; error: string | null; reload: () => void } {
  const [records, setRecords] = useState<GuardAckRecord[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((v) => v + 1), []);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    // BLOCK-171 CP-2 — 全部 setState 在首个 await 之后（react-hooks 同步级联规则）
    const load = async (): Promise<void> => {
      try {
        const token = getToken();
        const response = await fetch(`${getPlatformApiPrefix()}/ai/agent/guard-events?limit=50`, {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const data = (await response.json().catch(() => ({}))) as { ok?: unknown; events?: unknown };
        if (!response.ok || !data.ok) throw new Error(`HTTP ${response.status}`);
        if (!cancelled) {
          setRecords(Array.isArray(data.events) ? (data.events as GuardAckRecord[]) : []);
          setError(null);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, tick]);

  return { records, loading, error, reload };
}

/** 决策原语节内「审批记录」面板（设置→决策原语，紧邻 DecisionConfigPanel）。 */
export function GuardAckHistoryPanel(): React.ReactElement {
  const { records, loading, error, reload } = useGuardAckHistory(true);

  if (loading && records.length === 0) {
    return <p className="sc-guard-history__empty">审批记录加载中…</p>;
  }
  if (error) {
    return (
      <p className="sc-guard-history__empty">
        审批记录加载失败：{error}
        <button type="button" className="sc-guard-history__retry" onClick={reload}>重试</button>
      </p>
    );
  }
  if (records.length === 0) {
    return <p className="sc-guard-history__empty">暂无审批记录——Agent 命中动态防护且你确认放行后，裁定会留痕在此。</p>;
  }
  return (
    <div className="sc-guard-history" data-testid="guard-history">
      <ul className="sc-guard-history__list">
        {records.map((record, index) => (
          <li key={`${record.taskId}:${record.at}:${index}`} className="sc-guard-history__row">
            <span className="sc-guard-history__time">{record.at.replace('T', ' ').slice(0, 19)}</span>
            <code className="sc-guard-history__key" title={record.guardKey}>{record.guardKey}</code>
            <span className="sc-guard-history__scope">{record.always ? '本任务总是放行' : '放行一次'}</span>
            <span className="sc-guard-history__task" title={record.taskId}>{record.taskId.slice(0, 12)}…</span>
          </li>
        ))}
      </ul>
      <button type="button" className="sc-guard-history__refresh" onClick={reload}>刷新</button>
    </div>
  );
}
