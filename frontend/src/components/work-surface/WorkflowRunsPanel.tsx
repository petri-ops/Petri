import React from 'react';
import { Icon } from '@/components/icons/Icon';
import { StatusBadge } from '@/components/ui/controls/Status';
import { projectExecutionAxis } from '@/lib/statusProjection';
import button from '@/components/ui/controls/button.module.css';
import {
  cancelWorkflowRun,
  fetchWorkflowRun,
  fetchWorkflowRuns,
  resumeWorkflowRun,
  type WorkflowJournalLine,
  type WorkflowRunDetail,
  type WorkflowRunSummary,
} from '@/lib/workflowClient';
import styles from './WorkflowRunsPanel.module.css';

const POLL_MS = 5_000;

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '—';
}

function journalTitle(line: WorkflowJournalLine): string {
  if (line.kind === 'phase') return line.label || line.stepKey || '阶段';
  if (line.kind === 'agent') return line.stepKey || line.agentId || '子代理';
  if (line.kind === 'log') return line.text || '日志';
  return line.stepKey || line.kind || '步骤';
}

function JournalRow({ line }: { line: WorkflowJournalLine }): React.ReactElement {
  const execution = projectExecutionAxis(line.status || (line.kind === 'log' ? 'completed' : null));
  return (
    <div className={styles.journalRow} data-testid="workflow-journal-row" data-kind={line.kind || ''}>
      <span className={styles.journalSeq}>{line.seq ?? '—'}</span>
      <span className={styles.journalKind}>{line.kind || 'step'}</span>
      <span className={styles.journalTitle} title={journalTitle(line)}>{journalTitle(line)}</span>
      {line.reusedFrom ? <span className={styles.reuse}>复用 {line.reusedFrom.slice(0, 18)}</span> : null}
      {line.errorHead ? <span className={styles.journalError}>{line.errorHead}</span> : null}
      {execution ? <StatusBadge projection={execution} /> : <span className={styles.journalMuted}>—</span>}
    </div>
  );
}

export function WorkflowRunsPanel({ enabled = true }: { enabled?: boolean }): React.ReactElement {
  const [runs, setRuns] = React.useState<WorkflowRunSummary[] | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<WorkflowRunDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refreshRuns = React.useCallback(async () => {
    try {
      const next = await fetchWorkflowRuns();
      setRuns(next);
      setError(null);
      setSelectedId((current) => (
        current && next.some((run) => run.runId === current)
          ? current
          : next[0]?.runId || null
      ));
    } catch (caught) {
      setRuns([]);
      setError(caught instanceof Error ? caught.message : '工作流列表加载失败');
    }
  }, []);

  React.useEffect(() => {
    if (!enabled) return undefined;
    void Promise.resolve().then(refreshRuns);
    const timer = window.setInterval(() => { void refreshRuns(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, refreshRuns]);

  React.useEffect(() => {
    if (!enabled || !selectedId) return undefined;
    let cancelled = false;
    fetchWorkflowRun(selectedId)
      .then((next) => {
        if (cancelled) return;
        setDetail(next);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : '工作流详情加载失败');
        setDetail(null);
      });
    return () => { cancelled = true; };
  }, [enabled, selectedId]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      setNotice(label);
      await refreshRuns();
      if (selectedId) setDetail(await fetchWorkflowRun(selectedId));
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : `${label}失败`);
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) {
    return (
      <div className={styles.panel} data-testid="workflow-runs-panel" data-state="disabled">
        <p className={styles.empty}>工作流功能当前未启用（PETRI_WORKFLOW_ENABLED 未开启）。</p>
      </div>
    );
  }

  const selectedRun = runs?.find((run) => run.runId === selectedId) || null;
  const activeDetail = detail && detail.run.runId === selectedId ? detail : null;
  const detailLoading = Boolean(selectedId) && activeDetail === null;
  const execution = projectExecutionAxis(selectedRun?.status || activeDetail?.run.status || null);
  const budget = activeDetail?.run.meta.budget;
  const agents = activeDetail?.journalTail.filter((line) => line.kind === 'agent').length || 0;
  const canCancel = activeDetail?.run.status === 'running';
  const canResume = activeDetail?.run.status === 'failed' || activeDetail?.run.status === 'cancelled';

  return (
    <div className={styles.panel} data-testid="workflow-runs-panel" data-state={runs === null ? 'loading' : 'ready'}>
      <header className={styles.header}>
        <span className={styles.title}>
          <Icon name="layers" size={15} />
          <strong>工作流</strong>
        </span>
        {execution ? <StatusBadge projection={execution} testId="workflow-selected-status" /> : null}
        <button type="button" className={button.ghost} onClick={() => void refreshRuns()} disabled={busy}>
          <Icon name="refresh" size={13} />
          刷新
        </button>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
      {runs === null ? <p className={styles.empty}>正在读取工作流运行…</p> : null}
      {runs?.length === 0 ? (
        <p className={styles.empty}>还没有工作流运行。Agent 可经 run_workflow 或定时工作流启动；先 dryRun 预览，确认后执行。</p>
      ) : null}

      {runs && runs.length > 0 ? (
        <div className={styles.body}>
          <div className={styles.runList} data-testid="workflow-run-list">
            {runs.map((run) => {
              const runStatus = projectExecutionAxis(run.status);
              return (
                <button
                  key={run.runId}
                  type="button"
                  className={`${styles.runItem}${run.runId === selectedId ? ` ${styles.runItemActive}` : ''}`}
                  data-testid="workflow-run-item"
                  data-run-id={run.runId}
                  onClick={() => setSelectedId(run.runId)}
                >
                  <span className={styles.runName}>{run.name || run.runId}</span>
                  <span className={styles.runMeta}>
                    <StatusBadge projection={runStatus} />
                    <span>{formatTime(run.createdAt)}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <section className={styles.detail} data-testid="workflow-run-detail">
            {detailLoading ? <p className={styles.empty}>正在读取运行详情…</p> : null}
            {!detailLoading && activeDetail ? (
              <>
                <div className={styles.summary}>
                  <div>
                    <span className={styles.label}>运行</span>
                    <span className={styles.mono}>{activeDetail.run.runId}</span>
                  </div>
                  <div>
                    <span className={styles.label}>预算</span>
                    <span>{budget ? `${budget.maxAgents} agents · ${budget.maxSteps} steps · ${Math.round(budget.timeoutMs / 1000)}s` : '未记录'}</span>
                  </div>
                  <div>
                    <span className={styles.label}>并发</span>
                    <span>{activeDetail.run.meta.concurrency ?? '—'}</span>
                  </div>
                  <div>
                    <span className={styles.label}>来源</span>
                    <span>{activeDetail.run.resumeFromRunId ? `resume ${activeDetail.run.resumeFromRunId}` : `script ${activeDetail.run.scriptHash.slice(0, 12)}`}</span>
                  </div>
                  <div>
                    <span className={styles.label}>时间</span>
                    <span>{formatTime(activeDetail.run.createdAt)} → {formatTime(activeDetail.run.finishedAt)}</span>
                  </div>
                </div>

                {activeDetail.run.error ? <div className={styles.error} role="alert">失败原因：{activeDetail.run.error}</div> : null}

                <div className={styles.actions}>
                  <button
                    type="button"
                    className={button.ghost}
                    disabled={busy || !canCancel}
                    onClick={() => void act('已请求取消', () => cancelWorkflowRun(activeDetail.run.runId))}
                  >
                    取消运行
                  </button>
                  <button
                    type="button"
                    className={button.ghost}
                    disabled={busy || !canResume}
                    onClick={() => void act('已从上次前缀恢复', () => resumeWorkflowRun(activeDetail.run.runId))}
                  >
                    恢复运行
                  </button>
                </div>

                <div className={styles.journalHead}>
                  <strong>Journal</strong>
                  <span>agent 行 {agents} · 尾部 {activeDetail.journalTail.length} 条</span>
                </div>
                {activeDetail.journalTail.length === 0 ? (
                  <p className={styles.empty}>还没有 journal 记录。</p>
                ) : (
                  <div className={styles.journal} data-testid="workflow-journal">
                    {activeDetail.journalTail.map((line, index) => (
                      <JournalRow key={`${line.seq ?? index}-${line.stepKey ?? line.kind ?? 'line'}`} line={line} />
                    ))}
                  </div>
                )}
              </>
            ) : null}
            {!detailLoading && !activeDetail ? <p className={styles.empty}>选择一个运行查看步骤、预算与 journal。</p> : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
