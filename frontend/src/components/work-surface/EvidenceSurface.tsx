import React from 'react';
import { Icon } from '@/components/icons/Icon';
import type { ToolJob } from '@/lib/project-types';
import type { HarnessWorkflowJobState } from '@/lib/harness-client';
import type { ActiveArtifact } from '@/components/workspace-panels/ResultView';
import { describeTruthStatus, shortRevisionLabel } from '@/components/result-studio/resultSurface';
import styles from './WorkSurfacePanels.module.css';

export function EvidenceSurface({
  activeJob,
  activeWorkflow,
  activeArtifact,
  onOpenResults,
  onOpenReview,
  onOpenPlan,
}: {
  activeJob: ToolJob | null;
  activeWorkflow: HarnessWorkflowJobState | null;
  activeArtifact: ActiveArtifact | null;
  onOpenResults: () => void;
  onOpenReview: () => void;
  onOpenPlan: () => void;
}): React.ReactElement {
  const truthStatus = typeof activeArtifact?.truthStatus === 'string'
    ? activeArtifact.truthStatus
    : typeof activeWorkflow?.artifactTruth?.status === 'string'
      ? activeWorkflow.artifactTruth.status
      : null;
  const truth = describeTruthStatus(truthStatus, activeJob?.status);
  const hasEvidence = Boolean(activeArtifact || activeJob || activeWorkflow);

  return (
    <div className={styles.panel} data-testid="evidence-surface" data-state={hasEvidence ? 'ready' : 'empty'}>
      <div className={styles.panelHeader}>
        <Icon name="shield" size={15} />
        <strong>证据</strong>
      </div>

      {!hasEvidence && (
        <p className={styles.empty}>当前没有可展示的产物或核验证据。打开一个结果后，这里会汇总可信状态。</p>
      )}

      {hasEvidence && (
        <div className={styles.list}>
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
        </div>
      )}
    </div>
  );
}
