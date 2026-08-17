// ============================================================
// ResultVersionHistory Component
//
// Phase 4: Result version management UI
// Displays version history and supports version switching
// ============================================================

import React, { useState } from 'react';
import { resultApi } from '../../../lib/resultBridge';
import type { ResultVersion } from '../../../types/result.types';
import styles from '../ResultStudio.module.css';

interface ResultVersionHistoryProps {
  resultId: string;
  currentVersion: number;
  onVersionSelect: (version: ResultVersion) => void;
}

export const ResultVersionHistory: React.FC<ResultVersionHistoryProps> = ({
  resultId,
  currentVersion,
  onVersionSelect,
}) => {
  const [versions, setVersions] = useState<ResultVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadVersions = async () => {
    if (loaded && versions.length > 0) {
      setExpanded(!expanded);
      return;
    }

    setLoading(true);
    try {
      const versionList = await resultApi.version.list(resultId);
      setVersions(versionList || []);
      setExpanded(true);
      setLoaded(true);
    } catch (error) {
      console.error('Failed to load versions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleVersionClick = (version: ResultVersion) => {
    onVersionSelect(version);
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className={styles.versionHistory}>
      <button
        type="button"
        className={styles.versionHeader}
        onClick={loadVersions}
        aria-expanded={expanded}
      >
        <span>版本历史 ({loaded ? versions.length : '...'})</span>
        <span className={`${styles.expandIcon} ${expanded ? styles.expanded : ''}`}>
          ▼
        </span>
      </button>

      {expanded && (
        <div className={styles.versionList}>
          {loading && <div className={styles.loading}>加载中...</div>}

          {!loading && versions.map((version) => (
            <div
              key={version.id}
              className={`${styles.versionItem} ${
                version.version === currentVersion ? styles.active : ''
              }`}
              onClick={() => handleVersionClick(version)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  handleVersionClick(version);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className={styles.versionNumber}>
                v{version.version}
                {version.version === currentVersion && (
                  <span className={styles.currentBadge}>当前</span>
                )}
              </div>
              <div className={styles.versionMeta}>
                <span>{formatDate(version.createdAt)}</span>
              </div>
            </div>
          ))}

          {!loading && versions.length === 0 && (
            <div className={styles.emptyVersions}>暂无版本历史</div>
          )}
        </div>
      )}
    </div>
  );
};
