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
import { isBaselineIntentRef, resultVersionRoleLabel, resultVersionRoles } from './resultVersionRole';

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

function redactWindowsCoordinates(value: string): string {
  let output = '';
  let index = 0;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    const startsCoordinate = ((code >= 65 && code <= 90) || (code >= 97 && code <= 122))
      && value[index + 1] === ':' && value.charCodeAt(index + 2) === 92;
    if (!startsCoordinate) {
      output += value[index];
      index += 1;
      continue;
    }
    const quote = index > 0 && (value[index - 1] === '"' || value[index - 1] === "'")
      ? value[index - 1]
      : null;
    let end = index + 3;
    while (end < value.length) {
      const character = value[end];
      if (character === '\r' || character === '\n'
          || (quote ? character === quote : /\s|["'`<>]/.test(character))) break;
      end += 1;
    }
    output += '[project file]';
    index = end;
  }
  return output;
}

function publicDisplayText(value: string): string {
  return redactWindowsCoordinates(value
    .replace(/(["'])(?:\/Users\/|\/home\/)[^"'\r\n]*\1/g, '$1[project file]$1')
    .replace(/(?:\/Users\/|\/home\/)[^\s"'`<>]*/g, '[project file]'));
}

function displayValue(value: unknown): string {
  if (value == null) return '—';
  return publicDisplayText(typeof value === 'string' ? value : JSON.stringify(value));
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function measuredNumber(
  measurement: { status: 'measured' | 'partial' | 'unavailable'; value: number | null },
  formatter: (value: number) => string,
): string {
  if (measurement.value == null || measurement.status === 'unavailable') return '不可用';
  const formatted = formatter(measurement.value);
  return measurement.status === 'partial' ? `至少 ${formatted}` : formatted;
}

function measuredCost(
  measurement: { status: 'measured' | 'partial' | 'unavailable'; value: number | null; unit: string | null },
): string {
  if (measurement.status !== 'measured' || measurement.value == null || !measurement.unit) return '不可用';
  return `${measurement.unit} ${measurement.value}`;
}

interface EnrichmentDirectionEntry {
  id: string;
  direction: string;
}

interface EnrichmentDirectionChange {
  id: string;
  before: string;
  after: string;
}

interface AvailableEnrichmentDirection {
  changedCount: number;
  before: EnrichmentDirectionEntry[];
  after: EnrichmentDirectionEntry[];
  changes: EnrichmentDirectionChange[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function directionEntries(value: unknown): EnrichmentDirectionEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: EnrichmentDirectionEntry[] = [];
  for (const item of value) {
    const candidate = record(item);
    if (!candidate || typeof candidate.id !== 'string' || typeof candidate.direction !== 'string') return null;
    entries.push({ id: candidate.id, direction: candidate.direction });
  }
  return entries;
}

function directionChanges(value: unknown): EnrichmentDirectionChange[] | null {
  if (!Array.isArray(value)) return null;
  const changes: EnrichmentDirectionChange[] = [];
  for (const item of value) {
    const candidate = record(item);
    if (!candidate || typeof candidate.id !== 'string'
        || typeof candidate.before !== 'string' || typeof candidate.after !== 'string') return null;
    changes.push({ id: candidate.id, before: candidate.before, after: candidate.after });
  }
  return changes;
}

function availableEnrichmentDirection(value: unknown): AvailableEnrichmentDirection | null {
  const candidate = record(value);
  if (!candidate || candidate.status !== 'available'
      || typeof candidate.changedCount !== 'number' || !Number.isInteger(candidate.changedCount)
      || candidate.changedCount < 0) return null;
  const before = directionEntries(candidate.before);
  const after = directionEntries(candidate.after);
  const changes = directionChanges(candidate.changes);
  if (!before || !after || !changes || candidate.changedCount !== changes.length) return null;
  return { changedCount: candidate.changedCount, before, after, changes };
}

function formatDirectionEntries(entries: EnrichmentDirectionEntry[]): string {
  return entries.map((entry) => `${entry.id} ${entry.direction}`).join('、') || '无';
}

function executedNodeIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function ScientificDifference({ scientific }: { scientific: NonNullable<ResultStudioComparison['artifacts'][number]['scientific']> }): React.ReactElement {
  if (scientific.status === 'unavailable') {
    return <p className={styles.scientificUnavailable}>科学差异暂不可用：{scientific.reason || '来源表缺少可验证的语义契约。'}</p>;
  }
  if (scientific.kind === 'differential_expression' && scientific.significantGenes) {
    const { before, after, membership } = scientific.significantGenes;
    return <table className={styles.tableCompare}><tbody>
      <tr><td>显著基因</td><td>{before.significantCount} → {after.significantCount}</td></tr>
      <tr><td>上调 / 下调</td><td>{before.upCount} / {before.downCount} → {after.upCount} / {after.downCount}</td></tr>
      <tr><td>关键基因变化</td><td>新增 {membership.gainedCount}，移除 {membership.lostCount}；{[...membership.gained, ...membership.lost].join('、') || '无'}</td></tr>
      {scientific.thresholds && <tr><td>阈值 (padj / |log2FC|)</td><td>{scientific.thresholds.before.padjCutoff} / {scientific.thresholds.before.lfcCutoff} → {scientific.thresholds.after.padjCutoff} / {scientific.thresholds.after.lfcCutoff}</td></tr>}
    </tbody></table>;
  }
  if (scientific.kind === 'volcano_classification' && scientific.classifications) {
    const { before, after, membership } = scientific.classifications;
    return <table className={styles.tableCompare}><tbody>
      <tr><td>显著分类</td><td>{before.significantCount} → {after.significantCount}</td></tr>
      <tr><td>上调 / 下调</td><td>{before.upCount} / {before.downCount} → {after.upCount} / {after.downCount}</td></tr>
      <tr><td>标记基因变化</td><td>新增 {membership.gainedCount}，移除 {membership.lostCount}；{[...membership.gained, ...membership.lost].join('、') || '无'}</td></tr>
    </tbody></table>;
  }
  if (scientific.kind === 'functional_enrichment' && scientific.terms) {
    const direction = availableEnrichmentDirection(scientific.direction);
    return <table className={styles.tableCompare}><tbody>
      <tr><td>富集条目</td><td>{scientific.terms.beforeCount} → {scientific.terms.afterCount}</td></tr>
      <tr><td>通路变化</td><td>新增 {scientific.terms.membership.gainedCount}，移除 {scientific.terms.membership.lostCount}</td></tr>
      <tr><td>前列通路</td><td>{scientific.terms.topBefore.slice(0, 3).map((item) => item.id).join('、') || '—'} → {scientific.terms.topAfter.slice(0, 3).map((item) => item.id).join('、') || '—'}</td></tr>
      <tr><td>方向变化</td><td>{direction
        ? `${direction.changedCount} 条；${direction.changes.map((item) => `${item.id} ${item.before} → ${item.after}`).join('、') || '无'}`
        : scientific.direction?.status === 'available'
          ? '方向明细不完整，未作推断'
          : '当前结果表未声明方向，未作推断'}</td></tr>
      {direction && <tr><td>前列通路方向</td><td>{formatDirectionEntries(direction.before)} → {formatDirectionEntries(direction.after)}</td></tr>}
    </tbody></table>;
  }
  return <p className={styles.scientificUnavailable}>科学差异没有可展示的受信摘要。</p>;
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
      const nonBaseline = data.changeSets.filter((item) => !isBaselineIntentRef(item.intentRef));
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
        : isBaselineIntentRef(selected.intentRef)
          ? '原始分析结果'
          : '结果修改候选'
    : '';
  const impactLevel = selected && typeof selected.validationSummary?.impactLevel === 'string'
    ? selected.validationSummary.impactLevel
    : null;
  const executedNodes = executedNodeIds(selected?.validationSummary?.executedNodeIds);
  const interruptedRecoveries = workspaceStatus?.lifecycle.interrupted || [];
  const interruptedRecovery = interruptedRecoveries[0] || null;
  const activeOperations = workspaceStatus?.lifecycle.activeOperations || [];
  const activeOperation = activeOperations[0] || null;
  const pendingDecisionCount = workspaceStatus?.lifecycle.pendingDecisions?.length || 0;
  const checkpointStageLabel = (stage?: string | null) => ({
    change_set: '创建修改',
    materialized: '准备执行',
    candidate_committed: '保存候选脚本',
    downstream_candidate_committed: '保存下游候选',
    revision: '登记候选结果',
    preview_ready: '等待确认',
  }[stage || ''] || '执行候选任务');
  const pendingIssueKinds = new Set((workspaceStatus?.lifecycle.pendingIssues || []).map((item) => item.kind));
  const blockedExplanation = [...pendingIssueKinds].some((kind) => kind.includes('checkpoint') || kind.includes('runtime'))
    ? '恢复记录不完整、损坏或仍属于另一个运行实例，已停止自动处理。'
    : [...pendingIssueKinds].some((kind) => kind.includes('job') || kind.includes('cohort') || kind.includes('source'))
      ? '候选结果的任务、脚本、参数或完整输出无法相互证明，已停止采用与自动恢复。'
      : '结果文件或版本引用与持久记录不一致，已停止自动处理。';
  const interruptedStageSummary = [...new Set(interruptedRecoveries.map((item) => checkpointStageLabel(item.checkpointStage)))];
  const preservedRevisionCount = interruptedRecoveries.reduce(
    (total, item) => total + (item.preservedRevisionCount || 0),
    0,
  );

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
          <span>{workspaceStatus.lifecycle.status === 'blocked'
            ? '版本存储需要处理'
            : interruptedRecovery
              ? interruptedRecoveries.length === 1
                ? '检测到中断的修改现场'
                : `检测到 ${interruptedRecoveries.length} 个中断的修改现场`
              : activeOperation
                ? activeOperations.length === 1 ? '结果修改正在运行' : `${activeOperations.length} 个结果修改正在运行`
              : pendingDecisionCount > 0
                ? `${pendingDecisionCount} 个候选版本待确认`
                : '版本存储正常'}</span>
          <span>{workspaceStatus.storage.revisionCount} 个版本 · {Math.ceil(workspaceStatus.storage.logicalArtifactBytes / 1024)} KB</span>
          {workspaceStatus.storage.deduplicableBytes > 0 && <span>可去重 {Math.ceil(workspaceStatus.storage.deduplicableBytes / 1024)} KB</span>}
          {workspaceStatus.lifecycle.status === 'blocked' && (
            <>
              <span>{blockedExplanation}</span>
              <span>下一步：保留当前正式版本，检查对应分析任务与项目文件后重新发起修改。</span>
            </>
          )}
          {workspaceStatus.lifecycle.status === 'recovery_available' && interruptedRecovery && (
            <>
              <span>{interruptedRecoveries.length === 1
                ? `停止于${checkpointStageLabel(interruptedRecovery.checkpointStage)} · 已保留 ${interruptedRecovery.preservedRevisionCount || 0} 个候选结果`
                : `停止点：${interruptedStageSummary.join('、')} · 共保留 ${preservedRevisionCount} 个候选结果`}</span>
              <span>系统将核对完整性：完整候选恢复为待确认预览；不完整现场收口为失败且不覆盖当前版本。</span>
              <span>下一步：恢复后检查候选，或重新发起修改。</span>
            </>
          )}
          {workspaceStatus.lifecycle.status !== 'blocked' && activeOperation && (
            <span>当前停留在{checkpointStageLabel(activeOperation.checkpointStage)}；任务结束前不会执行重启恢复。</span>
          )}
          {!interruptedRecovery && pendingDecisionCount > 0 && (
            <span>候选结果已保留；下一步：比较差异后采用或放弃。</span>
          )}
          {workspaceStatus.lifecycle.status === 'recovery_available' && interruptedRecovery && (
            <button type="button" disabled={busy} onClick={() => void recoverWorkspace()}>
              {interruptedRecoveries.length === 1 ? '恢复修改现场' : '恢复全部修改现场'}
            </button>
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
          {executedNodes.length > 0 && (
            <div className={styles.summary} aria-label="实际执行节点">
              <span>实际执行节点 · {executedNodes.length} 个</span>
              {executedNodes.map((nodeId, index) => <span key={`${nodeId}:${index}`}>节点 {index + 1}</span>)}
            </div>
          )}
          {mode === 'compare' && changeSets.length > 1 && (
            <label className={styles.changeSetPicker}>
              <span>审查记录</span>
              <select value={selectedId || ''} onChange={(event) => setSelectedId(event.target.value)}>
                {changeSets.filter((item) => !isBaselineIntentRef(item.intentRef)).map((item) => (
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
            {selected.status === 'adopted' && !isBaselineIntentRef(selected.intentRef) && (
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
          <section className={styles.section} aria-label="本次任务资源摘要">
            <h4>本次任务资源</h4>
            <table className={styles.tableCompare}><tbody>
              <tr><td>分析任务</td><td>{comparison.resourceSummary.jobs.total} 个 · 完成 {comparison.resourceSummary.jobs.completed} · 失败 {comparison.resourceSummary.jobs.failed} · 停止 {comparison.resourceSummary.jobs.cancelled}</td></tr>
              <tr><td>CPU 峰值</td><td>{measuredNumber(comparison.resourceSummary.cpu.peakPercent, (value) => `${value.toFixed(1)}%`)}</td></tr>
              <tr><td>内存峰值</td><td>{measuredNumber(comparison.resourceSummary.memory.processPeakRssBytes, formatBytes)}</td></tr>
              <tr><td>输出峰值</td><td>{measuredNumber(comparison.resourceSummary.disk.outputPeakBytes, formatBytes)}</td></tr>
              <tr><td>并发 Job 峰值</td><td>{measuredNumber(comparison.resourceSummary.jobs.peakConcurrent, (value) => `${value}`)}</td></tr>
              <tr><td>Token / cache / cost</td><td>{comparison.resourceSummary.provider.tokens.status === 'measured'
                ? `Token ${comparison.resourceSummary.provider.tokens.value?.input ?? 0} + ${comparison.resourceSummary.provider.tokens.value?.output ?? 0} · cache ${comparison.resourceSummary.provider.cache.status === 'measured' ? comparison.resourceSummary.provider.cache.value?.read ?? 0 : '不可用'} · cost ${measuredCost(comparison.resourceSummary.provider.cost)}`
                : '未绑定真实 Provider 计量'}</td></tr>
            </tbody></table>
          </section>
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
              {artifact.scientific && (
                <div className={styles.scientificDifference}>
                  <h5>科学结论差异</h5>
                  <ScientificDifference scientific={artifact.scientific} />
                </div>
              )}
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
              <pre className={styles.patch}>{publicDisplayText(comparison.textDiff.patch)}</pre>
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
