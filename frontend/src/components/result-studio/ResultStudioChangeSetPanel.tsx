import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adoptResultChangeSet,
  compareResultChangeSet,
  listResultChangeSets,
  restoreArtifactRevision,
  revertResultChangeSet,
  revisionArtifactUrl,
  type ArtifactRevision,
  type ResultStudioChangeSet,
  type ResultStudioComparison,
} from './resultStudioClient';
import styles from './ResultStudioChangeSetPanel.module.css';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  running: '处理中',
  preview_ready: '待采用',
  validation_failed: '验证失败',
  adopted: '已采用',
  reverted: '已撤销',
  abandoned: '已放弃',
};

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

function displayValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function ResultStudioChangeSetPanel({
  projectId,
  artifactFamilyId,
  activeRevisionId,
  onRevisionActivated,
}: {
  projectId: string;
  artifactFamilyId: string;
  activeRevisionId?: string | null;
  onRevisionActivated?: (revision: ArtifactRevision) => void;
}): React.ReactElement | null {
  const [changeSets, setChangeSets] = useState<ResultStudioChangeSet[]>([]);
  const [revisions, setRevisions] = useState<ArtifactRevision[]>([]);
  const [currentRevision, setCurrentRevision] = useState<ArtifactRevision | null>(null);
  const [comparison, setComparison] = useState<ResultStudioComparison | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listResultChangeSets(projectId, artifactFamilyId);
      setChangeSets(data.changeSets);
      setRevisions(data.revisions);
      setCurrentRevision(data.currentRevision);
      const nonBaseline = data.changeSets.filter((item) => !item.intentRef?.startsWith('baseline:'));
      const preferred = nonBaseline.find((item) => item.status === 'preview_ready')
        || nonBaseline.find((item) => item.status === 'adopted')
        || nonBaseline[0]
        || data.changeSets[0]
        || null;
      setSelectedId((current) => current && data.changeSets.some((item) => item.changeSetId === current)
        ? current
        : preferred?.changeSetId || null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '版本信息加载失败');
    } finally {
      setLoading(false);
    }
  }, [artifactFamilyId, projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selected = useMemo(
    () => changeSets.find((item) => item.changeSetId === selectedId) || null,
    [changeSets, selectedId]
  );

  const loadComparison = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    setError('');
    try {
      setComparison(await compareResultChangeSet(selected.changeSetId));
      setExpanded(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '比较加载失败');
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    setComparison(null);
    setExpanded(false);
  }, [selectedId]);

  const runAction = async (action: 'adopt' | 'revert', changeSet: ResultStudioChangeSet) => {
    setBusy(true);
    setError('');
    try {
      if (action === 'adopt') {
        const result = await adoptResultChangeSet(changeSet.changeSetId);
        const revision = result.currentRevisions?.[0];
        if (revision) onRevisionActivated?.(revision);
      } else {
        await revertResultChangeSet(changeSet.changeSetId);
      }
      setComparison(null);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '版本操作失败');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (revision: ArtifactRevision) => {
    setBusy(true);
    setError('');
    try {
      const result = await restoreArtifactRevision(revision.revisionId);
      if (result.revision) onRevisionActivated?.(result.revision);
      setComparison(null);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '历史版本恢复失败');
    } finally {
      setBusy(false);
    }
  };

  if (!artifactFamilyId) return null;
  if (loading && changeSets.length === 0) return <section className={styles.root}><div className={styles.loading}>正在读取结果版本…</div></section>;
  if (!selected && revisions.length <= 1 && !error) return null;

  const visual = comparison?.artifacts.filter((item) => item.kind === 'visual') || [];
  const tables = comparison?.artifacts.filter((item) => item.kind === 'table' && item.table) || [];

  return (
    <section className={styles.root} aria-label="Result Studio 版本与变更">
      <div className={styles.header}>
        <div className={styles.title}>
          <strong>结果版本</strong>
          <span>{currentRevision ? `当前 v${currentRevision.revisionOrdinal}` : '尚无正式版本'}</span>
        </div>
        {selected && <span className={styles.status} data-state={selected.status}>{STATUS_LABEL[selected.status] || selected.status}</span>}
      </div>

      {selected && (
        <>
          <div className={styles.summary}>
            <span>{selected.createdBy === 'agent' ? 'Agent 修改' : '手动修改'}</span>
            <span>{selected.changedPaths.length} 个文件</span>
            {comparison && <span>+{comparison.summary.additions} −{comparison.summary.deletions}</span>}
            <span>{new Date(selected.updatedAt).toLocaleString()}</span>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => {
                if (expanded) setExpanded(false);
                else void loadComparison();
              }}
            >
              {expanded ? '收起比较' : '比较结果'}
            </button>
            {selected.status === 'preview_ready' && (
              <>
                <button className={styles.danger} type="button" disabled={busy} onClick={() => void runAction('revert', selected)}>放弃候选</button>
                <button className={styles.primary} type="button" disabled={busy} onClick={() => void runAction('adopt', selected)}>采用此版本</button>
              </>
            )}
            {selected.status === 'adopted' && !selected.intentRef?.startsWith('baseline:') && (
              <button className={styles.danger} type="button" disabled={busy} onClick={() => void runAction('revert', selected)}>撤销本次采用</button>
            )}
          </div>
        </>
      )}
      {error && <div className={styles.error}>{error}</div>}

      {expanded && comparison && (
        <div className={styles.details}>
          {visual.map((artifact) => (
            <section className={styles.section} key={artifact.afterRevisionId}>
              <h4>{artifact.artifactId} · 前后对比</h4>
              <div className={styles.visualGrid}>
                {artifact.beforeRevisionId && (
                  <figure className={styles.visualFigure}>
                    <figcaption>修改前</figcaption>
                    <img src={revisionArtifactUrl(artifact.beforeRevisionId)} alt={`${artifact.artifactId} 修改前`} />
                  </figure>
                )}
                <figure className={styles.visualFigure}>
                  <figcaption>候选结果 · {artifact.validationStatus}</figcaption>
                  <img src={revisionArtifactUrl(artifact.afterRevisionId)} alt={`${artifact.artifactId} 修改后`} />
                </figure>
              </div>
            </section>
          ))}

          {tables.map((artifact) => (
            <section className={styles.section} key={artifact.afterRevisionId}>
              <h4>{artifact.artifactId} · 表格语义比较</h4>
              <table className={styles.tableCompare}><tbody>
                <tr><td>行数</td><td>{artifact.table?.before?.rowCount ?? '—'} → {artifact.table?.after?.rowCount ?? '—'}{artifact.table?.truncated ? '（大文件前缀统计）' : ''}</td></tr>
                <tr><td>新增列</td><td>{artifact.table?.addedColumns?.join('、') || '无'}</td></tr>
                <tr><td>移除列</td><td>{artifact.table?.removedColumns?.join('、') || '无'}</td></tr>
                <tr><td>抽样变化</td><td>{artifact.table?.sampleChanges?.length || 0} 行</td></tr>
              </tbody></table>
            </section>
          ))}

          {comparison.jsonDiffs.some((item) => item.changes.length > 0) && (
            <section className={styles.section}>
              <h4>参数与结构变化</h4>
              <div className={styles.jsonList}>
                {comparison.jsonDiffs.flatMap((diff) => diff.changes.map((change) => (
                  <div className={styles.jsonRow} key={`${diff.relativePath}:${change.field}`} title={`${displayValue(change.before)} → ${displayValue(change.after)}`}>
                    <span>{change.changeType}</span><code>{change.field}: {displayValue(change.before)} → {displayValue(change.after)}</code>
                  </div>
                )))}
              </div>
            </section>
          )}

          {comparison.textDiff.patch && (
            <section className={styles.section}>
              <h4>脚本与文本变化</h4>
              <div className={styles.diffMeta}>+{comparison.textDiff.additions} −{comparison.textDiff.deletions}{comparison.textDiff.truncated ? ' · 已截断' : ''}</div>
              <pre className={styles.patch}>{comparison.textDiff.patch}</pre>
            </section>
          )}

          <section className={styles.section}>
            <h4>版本历史</h4>
            <div className={styles.history}>
              {revisions.slice().reverse().map((revision) => (
                <div className={styles.historyRow} key={revision.revisionId}>
                  <div className={styles.historyIdentity}>
                    <strong>v{revision.revisionOrdinal}{revision.isCurrent ? ' · 当前' : ''}{revision.revisionId === activeRevisionId ? ' · 正在查看' : ''}</strong>
                    <small>{revision.validationStatus} · {fileName(revision.outputPath)}</small>
                  </div>
                  {!revision.isCurrent && (
                    <button type="button" disabled={busy} onClick={() => void restore(revision)}>恢复为新版本</button>
                  )}
                </div>
              ))}
            </div>
          </section>

          <details className={`${styles.section} ${styles.advanced}`}>
            <summary>高级 Git 信息</summary>
            <dl>
              <dt>base</dt><dd>{comparison.git.baseCommit}</dd>
              <dt>candidate</dt><dd>{comparison.git.candidateCommit || '—'}</dd>
              <dt>branch</dt><dd>{comparison.git.workingBranchRef}</dd>
            </dl>
          </details>
        </div>
      )}
    </section>
  );
}
