import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adoptResultChangeSet,
  compareResultChangeSet,
  getResultStudioWorkspaceStatus,
  listResultChangeSets,
  recoverResultStudioWorkspace,
  readRevisionTablePage,
  restoreArtifactRevision,
  revertResultChangeSet,
  revisionArtifactUrl,
  type ArtifactRevision,
  type ResultStudioChangeSet,
  type ResultStudioComparison,
  type ResultStudioWorkspaceStatus,
  type ResultStudioTablePage,
} from './resultStudioClient';
import styles from './ResultStudioChangeSetPanel.module.css';
import { resultVersionRoleLabel, resultVersionRoles } from './resultVersionRole';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  running: '处理中',
  preview_ready: '待采用',
  validation_failed: '验证失败',
  adopted: '已采用',
  reverted: '已撤销',
  abandoned: '已放弃',
};

const IMPACT_LABEL: Record<string, string> = {
  view_only: '仅查看',
  presentation_rerender: '展示变化',
  data_transform: '数据变化',
  scientific_recompute: '科学重算',
  workflow_replan: '流程变化',
  version_restore: '版本恢复',
};

const SCOPE_LABEL: Record<string, string> = {
  none: '不影响结果',
  current_result_only: '仅当前结果',
  workflow_subgraph: '影响下游流程',
  unknown: '影响范围待确认',
};

const VALIDATION_LABEL: Record<string, string> = {
  valid: '验证通过',
  degraded: '验证需要复核',
  blocked: '验证已阻断',
};

export type ResultStudioReviewMode = 'result' | 'compare' | 'history';

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
  onRevisionViewed,
  mode = 'result',
  onModeChange,
}: {
  projectId: string;
  artifactFamilyId: string;
  activeRevisionId?: string | null;
  onRevisionActivated?: (revision: ArtifactRevision) => void;
  onRevisionViewed?: (revision: ArtifactRevision) => void;
  mode?: ResultStudioReviewMode;
  onModeChange?: (mode: ResultStudioReviewMode) => void;
}): React.ReactElement | null {
  const [changeSets, setChangeSets] = useState<ResultStudioChangeSet[]>([]);
  const [revisions, setRevisions] = useState<ArtifactRevision[]>([]);
  const [currentRevision, setCurrentRevision] = useState<ArtifactRevision | null>(null);
  const [nextRevisionOffset, setNextRevisionOffset] = useState<number | null>(null);
  const [comparison, setComparison] = useState<ResultStudioComparison | null>(null);
  const [comparisonAttemptedFor, setComparisonAttemptedFor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorRetry, setErrorRetry] = useState<'versions' | 'compare' | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<ResultStudioWorkspaceStatus | null>(null);
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [tablePages, setTablePages] = useState<Record<string, ResultStudioTablePage>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    setErrorRetry(null);
    try {
      const data = await listResultChangeSets(projectId, artifactFamilyId);
      setChangeSets(data.changeSets);
      setRevisions(data.revisions);
      setCurrentRevision(data.currentRevision);
      setNextRevisionOffset(data.nextRevisionOffset ?? null);
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
      setErrorRetry('versions');
    } finally {
      setLoading(false);
    }
  }, [artifactFamilyId, projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const refreshWorkspaceStatus = useCallback(async () => {
    setWorkspaceLoading(true);
    setWorkspaceError('');
    try {
      const status = await getResultStudioWorkspaceStatus(projectId);
      setWorkspaceStatus(status);
    } catch {
      setWorkspaceStatus(null);
      setWorkspaceError('版本存储状态暂不可用；结果与版本列表仍可查看。');
    } finally {
      setWorkspaceLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refreshWorkspaceStatus();
  }, [refreshWorkspaceStatus]);

  const selected = useMemo(
    () => changeSets.find((item) => item.changeSetId === selectedId) || null,
    [changeSets, selectedId]
  );

  const loadComparison = useCallback(async () => {
    if (!selected) return;
    setComparisonAttemptedFor(selected.changeSetId);
    setLoading(true);
    setError('');
    setErrorRetry(null);
    try {
      setComparison(await compareResultChangeSet(selected.changeSetId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '比较加载失败');
      setErrorRetry('compare');
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    setComparison(null);
    setComparisonAttemptedFor(null);
    setTablePages({});
  }, [selectedId]);

  useEffect(() => {
    if (mode !== 'compare' || !selected || comparison || loading || comparisonAttemptedFor === selected.changeSetId) return;
    void loadComparison();
  }, [comparison, comparisonAttemptedFor, loadComparison, loading, mode, selected]);

  const loadTablePage = async (revisionId: string, more = false) => {
    setBusy(true);
    setError('');
    try {
      const current = tablePages[revisionId];
      const page = await readRevisionTablePage(revisionId, more ? current?.nextCursor || 0 : 0, 50);
      setTablePages((previous) => ({
        ...previous,
        [revisionId]: more && current ? { ...page, rows: [...current.rows, ...page.rows] } : page,
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '表格分页加载失败');
    } finally { setBusy(false); }
  };

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

  const recoverWorkspace = async () => {
    setBusy(true);
    setError('');
    try {
      await recoverResultStudioWorkspace(projectId);
      setWorkspaceStatus(await getResultStudioWorkspaceStatus(projectId));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '修改现场恢复失败');
    } finally {
      setBusy(false);
    }
  };

  const loadMoreRevisions = async () => {
    if (nextRevisionOffset === null) return;
    setBusy(true);
    setError('');
    try {
      const data = await listResultChangeSets(projectId, artifactFamilyId, nextRevisionOffset);
      setRevisions((current) => {
        const merged = new Map(current.map((revision) => [revision.revisionId, revision]));
        for (const revision of data.revisions) merged.set(revision.revisionId, revision);
        return [...merged.values()];
      });
      setNextRevisionOffset(data.nextRevisionOffset ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '更多历史版本加载失败');
    } finally {
      setBusy(false);
    }
  };

  if (!artifactFamilyId) return null;
  if (loading && changeSets.length === 0) return <section className={styles.root}><div className={styles.loading}>正在读取结果版本…</div></section>;
  if (mode === 'result' && !selected && revisions.length <= 1 && !error && !workspaceError) return null;

  const visual = comparison?.artifacts.filter((item) => item.kind === 'visual') || [];
  const tables = comparison?.artifacts.filter((item) => item.kind === 'table' && item.table) || [];
  const intentSummary = selected
    ? typeof selected.validationSummary?.intentSummary === 'string'
      ? selected.validationSummary.intentSummary
      : selected.intentRef?.startsWith('restore:')
        ? '恢复一个历史版本作为新的正式版本'
        : selected.intentRef?.startsWith('baseline:')
          ? '原始分析结果'
          : '结果修改候选'
    : '';
  const impactLevel = selected && typeof selected.validationSummary?.impactLevel === 'string'
    ? selected.validationSummary.impactLevel
    : null;

  return (
    <section className={styles.root} aria-label="Result Studio 版本与变更" data-mode={mode}>
      <div className={styles.header}>
        <div className={styles.title}>
          <strong>结果版本</strong>
          <span>{currentRevision ? `当前 v${currentRevision.revisionOrdinal}` : '尚无正式版本'}</span>
        </div>
        {mode !== 'history' && selected && <span className={styles.status} data-state={selected.status}>{STATUS_LABEL[selected.status] || selected.status}</span>}
      </div>

      {workspaceStatus && (
        <div className={styles.lifecycle} data-state={workspaceStatus.lifecycle.status}>
          <span>{workspaceStatus.lifecycle.status === 'blocked' ? '版本存储需要处理' : workspaceStatus.lifecycle.interrupted.length > 0 ? '检测到未完成的修改现场' : '版本存储正常'}</span>
          <span>{workspaceStatus.storage.revisionCount} 个版本 · {Math.ceil(workspaceStatus.storage.logicalArtifactBytes / 1024)} KB</span>
          {workspaceStatus.storage.deduplicableBytes > 0 && <span>可去重 {Math.ceil(workspaceStatus.storage.deduplicableBytes / 1024)} KB</span>}
          {workspaceStatus.lifecycle.interrupted.length > 0 && (
            <button type="button" disabled={busy} onClick={() => void recoverWorkspace()}>恢复修改现场</button>
          )}
        </div>
      )}
      {workspaceError && (
        <div className={styles.lifecycle} data-state="unavailable" role="alert">
          <span>{workspaceError}</span>
          <button type="button" disabled={workspaceLoading} onClick={() => void refreshWorkspaceStatus()}>
            {workspaceLoading ? '重试中…' : '重试存储状态'}
          </button>
        </div>
      )}

      {mode === 'history' && (
        <div className={styles.history}>
          {revisions.slice().sort((left, right) => right.revisionOrdinal - left.revisionOrdinal).map((revision) => (
            <div className={styles.historyRow} key={revision.revisionId}>
              <div className={styles.historyIdentity}>
                <strong>v{revision.revisionOrdinal}{revision.revisionId === activeRevisionId ? ' · 正在查看' : ''}</strong>
                <small>{resultVersionRoleLabel(resultVersionRoles(
                  revision,
                  changeSets.find((item) => item.changeSetId === revision.changeSetId),
                ))} · {revision.validationStatus} · {fileName(revision.outputPath)}</small>
              </div>
              <div className={styles.historyActions}>
                {revision.revisionId !== activeRevisionId && (
                  <button type="button" disabled={busy} onClick={() => onRevisionViewed?.(revision)}>查看</button>
                )}
                {!revision.isCurrent && (
                  <button type="button" disabled={busy} onClick={() => void restore(revision)}>恢复为新版本</button>
                )}
              </div>
            </div>
          ))}
          {nextRevisionOffset !== null && (
            <button className={styles.loadMore} type="button" disabled={busy} onClick={() => void loadMoreRevisions()}>加载更早版本</button>
          )}
        </div>
      )}

      {mode !== 'history' && selected && (
        <>
          <p className={styles.intentSummary}>{intentSummary}</p>
          <div className={styles.summary}>
            <span>{selected.createdBy === 'agent' ? 'Agent 修改' : '手动修改'}</span>
            <span>{impactLevel ? IMPACT_LABEL[impactLevel] || '影响待确认' : '影响待确认'}</span>
            {typeof selected.validationSummary?.affectedScope === 'string' && (
              <span>{SCOPE_LABEL[selected.validationSummary.affectedScope] || '影响范围待确认'}{typeof selected.validationSummary.affectedNodeCount === 'number' && selected.validationSummary.affectedNodeCount > 0 ? ` · ${selected.validationSummary.affectedNodeCount} 个节点` : ''}</span>
            )}
            <span>{typeof selected.validationSummary?.artifactTruthStatus === 'string'
              ? VALIDATION_LABEL[selected.validationSummary.artifactTruthStatus] || '验证状态待确认'
              : '验证状态待确认'}</span>
            <span>{selected.changedPaths.length} 个文件</span>
            {comparison && <span>+{comparison.summary.additions} −{comparison.summary.deletions}</span>}
            <span>{new Date(selected.updatedAt).toLocaleString()}</span>
          </div>
          {mode === 'compare' && changeSets.length > 1 && (
            <label className={styles.changeSetPicker}>
              <span>审查记录</span>
              <select value={selectedId || ''} onChange={(event) => setSelectedId(event.target.value)}>
                {changeSets.filter((item) => !item.intentRef?.startsWith('baseline:')).map((item) => (
                  <option key={item.changeSetId} value={item.changeSetId}>{STATUS_LABEL[item.status] || item.status} · {new Date(item.updatedAt).toLocaleString()}</option>
                ))}
              </select>
            </label>
          )}
          <div className={styles.actions}>
            {mode === 'result' && (
              <button type="button" disabled={busy || loading} onClick={() => onModeChange?.('compare')}>查看详细变化</button>
            )}
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
      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          {errorRetry === 'compare' && selected && !comparison && (
            <button type="button" onClick={() => void loadComparison()}>重试比较</button>
          )}
          {errorRetry === 'versions' && (
            <button type="button" onClick={() => void refresh()}>重试版本</button>
          )}
        </div>
      )}

      {mode === 'compare' && loading && !comparison && <div className={styles.loading} role="status">正在生成变更审查…</div>}

      {mode === 'compare' && comparison && (
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
              {!tablePages[artifact.afterRevisionId] ? (
                <button className={styles.tablePageButton} type="button" disabled={busy} onClick={() => void loadTablePage(artifact.afterRevisionId)}>渐进查看候选表</button>
              ) : (
                <div className={styles.virtualTable}>
                  <table>
                    <thead><tr>{tablePages[artifact.afterRevisionId].columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                    <tbody>{tablePages[artifact.afterRevisionId].rows.map((row, rowIndex) => (
                      <tr key={`${artifact.afterRevisionId}:${rowIndex}`}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
                    ))}</tbody>
                  </table>
                  {tablePages[artifact.afterRevisionId].nextCursor !== null && (
                    <button className={styles.tablePageButton} type="button" disabled={busy} onClick={() => void loadTablePage(artifact.afterRevisionId, true)}>继续加载</button>
                  )}
                </div>
              )}
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
