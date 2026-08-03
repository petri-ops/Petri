import React, { useMemo, useRef } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import {
  artifactFormatLabel,
  findResultArtifactPickerOption,
  type ResultArtifactPickerGroup,
} from '@/lib/result-artifact-display';
import type { ResultArtifactNavSection } from '@/lib/result-manifest';
import styles from './CompactResultNavigator.module.css';

export interface CompactResultNavigatorProps {
  groups: ResultArtifactPickerGroup[];
  selectedArtifactName: string;
  selectedArtifactLabel: string;
  selectedKindLabel: string;
  selectedIcon: IconName;
  selectedArtifactUrl?: string;
  relatedSections: ResultArtifactNavSection[];
  secondaryActions?: React.ReactNode;
  onSelectArtifact: (artifactName: string, sectionId: string) => void;
}

export function CompactResultNavigator({
  groups,
  selectedArtifactName,
  selectedArtifactLabel,
  selectedKindLabel,
  selectedIcon,
  selectedArtifactUrl,
  relatedSections,
  secondaryActions,
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
      <div className={styles.currentResult}>
        <span className={styles.currentIcon} aria-hidden="true">
          <Icon name={selectedIcon} size={15} />
        </span>
        <div className={styles.currentCopy}>
          <span className={styles.currentLabel}>当前结果</span>
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
                      {option.label} · {artifactFormatLabel(option.primary)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          ) : (
            <strong className={styles.currentName}>{selectedArtifactLabel}</strong>
          )}
          <span className={styles.currentMeta}>
            {selectedKindLabel}{resultCount > 0 ? ` · ${resultCount} 个结果` : ''}
          </span>
        </div>
      </div>

      <div className={styles.actions}>
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
        {hasMoreActions && (
          <details className={styles.more} ref={moreRef}>
            <summary aria-label="更多结果操作" title="更多结果操作">
              <Icon name="more-horizontal" size={16} />
            </summary>
            <div className={styles.moreMenu}>
              <div className={styles.moreHeader}>
                <strong>{selectedArtifactLabel}</strong>
                <span>{selectedKindLabel}</span>
              </div>
              {secondaryActions && (
                <div className={styles.secondaryActions}>{secondaryActions}</div>
              )}
              {relatedCount > 0 && (
                <div className={styles.relatedFiles}>
                  <div className={styles.menuLabel}>相关文件 · {relatedCount}</div>
                  {relatedSections.flatMap((section) =>
                    section.artifacts.map((artifact) => (
                      <button
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
