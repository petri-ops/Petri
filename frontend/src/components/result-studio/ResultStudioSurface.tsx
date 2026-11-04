import React from 'react';
import { Icon } from '@/components/icons/Icon';
import {
  completeResultSurfaceMeasure,
  RESULT_SURFACE_PERFORMANCE_MARKS,
  type ResultSurfaceMode,
  type ResultTruthProjection,
} from './resultSurface';
import { resolveResultMode } from './resultMode';
import type { ResultMode } from './resultMode';
import styles from './ResultStudioSurface.module.css';

// BLOCK-334 — ResultStudioInspector / ResultStudioContextReadiness 退役：右栏「结果」tab
// 改由 work-surface/ResultsSurface 承载完整结果壳，Inspector 的事实（真值/版本/选择/
// 解释当前结果）与 ContextBar / CompactResultNavigator 重合，技术详情折进导航器次级动作区；
// Agent 上下文就绪文案由 ResultAgentComposer 自己呈现。

export function ResultStudioCanvas({
  mode,
  contextBar,
  composer,
  children,
  canProjectSource = false,
  canCompare = false,
}: {
  mode: ResultSurfaceMode;
  contextBar?: React.ReactNode;
  composer?: React.ReactNode;
  children: React.ReactNode;
  canProjectSource?: boolean;
  /** BLOCK-346 T4 — 原此处硬编码 `canCompare: true`（对所有适配器一律放开对照），
   * 与 viewerRegistry 的能力位（仅 table 族 true）矛盾。改为由调用方按适配器传。 */
  canCompare?: boolean;
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

  const activeMode = resolveResultMode(mode, { canProjectSource, canCompare, canSwitchVersions: true });

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
  /** BLOCK-334 — 右栏宿主下「返回」只回结果子态；result 子态本身无处可回，不传即不渲染。 */
  onBack?: () => void;
  onAskAgent: () => void;
  activeMode?: Extract<ResultMode, 'result' | 'code' | 'compare' | 'history'>;
  onModeChange?: (mode: Extract<ResultMode, 'result' | 'code' | 'compare' | 'history'>) => void;
  canReviewVersions?: boolean;
  canProjectSource?: boolean;
}): React.ReactElement {
  return (
    <header className={styles.contextBar}>
      {onBack && (
        <button type="button" className={styles.backButton} onClick={onBack} aria-label="返回结果">
          <Icon name="arrow-left" size={14} />
        </button>
      )}
      <div className={styles.contextIdentity}>
        <div className={styles.titleRow}>
          <h2>{title}</h2>
          <span className={styles.truthBadge} data-tone={trust.tone} title={trust.detail} aria-label={trust.detail ? `${trust.label}：${trust.detail}` : trust.label}>{trust.label}</span>
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
              <button className="petri-btn petri-btn--ghost petri-btn--sm"
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
