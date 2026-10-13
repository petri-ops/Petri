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
 *
 * BLOCK-180 — 审批一等资源面：
 * - requestId 在场时按「请求级决策」上送（approve/deny），否则退化为存量键级；
 * - command + spans（服务端 command-risk-spans 分析）在卡内高亮风险片段——
 *   用户看得到批的是什么（前端不重复实现风险规则，单一真相在服务端）；
 * - 「本任务总是放行」两步武装（先确认条，二次点击才生效=先武装后使用）。
 */
interface CommandRiskSpan {
  start: number;
  end: number;
  kind: string;
}

export interface GuardAckCardProps {
  toolName: string;
  guardKey: string;
  message: string;
  busy?: boolean;
  requestId?: string;
  command?: string | null;
  spans?: CommandRiskSpan[] | null;
  armedGuardKeys?: string[];
  onAck: (mode: 'once' | 'always') => void;
  onDismiss: () => void;
}

/** 按风险 span 切分命令串：命中片段高亮（kind 即色），其余原样。 */
function renderCommandWithSpans(command: string, spans: CommandRiskSpan[] | null | undefined): React.ReactElement {
  const clean = (spans || [])
    .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start)
    .sort((a, b) => a.start - b.start);
  const parts: React.ReactElement[] = [];
  let cursor = 0;
  clean.forEach((span, index) => {
    if (span.start < cursor) return; // 重叠片段跳过（服务端已合并，防御性）
    if (span.start > cursor) parts.push(<span key={`t${index}`}>{command.slice(cursor, span.start)}</span>);
    parts.push(
      <mark key={`r${index}`} className={`sc-guard-card__risk sc-guard-card__risk--${span.kind}`}>
        {command.slice(span.start, span.end)}
      </mark>,
    );
    cursor = span.end;
  });
  if (cursor < command.length) parts.push(<span key="tail">{command.slice(cursor)}</span>);
  return <code className="sc-guard-card__command">{parts}</code>;
}

export function GuardAckCard({
  toolName,
  guardKey,
  message,
  busy = false,
  requestId,
  command,
  spans,
  armedGuardKeys = [],
  onAck,
  onDismiss,
}: GuardAckCardProps): React.ReactElement {
  // BLOCK-180 P3 — 「本任务总是放行」两步武装：先出确认条，二次点击才生效。
  const [armConfirming, setArmConfirming] = useState(false);
  const requestArm = useCallback(() => setArmConfirming(true), []);
  const cancelArm = useCallback(() => setArmConfirming(false), []);
  const confirmArm = useCallback(() => {
    setArmConfirming(false);
    onAck('always');
  }, [onAck]);

  return (
    <div className="sc-guard-card" role="alertdialog" aria-label="动态防护确认" data-testid="guard-ack-card">
      <div className="sc-guard-card__head">
        <span className="sc-guard-card__icon" aria-hidden="true">
          <Icon name="shield" size={14} />
        </span>
        <span className="sc-guard-card__title">动态防护确认</span>
        <code className="sc-guard-card__key" title={guardKey}>{guardKey}</code>
        {requestId ? <code className="sc-guard-card__req" title={`审批请求 ${requestId}`}>{requestId.slice(0, 12)}…</code> : null}
      </div>
      <p className="sc-guard-card__message">{message || `工具 ${toolName} 命中动态审批维度，需要你确认后放行。`}</p>
      {command ? (
        <div className="sc-guard-card__command-row" data-testid="guard-ack-command">
          {renderCommandWithSpans(command, spans)}
        </div>
      ) : null}
      {armedGuardKeys.length > 0 ? (
        <div className="sc-guard-card__armed" data-testid="guard-ack-armed">
          {armedGuardKeys.map((key) => (
            <span key={key} className="sc-guard-card__armed-chip" title="已武装（本任务内该维度不再询问）">{key}</span>
          ))}
        </div>
      ) : null}
      {armConfirming ? (
        <div className="sc-guard-card__arm-confirm" role="alert" data-testid="guard-ack-arm-confirm">
          <span>武装后本任务内「{guardKey}」维度不再询问（任务结束自动失效）。确认武装？</span>
          <button
            type="button"
            className="sc-guard-card__btn sc-guard-card__btn-primary"
            disabled={busy}
            data-testid="guard-ack-arm-confirm-yes"
            onClick={confirmArm}
          >
            确认武装
          </button>
          <button
            type="button"
            className="sc-guard-card__btn"
            disabled={busy}
            data-testid="guard-ack-arm-confirm-no"
            onClick={cancelArm}
          >
            取消
          </button>
        </div>
      ) : (
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
            onClick={requestArm}
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
      )}
    </div>
  );
}

/** 审批复审面板数据行（/ai/agent/guard-events 投影）。 */
interface GuardAckRecord {
  taskId: string;
  guardKey: string;
  always: boolean;
  at: string;
  requestId?: string;
  decision?: string;
  command?: string;
}

function useGuardAckHistory(enabled: boolean): { records: GuardAckRecord[]; loading: boolean; error: string | null; reload: () => void } {
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
            <code className="sc-guard-history__key" title={record.requestId ? `审批请求 ${record.requestId}` : record.guardKey}>{record.guardKey}</code>
            {record.decision ? (
              <span className="sc-guard-history__decision" title={record.command || undefined}>{record.decision === 'approve' ? '批准' : '拒绝'}·{record.always ? 'always' : 'once'}</span>
            ) : (
              <span className="sc-guard-history__scope">{record.always ? '本任务总是放行' : '放行一次'}</span>
            )}
            <span className="sc-guard-history__task" title={record.taskId}>{record.taskId.slice(0, 12)}…</span>
          </li>
        ))}
      </ul>
      <button type="button" className="sc-guard-history__refresh" onClick={reload}>刷新</button>
    </div>
  );
}
