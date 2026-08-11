import React from 'react';
import { Icon } from '@/components/icons/Icon';
import type { ArtifactSelection } from '@/lib/artifact-selection';
import {
  completeResultSurfaceMeasure,
  describeSelection,
  describeTruthStatus,
  RESULT_SURFACE_PERFORMANCE_MARKS,
  shortRevisionLabel,
  type ResultSurfaceMode,
  type ResultTruthProjection,
} from './resultSurface';
import { resolveResultMode } from './resultMode';
import type { ResultMode } from './resultMode';
import styles from './ResultStudioSurface.module.css';

export interface ResultInspectorArtifact {
  jobId: string;
  toolId: string;
  name: string;
  type: string;
  label?: string;
  url?: string;
  revisionId?: string | null;
  revisionOrdinal?: number | null;
  artifactFamilyId?: string | null;
  entityType?: string | null;
  idField?: string | null;
  selectionDurable?: boolean;
  selection?: ArtifactSelection | null;
  selectionId?: string | null;
  availabilityStatus?: 'checking' | 'available' | 'unavailable';
  availabilityReason?: string | null;
}

export function ResultStudioCanvas({
  mode,
  contextBar,
  composer,
  children,
  canProjectSource = false,
}: {
  mode: ResultSurfaceMode;
  contextBar?: React.ReactNode;
  composer?: React.ReactNode;
  children: React.ReactNode;
  canProjectSource?: boolean;
}): React.ReactElement {
  const [firstVisibleMs, setFirstVisibleMs] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    const duration = completeResultSurfaceMeasure({
      start: RESULT_SURFACE_PERFORMANCE_MARKS.openStart,
      end: RESULT_SURFACE_PERFORMANCE_MARKS.openEnd,
      measure: RESULT_SURFACE_PERFORMANCE_MARKS.openMeasure,
    });
    if (duration !== null) setFirstVisibleMs(duration);
  }, []);

  const activeMode = resolveResultMode(mode, { canProjectSource, canCompare: true, canSwitchVersions: true });

  return (
    <section
      className={styles.canvas}
      data-mode={activeMode}
      data-first-visible-ms={firstVisibleMs === null ? undefined : firstVisibleMs.toFixed(2)}
      role="region"
      aria-label="结果主画布"
    >
      {contextBar}
      <div className={styles.canvasBody}>{children}</div>
      {composer && <div className={styles.composerSlot}>{composer}</div>}
    </section>
  );
}

export function ResultStudioContextBar({
  title,
  trust,
  availabilityStatus = 'checking',
  conclusion,
  revisionLabel,
  selectionLabel,
  onBack,
  onAskAgent,
  activeMode = 'result',
  onModeChange,
  canReviewVersions = false,
  canProjectSource = false,
}: {
  title: string;
  trust: ResultTruthProjection;
  availabilityStatus?: 'checking' | 'available' | 'unavailable';
  conclusion: string;
  revisionLabel: string;
  selectionLabel: string;
  onBack: () => void;
  onAskAgent: () => void;
  activeMode?: Extract<ResultMode, 'result' | 'code' | 'compare' | 'history'>;
  onModeChange?: (mode: Extract<ResultMode, 'result' | 'code' | 'compare' | 'history'>) => void;
  canReviewVersions?: boolean;
  canProjectSource?: boolean;
}): React.ReactElement {
  return (
    <header className={styles.contextBar}>
      <button type="button" className={styles.backButton} onClick={onBack} aria-label="返回对话">
        <Icon name="arrow-left" size={14} />
      </button>
      <div className={styles.contextIdentity}>
        <div className={styles.titleRow}>
          <h2>{title}</h2>
          <span className={styles.truthBadge} data-tone={trust.tone}>{trust.label}</span>
          {availabilityStatus === 'unavailable' && (
            <span className={styles.availabilityBadge}>文件不可用</span>
          )}
        </div>
        <p>{conclusion}</p>
        <div className={styles.contextMeta}>
          <span>{revisionLabel}</span>
          <span>{selectionLabel}</span>
        </div>
        {(canReviewVersions || canProjectSource) && onModeChange && (
          <nav className={styles.modeSwitcher} aria-label="结果视图">
            {([
              ['result', '结果'],
              ...(canProjectSource ? [['code', '代码'] as const] : []),
              ['compare', '审查修改'],
              ['history', '版本历史'],
            ] as const).map(([mode, label]) => (
              <button className="biof3-btn biof3-btn--ghost biof3-btn--sm"
                key={mode}
                type="button"
                aria-current={activeMode === mode ? 'page' : undefined}
                onClick={() => onModeChange(mode)}
              >
                {label}
              </button>
            ))}
          </nav>
        )}
      </div>
      <button type="button" className={styles.askButton} onClick={onAskAgent} aria-label="询问 Agent">
        <Icon name="sparkles" size={14} />
        <span>询问 Agent</span>
      </button>
    </header>
  );
}

/**
 * G0-RS-P3 — Agent 上下文就绪状态。
 *
 * 只有后端真的投影出完整坐标时才显示"可交给 Agent"。归因只能到 Job、
 * 缺正式版本或选择过期时如实展示原因，不静默退化成"看起来可用"。
 */
export function ResultStudioContextReadiness({
  context,
}: {
  context: {
    status: 'ready' | 'blocked' | 'loading';
    reason?: string | null;
    selectionUsable?: boolean;
    selectionCompatibility?: 'compatible' | 'stale' | 'invalid' | null;
  } | null;
}): React.ReactElement | null {
  if (!context) return null;
  if (context.status === 'loading') {
    return (
      <p className={styles.contextReadiness} data-state="loading" role="status">
        正在读取 Agent 可用的结果坐标…
      </p>
    );
  }
  if (context.status === 'blocked') {
    return (
      <p className={styles.contextReadiness} data-state="blocked" role="status">
        Agent 暂时无法直接修改这个结果：{context.reason || '缺少可复现的来源坐标。'}
      </p>
    );
  }
  const selectionNote = context.selectionUsable
    ? '当前选择会一并交给 Agent。'
    : context.selectionCompatibility === 'stale'
      ? '当前选择已过期，不会交给 Agent，请重新选择。'
      : context.selectionCompatibility === 'invalid'
        ? '当前选择不可用，不会交给 Agent。'
        : '当前没有选择。';
  return (
    <p className={styles.contextReadiness} data-state="ready" role="status">
      Agent 已掌握这个结果的版本与来源，你只需说明想要的变化。{selectionNote}
    </p>
  );
}

export function ResultStudioInspector({
  artifact,
  jobStatus,
  truthStatus,
  onAskAgent,
  context = null,
}: {
  artifact: ResultInspectorArtifact | null;
  jobStatus: string | null | undefined;
  truthStatus: string | null | undefined;
  onAskAgent: (prompt: string) => void;
  context?: {
    status: 'ready' | 'blocked' | 'loading';
    reason?: string | null;
    selectionUsable?: boolean;
    selectionCompatibility?: 'compatible' | 'stale' | 'invalid' | null;
  } | null;
}): React.ReactElement {
  const trust = describeTruthStatus(truthStatus, jobStatus);
  if (!artifact) {
    return (
      <div className={styles.inspectorEmpty}>
        <Icon name="bar-chart" size={18} />
        <strong>尚未打开结果</strong>
        <span>从对话、任务或文件中打开一个结果后，这里会显示必要信息。</span>
      </div>
    );
  }

  const title = artifact.label || artifact.name;
  const selectionLabel = describeSelection(artifact.selection);
  return (
    <div className={styles.inspector} aria-label="结果检查器">
      <div className={styles.inspectorHeader}>
        <span>当前结果</span>
        <strong>{title}</strong>
        <span className={styles.truthBadge} data-tone={trust.tone}>{trust.label}</span>
        {artifact.availabilityStatus === 'unavailable' && (
          <span className={styles.availabilityBadge}>文件不可用</span>
        )}
      </div>
      <dl className={styles.inspectorFacts}>
        <div><dt>版本</dt><dd>{shortRevisionLabel(artifact.revisionId, artifact.revisionOrdinal)}</dd></div>
        <div><dt>类型</dt><dd>{artifact.type || '文件'}</dd></div>
        <div><dt>选择</dt><dd>{selectionLabel}</dd></div>
        <div><dt>来源</dt><dd>{artifact.toolId || '未知工具'}</dd></div>
        <div>
          <dt>文件</dt>
          <dd>{artifact.availabilityStatus === 'unavailable' ? '当前不可用' : artifact.availabilityStatus === 'available' ? '可读取' : '检查中'}</dd>
        </div>
      </dl>
      <ResultStudioContextReadiness context={context} />
      <div className={styles.inspectorActions}>
        <button className="biof3-btn biof3-btn--ghost biof3-btn--sm"
          type="button"
          onClick={() => onAskAgent(`请解释当前结果“${title}”的主要结论、可信边界和最合适的下一步。`)}
        >
          <Icon name="sparkles" size={13} />
          解释当前结果
        </button>
        {artifact.availabilityStatus === 'unavailable' && (
          <button className="biof3-btn biof3-btn--ghost biof3-btn--sm"
            type="button"
            onClick={() => onAskAgent(`请检查并恢复当前结果文件“${title}”。先说明缺失原因和可恢复边界，不要覆盖原始数据。`)}
          >
            <Icon name="refresh" size={13} />
            检查并恢复文件
          </button>
        )}
        {artifact.url && artifact.availabilityStatus !== 'unavailable' && (
          <a href={artifact.url} target="_blank" rel="noreferrer">打开原文件</a>
        )}
      </div>
      <details className={styles.technicalDetails}>
        <summary>技术详情</summary>
        <dl>
          <dt>文件</dt><dd>{artifact.name}</dd>
          <dt>Job</dt><dd>{artifact.jobId}</dd>
          <dt>Family</dt><dd>{artifact.artifactFamilyId || '未建立'}</dd>
          <dt>Revision</dt><dd>{artifact.revisionId || '未建立'}</dd>
          <dt>实体</dt><dd>{artifact.entityType || '未声明'}</dd>
          <dt>ID 字段</dt><dd>{artifact.idField || '未声明'}</dd>
          <dt>Selection</dt><dd>{artifact.selectionId || '未选择'}</dd>
        </dl>
      </details>
    </div>
  );
}
