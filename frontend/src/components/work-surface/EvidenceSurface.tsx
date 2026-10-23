import React, { useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { fetchTrajectory } from '@/lib/trajectoryClient';
import type { ToolJob } from '@/lib/project-types';
import type { HarnessWorkflowJobState } from '@/lib/harness-client';
import type { ActiveArtifact } from '@/components/workspace-panels/ResultView';
import { describeTruthStatus, shortRevisionLabel } from '@/components/result-studio/resultSurface';
import styles from './WorkSurfacePanels.module.css';

export function EvidenceSurface({
  activeJob,
  activeWorkflow,
  activeArtifact,
  conversationId,
  onOpenResults,
  onOpenReview,
  onOpenPlan,
  onOpenTrace,
}: {
  activeJob: ToolJob | null;
  activeWorkflow: HarnessWorkflowJobState | null;
  activeArtifact: ActiveArtifact | null;
  /** BLOCK-248（Q3）— 事件级证据：只取统计（limit=1），不把整页事件搬进证据面。 */
  conversationId?: string | null;
  onOpenResults: () => void;
  onOpenReview: () => void;
  onOpenPlan: () => void;
  onOpenTrace?: () => void;
}): React.ReactElement {
  // 状态按会话归属存放：换会话时旧结果自然失效（派生为 loading），
  // 无需在 effect 里同步 setState（react-hooks/set-state-in-effect 会红）。
  const [trace, setTrace] = useState<{
    conversationId: string;
    summary: { events: number; toolCalls: number; toolFailures: number } | null;
    state: 'ready' | 'unavailable';
  } | null>(null);

  useEffect(() => {
    if (!conversationId) return undefined;
    let cancelled = false;
    void fetchTrajectory({ conversationId, limit: 1 })
      .then((data) => {
        if (cancelled) return;
        if (data.stats && data.availability === 'available') {
          setTrace({
            conversationId,
            summary: {
              events: data.stats.events,
              toolCalls: data.stats.toolCalls,
              toolFailures: data.stats.toolFailures,
            },
            state: 'ready',
          });
        } else {
          setTrace({ conversationId, summary: null, state: 'unavailable' });
        }
      })
      .catch(() => {
        if (!cancelled) setTrace({ conversationId, summary: null, state: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const traceForConversation = conversationId && trace && trace.conversationId === conversationId ? trace : null;
  const traceState: 'idle' | 'loading' | 'ready' | 'unavailable' = !conversationId
    ? 'idle'
    : traceForConversation
      ? traceForConversation.state
      : 'loading';
  const traceStats = traceForConversation ? traceForConversation.summary : null;

  const truthStatus = typeof activeArtifact?.truthStatus === 'string'
    ? activeArtifact.truthStatus
    : typeof activeWorkflow?.artifactTruth?.status === 'string'
      ? activeWorkflow.artifactTruth.status
      : null;
  const truth = describeTruthStatus(truthStatus, activeJob?.status);
  const hasEvidence = Boolean(activeArtifact || activeJob || activeWorkflow);
  const hasTrace = Boolean(conversationId) || Boolean(onOpenTrace);

  return (
    <div className={styles.panel} data-testid="evidence-surface" data-state={hasEvidence || hasTrace ? 'ready' : 'empty'}>
      <div className={styles.panelHeader}>
        <Icon name="shield" size={15} />
        <strong>证据</strong>
      </div>

      {!hasEvidence && !hasTrace && (
        <p className={styles.empty}>当前没有可展示的产物或核验证据。打开一个结果后，这里会汇总可信状态。</p>
      )}

      {(hasEvidence || hasTrace) && (
        <div className={styles.list}>
          {hasEvidence && (
          <>
          <section className={styles.row}>
            <div className={styles.rowHeader}>
              <Icon name="bar-chart" size={13} />
              <strong>产物可信状态</strong>
              <span className={styles.badge} data-tone={truth.tone}>{truth.label}</span>
            </div>
            <dl className={styles.fields}>
              <dt>产物</dt><dd>{activeArtifact?.label || activeArtifact?.name || activeJob?.name || '—'}</dd>
              <dt>任务</dt><dd>{activeJob?.tool_id || '—'}</dd>
              <dt>状态</dt><dd>{activeJob?.status || activeWorkflow?.jobStatus || '—'}</dd>
              <dt>版本</dt><dd>{shortRevisionLabel(activeArtifact?.revisionId, activeArtifact?.revisionOrdinal)}</dd>
              <dt>可用性</dt><dd>{activeArtifact?.availabilityStatus || '—'}</dd>
            </dl>
            {truth.detail ? <p className={styles.muted}>{truth.detail}</p> : null}
          </section>
          <section className={styles.row}>
            <div className={styles.rowHeader}>
              <Icon name="layers" size={13} />
              <strong>相关工作面</strong>
            </div>
            <div className={styles.actions}>
              <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={onOpenResults}>打开结果</button>
              <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={onOpenReview}>打开审阅</button>
              <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={onOpenPlan}>打开计划</button>
            </div>
          </section>
          </>
          )}
          {/* BLOCK-248（Q3）— 事件级证据：只显示统计与入口，事件本体在「轨迹」surface */}
          {hasTrace && (
            <section className={styles.row} data-testid="evidence-trace">
              <div className={styles.rowHeader}>
                <Icon name="layers" size={13} />
                <strong>执行事件</strong>
              </div>
              {traceState === 'ready' && traceStats ? (
                <p className={styles.muted} data-testid="evidence-trace-stats">
                  事件 {traceStats.events} · 工具 {traceStats.toolCalls} · 失败 {traceStats.toolFailures}
                </p>
              ) : traceState === 'loading' ? (
                <p className={styles.muted}>正在读取执行事件…</p>
              ) : traceState === 'unavailable' ? (
                <p className={styles.muted}>执行事件暂不可读（事件可能已按保留策略清理）。</p>
              ) : (
                <p className={styles.muted}>打开一个会话后可查看执行事件。</p>
              )}
              {onOpenTrace ? (
                <div className={styles.actions}>
                  <button
                    type="button"
                    className="petri-btn petri-btn--ghost petri-btn--sm"
                    data-testid="evidence-open-trace"
                    onClick={onOpenTrace}
                  >
                    查看执行轨迹
                  </button>
                </div>
              ) : null}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
