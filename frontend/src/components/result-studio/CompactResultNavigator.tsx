import React, { useMemo, useRef } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import {
  artifactFormatLabel,
  findResultArtifactPickerOption,
  type ResultArtifactPickerGroup,
} from '@/lib/result-artifact-display';
import type { ResultArtifactKind, ResultArtifactNavSection } from '@/lib/result-manifest';
import type { ResultSurfaceMode, ResultTruthProjection } from './resultSurface';
import { ContinueAnalysisMenu } from './ContinueAnalysisMenu';
import styles from './CompactResultNavigator.module.css';

export interface CompactResultNavigatorProps {
  groups: ResultArtifactPickerGroup[];
  selectedArtifactName: string;
  selectedArtifactLabel: string;
  selectedKindLabel: string;
  selectedIcon: IconName;
  selectedArtifactUrl?: string;
  /** BIO-3 P2 — 当前结果所属工具任务 ID（与 artifactKind 同传时挂「继续分析」入口）。 */
  jobId?: string;
  /** BIO-3 P2 — 当前产物分类（classifyArtifact 结果），决定下游分析项。 */
  artifactKind?: ResultArtifactKind;
  relatedSections: ResultArtifactNavSection[];
  secondaryActions?: React.ReactNode;
  truth?: ResultTruthProjection;
  availabilityStatus?: 'checking' | 'available' | 'unavailable';
  activeMode?: ResultSurfaceMode;
  canReviewVersions?: boolean;
  canProjectSource?: boolean;
  canUseInteraction?: boolean;
  interactionActive?: boolean;
  onBack?: () => void;
  onAskAgent?: () => void;
  onInteractionToggle?: () => void;
  onModeChange?: (mode: ResultSurfaceMode) => void;
  onSelectArtifact: (artifactName: string, sectionId: string) => void;
}

export function CompactResultNavigator({
  groups,
  selectedArtifactName,
  selectedArtifactLabel,
  selectedKindLabel,
  selectedIcon,
  selectedArtifactUrl,
  jobId,
  artifactKind,
  relatedSections,
  secondaryActions,
  truth,
  availabilityStatus = 'checking',
  activeMode = 'result',
  canReviewVersions = false,
  canProjectSource = false,
  canUseInteraction = false,
  interactionActive = false,
  onBack,
  onAskAgent,
  onInteractionToggle,
  onModeChange,
  onSelectArtifact,
}: CompactResultNavigatorProps): React.ReactElement {
  const moreRef = useRef<HTMLDetailsElement | null>(null);
  const selectedOption = useMemo(
    () => findResultArtifactPickerOption(groups, selectedArtifactName),
    [groups, selectedArtifactName],
  );
  const resultCount = groups.reduce((count, group) => count + group.options.length, 0);
  const relatedCount = relatedSections.reduce(
    (count, section) => count + section.artifacts.length,
    0,
  );
  const selectedValue = selectedOption?.option.primary.name || selectedArtifactName;
  const hasMoreActions = Boolean(secondaryActions) || relatedCount > 0;
  const modes: Array<{ id: ResultSurfaceMode; label: string }> = [
    { id: 'result', label: '结果' },
    ...(canProjectSource ? [{ id: 'code' as const, label: '代码' }] : []),
    ...(canReviewVersions
      ? [
          { id: 'compare' as const, label: '审查' },
          { id: 'history' as const, label: '历史' },
        ]
      : []),
  ];

  const selectArtifact = (artifactName: string): void => {
    for (const group of groups) {
      const option = group.options.find((item) => item.primary.name === artifactName);
      if (!option) continue;
      onSelectArtifact(option.primary.name, group.id);
      return;
    }
  };

  const selectRelatedArtifact = (artifactName: string, sectionId: string): void => {
    onSelectArtifact(artifactName, sectionId);
    if (moreRef.current) moreRef.current.open = false;
  };

  return (
    <div className={styles.navigator} data-testid="compact-result-navigator">
      {onBack && (
        <button
          type="button"
          className={styles.iconAction}
          onClick={onBack}
          aria-label="返回对话"
          title="返回对话"
        >
          <Icon name="arrow-left" size={15} />
        </button>
      )}
      <div className={styles.currentResult}>
        <span className={styles.currentIcon} aria-hidden="true">
          <Icon name={selectedIcon} size={15} />
        </span>
        <div className={styles.currentCopy}>
          {resultCount > 1 ? (
            <select
              className={styles.resultSelect}
              aria-label="切换当前结果"
              value={selectedValue}
              onChange={(event) => selectArtifact(event.target.value)}
            >
              {!selectedOption && selectedArtifactName && (
                <option value={selectedArtifactName}>{selectedArtifactLabel}</option>
              )}
              {groups.map((group) => (
                <optgroup key={group.id} label={group.label}>
                  {group.options.map((option) => (
                    <option key={option.key} value={option.primary.name}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          ) : (
            <strong className={styles.currentName}>{selectedArtifactLabel}</strong>
          )}
        </div>
        {truth && (
          <span className={styles.truthBadge} data-tone={truth.tone}>{truth.label}</span>
        )}
        {availabilityStatus === 'unavailable' && (
          <span className={styles.availabilityBadge}>文件不可用</span>
        )}
      </div>

      {onModeChange && modes.length > 1 && (
        <nav className={styles.modeSwitcher} aria-label="结果视图">
          {modes.map((item) => (
            <button className="gewu-btn gewu-btn--ghost gewu-btn--sm"
              key={item.id}
              type="button"
              aria-current={activeMode === item.id ? 'page' : undefined}
              onClick={() => onModeChange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      )}

      <div className={styles.actions}>
        {jobId && artifactKind && (
          <ContinueAnalysisMenu
            jobId={jobId}
            artifactName={selectedArtifactName}
            artifactKind={artifactKind}
          />
        )}
        {canUseInteraction && onInteractionToggle && (
          <button
            type="button"
            className={styles.iconAction}
            onClick={onInteractionToggle}
            aria-label={interactionActive ? '查看原始图像' : '进入交互选择'}
            title={interactionActive ? '查看原始图像' : '进入交互选择'}
            aria-pressed={interactionActive}
          >
            <Icon name={interactionActive ? 'image' : 'bar-chart'} size={15} />
          </button>
        )}
        {selectedArtifactUrl && (
          <a
            className={styles.iconAction}
            href={selectedArtifactUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="打开当前结果"
            title="打开当前结果"
          >
            <Icon name="eye" size={15} />
          </a>
        )}
        {onAskAgent && (
          <button
            type="button"
            className={styles.iconAction}
            onClick={onAskAgent}
            aria-label="询问 Agent"
            title="询问 Agent"
          >
            <Icon name="sparkles" size={15} />
          </button>
        )}
        {hasMoreActions && (
          <details className={styles.more} ref={moreRef}>
            <summary aria-label="更多结果操作" title="更多结果操作">
              <Icon name="more-horizontal" size={16} />
            </summary>
            <div className={styles.moreMenu}>
              <div className={styles.moreHeader}>
                <strong>{selectedArtifactLabel}</strong>
                <span>
                  {selectedKindLabel}{resultCount > 0 ? ` · ${resultCount} 个结果` : ''}
                </span>
              </div>
              {secondaryActions && (
                <div className={styles.secondaryActions}>{secondaryActions}</div>
              )}
              {relatedCount > 0 && (
                <div className={styles.relatedFiles}>
                  <div className={styles.menuLabel}>相关文件 · {relatedCount}</div>
                  {relatedSections.flatMap((section) =>
                    section.artifacts.map((artifact) => (
                      <button className="gewu-btn gewu-btn--ghost gewu-btn--sm"
                        key={`${section.id}:${artifact.name}`}
                        type="button"
                        onClick={() => selectRelatedArtifact(artifact.name, section.id)}
                        aria-label={artifact.label || artifact.title || artifact.name}
                        title={artifact.label || artifact.title || artifact.name}
                      >
                        <span>{artifact.label || artifact.title || artifact.name}</span>
                        <small>{artifactFormatLabel(artifact)}</small>
                      </button>
                    )),
                  )}
                </div>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
