import React from 'react';
import { Icon } from '@/components/icons/Icon';
import {
  fetchPlansForConversation,
  type PlanListEntry,
} from '@/components/copilot/planApprovals';
import { petriEvents, subscribePetriEvent } from '@/lib/events';
import styles from './WorkSurfacePanels.module.css';

const STATUS_LABEL: Record<string, string> = {
  draft: '待批准',
  active: '执行中',
  completed: '已完成',
  failed: '失败',
  paused: '已暂停',
  cancelled: '已取消',
};

function planToMarkdown(plan: PlanListEntry): string {
  const steps = plan.steps || [];
  return [
    `# ${plan.title}`,
    plan.goal ? `\n## 目标\n${plan.goal}` : '',
    plan.specMd ? `\n## 计划正文\n${plan.specMd}` : '',
    steps.length > 0
      ? `\n## 步骤\n${steps.map((step) => `${step.n}. ${step.title}${step.hint ? ` — ${step.hint}` : ''}`).join('\n')}`
      : '',
    `\n---\n状态：${STATUS_LABEL[plan.status] || plan.status}`,
  ].filter(Boolean).join('\n');
}

export function PlanSurface({
  conversationId,
  onAskAgent,
}: {
  conversationId: string | null;
  onAskAgent?: (prompt: string) => void;
}): React.ReactElement {
  const [plans, setPlans] = React.useState<PlanListEntry[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [loadedConv, setLoadedConv] = React.useState<string | null>(null);
  const [knownConv, setKnownConv] = React.useState(conversationId);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState('');

  if (knownConv !== conversationId) {
    setKnownConv(conversationId);
    setLoadedConv(null);
    setPlans([]);
    setSelectedId(null);
    setError(null);
  }
  const loading = Boolean(conversationId) && loadedConv !== conversationId && !error;

  const load = React.useCallback(async () => {
    if (!conversationId) return;
    try {
      const rows = await fetchPlansForConversation(conversationId);
      setPlans(rows);
      setSelectedId((current) => (
        current && rows.some((plan) => plan.id === current) ? current : rows[0]?.id ?? null
      ));
      setLoadedConv(conversationId);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '计划读取失败');
      setLoadedConv(conversationId);
    }
  }, [conversationId]);

  React.useEffect(() => {
    if (!conversationId) return undefined;
    let alive = true;
    void (async () => {
      try {
        const rows = await fetchPlansForConversation(conversationId);
        if (!alive) return;
        setPlans(rows);
        setSelectedId((current) => (
          current && rows.some((plan) => plan.id === current) ? current : rows[0]?.id ?? null
        ));
        setLoadedConv(conversationId);
        setError(null);
      } catch (cause) {
        if (!alive) return;
        setError(cause instanceof Error ? cause.message : '计划读取失败');
        setLoadedConv(conversationId);
      }
    })();
    return () => { alive = false; };
  }, [conversationId]);

  React.useEffect(() => subscribePetriEvent(petriEvents.planSurfaceOpen, (detail) => {
    const planId = detail && typeof detail.planId === 'string' ? detail.planId : '';
    if (!planId) return;
    setSelectedId(planId);
    void load();
  }), [load]);

  const selected = plans.find((plan) => plan.id === selectedId) || null;

  const copy = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(planToMarkdown(selected));
      setNotice('计划已复制');
    } catch {
      setNotice('复制失败（剪贴板不可用）');
    }
    window.setTimeout(() => setNotice(''), 2500);
  };

  const download = () => {
    if (!selected) return;
    const blob = new Blob([planToMarkdown(selected)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selected.title || selected.id}.md`;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div className={styles.panel} data-testid="plan-surface" data-state={loading ? 'loading' : error ? 'error' : plans.length ? 'ready' : 'empty'}>
      <div className={styles.panelHeader}>
        <Icon name="list-details" size={15} />
        <strong>计划</strong>
        <span className={styles.muted}>{plans.length > 0 ? `${plans.length} 个` : ''}</span>
      </div>

      {loading && <p className={styles.empty}>正在读取当前会话的计划…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!loading && !error && plans.length === 0 && (
        <p className={styles.empty}>当前会话还没有计划。计划工具创建后会出现在这里。</p>
      )}

      {plans.length > 0 && (
        <div className={styles.list}>
          {plans.map((plan) => (
            <button
              key={plan.id}
              type="button"
              className={`${styles.selectRow} ${plan.id === selectedId ? styles.selectRowActive : ''}`}
              onClick={() => setSelectedId(plan.id)}
            >
              <span className={styles.path}>{plan.title}</span>
              <span className={styles.badge}>{STATUS_LABEL[plan.status] || plan.status}</span>
              <span className={styles.muted}>
                {plan.done_steps ?? 0}/{plan.total_steps ?? plan.steps?.length ?? 0}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <section className={styles.detailBlock}>
          <div className={styles.rowHeader}>
            <strong>{selected.title}</strong>
            <span className={styles.badge}>{STATUS_LABEL[selected.status] || selected.status}</span>
          </div>
          {selected.goal ? <p className={styles.muted}>{selected.goal}</p> : null}
          {selected.steps && selected.steps.length > 0 ? (
            <ol className={styles.steps}>
              {selected.steps.map((step) => (
                <li key={step.n}>
                  {step.title}
                  {step.hint ? <span className={styles.muted}> — {step.hint}</span> : null}
                </li>
              ))}
            </ol>
          ) : null}
          {selected.specMd ? <pre className={styles.spec}>{selected.specMd}</pre> : null}
          <div className={styles.actions}>
            <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={() => void copy()}>复制</button>
            <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={download}>下载 .md</button>
            {onAskAgent ? (
              <button
                type="button"
                className="petri-btn petri-btn--ghost petri-btn--sm"
                onClick={() => onAskAgent(`请基于计划「${selected.title}」（${selected.id}）讨论：下一步是否调整?`)}
              >
                在对话中讨论
              </button>
            ) : null}
          </div>
          {notice ? <p className={styles.muted} role="status">{notice}</p> : null}
        </section>
      )}
    </div>
  );
}
