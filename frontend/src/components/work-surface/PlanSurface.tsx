import React from 'react';
import { Icon } from '@/components/icons/Icon';
import {
  approvePlanRevision,
  fetchPlanRevisions,
  fetchPlansForConversation,
  type PlanListEntry,
  type PlanRevisionEntry,
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

function planToMarkdown(plan: PlanListEntry, revision: PlanRevisionEntry | null = null): string {
  const steps = revision ? revision.steps : plan.steps || [];
  return [
    `# ${plan.title}${revision ? `（修订 v${revision.revNo}）` : ''}`,
    revision?.reason ? `\n## 修订原因\n${revision.reason}` : '',
    plan.goal ? `\n## 目标\n${plan.goal}` : '',
    plan.specMd && !revision ? `\n## 计划正文\n${plan.specMd}` : '',
    steps.length > 0
      ? `\n## 步骤\n${steps.map((step) => `${step.n}. ${step.title}${step.hint ? ` — ${step.hint}` : ''}`).join('\n')}`
      : '',
    `\n---\n状态：${revision ? (revision.status === 'proposed' ? '修订待批准' : '修订已应用') : STATUS_LABEL[plan.status] || plan.status}`,
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
  // BLOCK-253 B3/H4 — 修订版本 tabs（当前 + 后端 proposed/applied revisions）。
  // 状态按 planId 归属：换计划即视为空，旧数据不残留（不在 effect 内同步 setState）。
  const [revisionState, setRevisionState] = React.useState<{
    planId: string | null;
    rows: PlanRevisionEntry[];
    error: string;
  }>({ planId: null, rows: [], error: '' });
  const [selectedRevNo, setSelectedRevNo] = React.useState<number | null>(null);
  const [approvingRevNo, setApprovingRevNo] = React.useState<number | null>(null);

  if (knownConv !== conversationId) {
    setKnownConv(conversationId);
    setLoadedConv(null);
    setPlans([]);
    setSelectedId(null);
    setError(null);
    setRevisionState({ planId: null, rows: [], error: '' });
    setSelectedRevNo(null);
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

  React.useEffect(() => {
    if (!selectedId) return undefined;
    let alive = true;
    void fetchPlanRevisions(selectedId)
      .then((rows) => {
        if (alive) setRevisionState({ planId: selectedId, rows, error: '' });
      })
      .catch((cause) => {
        if (alive) {
          setRevisionState({
            planId: selectedId, rows: [],
            error: cause instanceof Error ? cause.message : '修订读取失败',
          });
        }
      });
    return () => { alive = false; };
  }, [selectedId]);

  const revisions = revisionState.planId === selectedId ? revisionState.rows : [];
  const revisionError = revisionState.planId === selectedId ? revisionState.error : '';
  const selectedRevision = revisions.find((revision) => revision.revNo === selectedRevNo) || null;

  const approveRevision = async () => {
    if (!selected || !selectedRevision || selectedRevision.status !== 'proposed') return;
    setApprovingRevNo(selectedRevision.revNo);
    try {
      await approvePlanRevision(selected.id, selectedRevision.revNo);
      setNotice(`修订案 v${selectedRevision.revNo} 已应用`);
      await load();
      const rows = await fetchPlanRevisions(selected.id);
      setRevisionState({ planId: selected.id, rows, error: '' });
    } catch (cause) {
      setNotice(cause instanceof Error ? `修订批准失败：${cause.message}` : '修订批准失败');
    } finally {
      setApprovingRevNo(null);
      window.setTimeout(() => setNotice(''), 2500);
    }
  };

  const copy = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(planToMarkdown(selected, selectedRevision));
      setNotice(selectedRevision ? `修订 v${selectedRevision.revNo} 已复制` : '计划已复制');
    } catch {
      setNotice('复制失败（剪贴板不可用）');
    }
    window.setTimeout(() => setNotice(''), 2500);
  };

  const download = () => {
    if (!selected) return;
    const blob = new Blob([planToMarkdown(selected, selectedRevision)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selected.title || selected.id}${selectedRevision ? `-v${selectedRevision.revNo}` : ''}.md`;
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
          {(revisionError || revisions.length > 0) && (
            <div className={styles.actions} data-testid="plan-revisions" role="tablist" aria-label="计划版本">
              <button
                type="button"
                className="petri-btn petri-btn--ghost petri-btn--sm"
                data-testid="plan-revision-current"
                aria-pressed={selectedRevNo === null}
                onClick={() => setSelectedRevNo(null)}
              >
                当前
              </button>
              {revisions.map((revision) => (
                <button
                  key={revision.id || revision.revNo}
                  type="button"
                  className="petri-btn petri-btn--ghost petri-btn--sm"
                  data-testid={`plan-revision-tab-${revision.revNo}`}
                  aria-pressed={selectedRevNo === revision.revNo}
                  onClick={() => setSelectedRevNo(revision.revNo)}
                >
                  v{revision.revNo} · {revision.status === 'proposed' ? '待批准' : '已应用'}
                </button>
              ))}
            </div>
          )}
          {revisionError && <p className={styles.error} role="alert">{revisionError}</p>}
          {selectedRevision ? (
            <>
              <div className={styles.rowHeader}>
                <strong>修订 v{selectedRevision.revNo}</strong>
                <span className={styles.badge}>{selectedRevision.status === 'proposed' ? '待批准' : '已应用'}</span>
              </div>
              {selectedRevision.reason ? <p className={styles.muted}>原因：{selectedRevision.reason}</p> : null}
              {selectedRevision.steps.length > 0 ? (
                <ol className={styles.steps}>
                  {selectedRevision.steps.map((step) => (
                    <li key={step.n}>
                      {step.title}
                      {step.hint ? <span className={styles.muted}> — {step.hint}</span> : null}
                    </li>
                  ))}
                </ol>
              ) : null}
              {selectedRevision.appliedAt ? <p className={styles.muted}>应用时间：{selectedRevision.appliedAt}</p> : null}
              {selectedRevision.status === 'proposed' ? (
                <div className={styles.actions}>
                  <button
                    type="button"
                    className="petri-btn petri-btn--primary petri-btn--sm"
                    data-testid="plan-revision-approve"
                    disabled={approvingRevNo === selectedRevision.revNo}
                    onClick={() => void approveRevision()}
                  >
                    {approvingRevNo === selectedRevision.revNo ? '批准中…' : '批准修订'}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <>
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
            </>
          )}
          <div className={styles.actions}>
            <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={() => void copy()}>复制</button>
            <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={download}>下载 .md</button>
            {onAskAgent ? (
              <button
                type="button"
                className="petri-btn petri-btn--ghost petri-btn--sm"
                onClick={() => onAskAgent(`请基于计划「${selected.title}」${selectedRevision ? `修订 v${selectedRevision.revNo}` : ''}（${selected.id}）讨论：下一步是否调整?`)}
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
