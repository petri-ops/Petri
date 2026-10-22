import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

/**
 * GuardAckCard — 动态防护/用户规则/MCP trust 确认卡（BLOCK-171 CP-2；BLOCK-243 Q1 v2）。
 *
 * 后端 deny 信封（toolResult.approval）是唯一数据源：
 * - 变体：dynamic_guard=danger / user_rule=warning / mcp_trust=info；
 * - 意图解释：服务端确定性规则派生（不伪造模型解释）；
 * - 长命令折叠（span 高亮保持）；参数 JSON 编辑（脱敏/有界未截断才可编辑）；
 * - 范围：仅本次 / 本任务（维度 ack，任务结束失效）/ 始终信任 MCP 服务
 *   （写 trust=allow，仅 mcp_trust 请求可选）——后两者两步武装；
 * - 待审批计数与重复调用提示。
 *
 * 编辑参数只允许一次性批准：批准时上送 updatedInput，后端重跑 schema/preflight/
 * policy 并登记「原始指纹→生效参数」替换；模型重试原调用时执行生效参数并留审计。
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
  variant?: 'danger' | 'warning' | 'info' | 'sideTask';
  explanation?: string;
  intent?: { action?: string; impact?: string; reversible?: string; reason?: string } | null;
  source?: 'main' | 'side-task';
  argsPreview?: string | null;
  inputEditable?: boolean;
  pendingRequestCount?: number;
  duplicatePending?: boolean;
  mcpServerId?: string | null;
  canAlways?: boolean;
  onAck: (mode: 'once' | 'task' | 'always', updatedInput?: unknown) => void;
  onDismiss: () => void;
}

const VARIANT_META: Record<'danger' | 'warning' | 'info' | 'sideTask', { title: string; icon: 'shield' | 'alert-triangle' | 'info' | 'bot' }> = {
  danger: { title: '动态防护确认', icon: 'shield' },
  warning: { title: '规则确认', icon: 'alert-triangle' },
  info: { title: 'MCP 服务确认', icon: 'info' },
  sideTask: { title: '侧边任务确认', icon: 'bot' },
};

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

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
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
  variant = 'danger',
  explanation,
  intent = null,
  source = 'main',
  argsPreview,
  inputEditable = false,
  pendingRequestCount = 0,
  duplicatePending = false,
  mcpServerId,
  canAlways = false,
  onAck,
  onDismiss,
}: GuardAckCardProps): React.ReactElement {
  const meta = VARIANT_META[variant] || VARIANT_META.danger;
  const [armScope, setArmScope] = useState<'task' | 'always' | null>(null);
  const [commandExpanded, setCommandExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const prettyPreview = useMemo(() => (argsPreview ? prettyJson(argsPreview) : ''), [argsPreview]);
  const foldable = Boolean(command && (command.length > 240 || command.split('\n').length > 4));

  const beginEdit = useCallback(() => {
    setDraft(prettyPreview);
    setEditError(null);
    setEditing(true);
    setArmScope(null);
  }, [prettyPreview]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft('');
    setEditError(null);
  }, []);

  const approveOnce = useCallback(() => {
    if (!editing) {
      onAck('once');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (error) {
      setEditError(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setEditError('参数必须是 JSON 对象。');
      return;
    }
    let unchanged = false;
    try {
      unchanged = JSON.stringify(parsed) === JSON.stringify(JSON.parse(argsPreview || '{}'));
    } catch {
      unchanged = false;
    }
    setEditError(null);
    setEditing(false);
    if (unchanged) onAck('once');
    else onAck('once', parsed);
  }, [argsPreview, draft, editing, onAck]);

  const requestArm = useCallback((scope: 'task' | 'always') => {
    setEditing(false);
    setArmScope(scope);
  }, []);
  const cancelArm = useCallback(() => setArmScope(null), []);
  const confirmArm = useCallback(() => {
    if (!armScope) return;
    const scope = armScope;
    setArmScope(null);
    onAck(scope);
  }, [armScope, onAck]);

  const explanationText = explanation || message || `工具 ${toolName} 命中审批维度，需要你确认后放行。`;

  return (
    <div
      className={`sc-guard-card sc-guard-card--${variant}`}
      role="alertdialog"
      aria-label={meta.title}
      data-testid="guard-ack-card"
      data-variant={variant}
    >
      <div className="sc-guard-card__head">
        <span className="sc-guard-card__icon" aria-hidden="true">
          <Icon name={meta.icon} size={14} />
        </span>
        <span className="sc-guard-card__title">{meta.title}</span>
        <code className="sc-guard-card__key" title={guardKey}>{guardKey}</code>
        {requestId ? <code className="sc-guard-card__req" title={`审批请求 ${requestId}`}>{requestId.slice(0, 12)}…</code> : null}
      </div>
      <p className="sc-guard-card__message">{message || `工具 ${toolName} 命中审批维度，需要你确认后放行。`}</p>
      <p className="sc-guard-card__explanation" data-testid="guard-ack-explanation">{explanationText}</p>
      {intent && (intent.action || intent.impact) ? (
        <div className="sc-guard-card__intent" data-testid="guard-ack-intent">
          {intent.action ? <span><b>意图</b> {intent.action}</span> : null}
          {intent.impact ? <span><b>影响</b> {intent.impact}{intent.reversible ? ` · ${intent.reversible}` : ''}</span> : null}
          {intent.reason ? <span className="sc-guard-card__intent-reason">{intent.reason}</span> : null}
        </div>
      ) : null}
      {source === 'side-task' ? (
        <p className="sc-guard-card__meta" data-testid="guard-ack-source">来源：侧边任务（子代理）</p>
      ) : null}
      {pendingRequestCount > 1 ? (
        <p className="sc-guard-card__meta" data-testid="guard-ack-pending-count">还有 {pendingRequestCount - 1} 个待审批请求</p>
      ) : null}
      {duplicatePending ? (
        <p className="sc-guard-card__meta" data-testid="guard-ack-duplicate">重复调用已合并到同一审批请求</p>
      ) : null}
      {command ? (
        <div className="sc-guard-card__command-row" data-testid="guard-ack-command">
          <div className={`sc-guard-card__command-fold${commandExpanded ? ' is-expanded' : ''}`}>
            {renderCommandWithSpans(command, spans)}
          </div>
          {foldable ? (
            <button
              type="button"
              className="sc-guard-card__fold-toggle"
              data-testid="guard-ack-command-toggle"
              onClick={() => setCommandExpanded((value) => !value)}
            >
              {commandExpanded ? '收起命令' : '展开全部命令'}
            </button>
          ) : null}
        </div>
      ) : null}

      {argsPreview ? (
        <div className="sc-guard-card__args" data-testid="guard-ack-args">
          {editing ? (
            <textarea
              className="sc-guard-card__args-input"
              data-testid="guard-ack-args-input"
              aria-label="编辑工具参数（JSON）"
              value={draft}
              rows={Math.min(12, Math.max(4, draft.split('\n').length + 1))}
              onChange={(event) => { setDraft(event.target.value); setEditError(null); }}
              spellCheck={false}
            />
          ) : (
            <div className="sc-guard-card__args-preview" data-testid="guard-ack-args-preview">{prettyPreview}</div>
          )}
          {editError ? (
            <p className="sc-guard-card__args-error" role="alert" data-testid="guard-ack-args-error">{editError}</p>
          ) : null}
          {inputEditable ? (
            editing ? (
              <button type="button" className="sc-guard-card__fold-toggle" data-testid="guard-ack-edit-cancel" onClick={cancelEdit}>
                取消编辑
              </button>
            ) : (
              <button type="button" className="sc-guard-card__fold-toggle" data-testid="guard-ack-edit-toggle" onClick={beginEdit}>
                编辑参数
              </button>
            )
          ) : (
            <p className="sc-guard-card__meta">参数含敏感字段或过大，仅只读展示。</p>
          )}
        </div>
      ) : null}

      {armedGuardKeys.length > 0 ? (
        <div className="sc-guard-card__armed" data-testid="guard-ack-armed">
          {armedGuardKeys.map((key) => (
            <span key={key} className="sc-guard-card__armed-chip" title="已武装（本任务内该维度不再询问）">{key}</span>
          ))}
        </div>
      ) : null}

      {armScope ? (
        <div className="sc-guard-card__arm-confirm" role="alert" data-testid="guard-ack-arm-confirm">
          {armScope === 'always' ? (
            <span>
              将 MCP 服务{ mcpServerId ? `「${mcpServerId}」` : ''}的信任位改为 allow（自动批准其 destructive 工具），可在扩展页随时改回。确认？
            </span>
          ) : (
            <span>武装后本任务内「{guardKey}」维度不再询问（任务结束自动失效）。确认武装？</span>
          )}
          <button
            type="button"
            className="sc-guard-card__btn sc-guard-card__btn-primary"
            disabled={busy}
            data-testid="guard-ack-arm-confirm-yes"
            onClick={confirmArm}
          >
            确认
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
            onClick={approveOnce}
          >
            {editing ? '批准并应用' : '放行一次'}
          </button>
          {editing ? (
            <span className="sc-guard-card__hint" data-testid="guard-ack-edit-hint">编辑参数按一次性批准；如需本任务/始终范围，请取消编辑后按原参数批准。</span>
          ) : (
            <>
              <button
                type="button"
                className="sc-guard-card__btn"
                disabled={busy}
                data-testid="guard-ack-task"
                onClick={() => requestArm('task')}
              >
                本任务总是放行
              </button>
              {canAlways ? (
                <button
                  type="button"
                  className="sc-guard-card__btn"
                  disabled={busy}
                  data-testid="guard-ack-always"
                  onClick={() => requestArm('always')}
                >
                  始终信任此服务
                </button>
              ) : null}
            </>
          )}
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
  eventType?: string;
  scope?: 'once' | 'task' | 'always';
  requestId?: string;
  decision?: string;
  updatedInput?: boolean;
  toolName?: string | null;
  mcpServerId?: string | null;
  reason?: string | null;
  durationMs?: number | null;
  command?: string;
}

function scopeLabel(record: GuardAckRecord): string {
  if (record.scope === 'always') return '始终';
  if (record.scope === 'task' || record.always) return '本任务';
  return '仅本次';
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
              <span
                className="sc-guard-history__decision"
                title={record.reason || record.command || undefined}
                data-testid="guard-history-decision"
              >
                {record.decision === 'approve' ? '批准' : '拒绝'}·{scopeLabel(record)}
                {record.updatedInput ? '·参数已编辑' : ''}
                {typeof record.durationMs === 'number' ? `·${Math.round(record.durationMs)}ms` : ''}
              </span>
            ) : (
              <span className="sc-guard-history__scope">{scopeLabel(record)}</span>
            )}
            <span className="sc-guard-history__task" title={record.taskId}>{record.taskId.slice(0, 12)}…</span>
          </li>
        ))}
      </ul>
      <button type="button" className="sc-guard-history__refresh" onClick={reload}>刷新</button>
    </div>
  );
}
