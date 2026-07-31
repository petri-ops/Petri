import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultStudioChangeSetPanel } from './ResultStudioChangeSetPanel';
import type { ArtifactRevision, ResultStudioChangeSet, ResultStudioComparison } from './resultStudioClient';

const client = vi.hoisted(() => ({
  listResultChangeSets: vi.fn(),
  compareResultChangeSet: vi.fn(),
  getResultStudioWorkspaceStatus: vi.fn(),
  recoverResultStudioWorkspace: vi.fn(),
  readRevisionTablePage: vi.fn(),
  adoptResultChangeSet: vi.fn(),
  revertResultChangeSet: vi.fn(),
  restoreArtifactRevision: vi.fn(),
  revisionArtifactUrl: vi.fn((id: string) => `/artifact/${id}`),
}));

vi.mock('./resultStudioClient', async () => {
  const actual = await vi.importActual<typeof import('./resultStudioClient')>('./resultStudioClient');
  return { ...actual, ...client };
});

const baseline: ArtifactRevision = {
  revisionId: 'rev_1', projectId: 'p_1', artifactFamilyId: 'family', artifactId: 'plot',
  parentRevisionIds: [], sourceCommit: 'a'.repeat(40), toolJobId: 'tj_1', outputPath: 'results/plot.png',
  outputHash: 'b'.repeat(64), validationStatus: 'valid', reproducibilityStatus: 'available',
  changeSetId: 'cs_1', revisionOrdinal: 1, isCurrent: true, createdAt: '2026-07-25T00:00:00Z',
};

const candidate: ArtifactRevision = {
  ...baseline,
  revisionId: 'rev_2', parentRevisionIds: ['rev_1'], sourceCommit: 'c'.repeat(40), toolJobId: 'tj_2',
  outputPath: 'results/plot-v2.png', outputHash: 'd'.repeat(64), changeSetId: 'cs_2',
  revisionOrdinal: 2, isCurrent: false,
};

const changeSet: ResultStudioChangeSet = {
  changeSetId: 'cs_2', projectId: 'p_1', status: 'preview_ready', candidateCommit: 'c'.repeat(40),
  workingBranchRef: 'refs/heads/biof3/changeset/cs_2', createdBy: 'agent',
  changedPaths: [{ relativePath: 'analysis/scripts/plot.R', changeType: 'added' }],
  validationSummary: { artifactTruthStatus: 'valid', intentSummary: '把火山图配色调整为蓝色', impactLevel: 'presentation_rerender' },
  createdAt: '2026-07-25T00:00:00Z', updatedAt: '2026-07-25T00:01:00Z',
};

const comparison: ResultStudioComparison = {
  changeSet,
  summary: { status: 'preview_ready', createdBy: 'agent', changedFileCount: 1, additions: 4, deletions: 1, candidateRevisionCount: 1, validationStatus: 'valid' },
  textDiff: { patch: '+palette <- "blue"\n-palette <- "red"', truncated: false, additions: 1, deletions: 1 },
  jsonDiffs: [{ relativePath: 'parameters.json', status: 'available', truncated: false, changes: [{ field: 'palette', changeType: 'changed', before: 'red', after: 'blue' }] }],
  artifacts: [{ artifactId: 'plot', artifactFamilyId: 'family', kind: 'visual', beforeRevisionId: 'rev_1', afterRevisionId: 'rev_2', beforeHash: baseline.outputHash || null, afterHash: candidate.outputHash || null, validationStatus: 'valid', table: null }],
  histories: [{ artifactFamilyId: 'family', revisions: [baseline, candidate], currentRevisionId: 'rev_1' }],
  git: { baseCommit: 'a'.repeat(40), candidateCommit: 'c'.repeat(40), workingBranchRef: changeSet.workingBranchRef },
};

describe('ResultStudioChangeSetPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.listResultChangeSets.mockResolvedValue({ changeSets: [changeSet], currentRevision: baseline, revisions: [baseline, candidate] });
    client.compareResultChangeSet.mockResolvedValue(comparison);
    client.getResultStudioWorkspaceStatus.mockResolvedValue({
      lifecycle: { status: 'ready', interrupted: [], checkpoint: null, revisionIntegrity: { revisionCount: 2, intact: true, issues: [] } },
      storage: { revisionCount: 2, logicalArtifactBytes: 2048, uniqueArtifactBytes: 2048, deduplicableBytes: 0, duplicateGroupCount: 0, privateStorage: { bytes: 0, files: 0, truncated: false } },
    });
    client.recoverResultStudioWorkspace.mockResolvedValue({ ok: true, recovered: false, repaired: [], after: { status: 'ready' } });
    client.readRevisionTablePage.mockResolvedValue({ columns: ['gene'], rows: [['TP53']], cursor: 0, nextCursor: null, limit: 50, totalRows: null, totalRowsIsUnknown: true, virtualized: false, caveat: '' });
    client.adoptResultChangeSet.mockResolvedValue({ ok: true, changeSet: { ...changeSet, status: 'adopted' }, currentRevisions: [{ ...candidate, isCurrent: true }] });
    client.revertResultChangeSet.mockResolvedValue({ ok: true, changeSet: { ...changeSet, status: 'reverted' }, restoredRevisionIds: ['rev_1'] });
    client.restoreArtifactRevision.mockResolvedValue({ ok: true, revision: { ...baseline, revisionId: 'rev_3', revisionOrdinal: 3, isCurrent: true }, changeSet: { ...changeSet, changeSetId: 'cs_3', status: 'adopted' } });
  });

  afterEach(cleanup);

  it('keeps the default summary compact and expands typed comparisons on demand', async () => {
    const { rerender } = render(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" activeRevisionId="rev_1" />);
    expect(await screen.findByText('待采用')).toBeTruthy();
    expect(screen.getByText('当前 v1')).toBeTruthy();
    expect(screen.queryByText('高级 Git 信息')).toBeNull();

    expect(screen.getByText('把火山图配色调整为蓝色')).toBeTruthy();
    expect(screen.getByText('展示变化')).toBeTruthy();
    rerender(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" activeRevisionId="rev_1" mode="compare" />);
    expect(await screen.findByText('plot · 前后对比')).toBeTruthy();
    expect(screen.getByText('参数与结构变化')).toBeTruthy();
    expect(screen.getByText('脚本与文本变化')).toBeTruthy();
    expect(screen.getByText('高级 Git 信息')).toBeTruthy();
    expect(screen.getByAltText('plot 修改前').getAttribute('src')).toBe('/artifact/rev_1');
  });

  it('keeps absolute project coordinates out of the ordinary compare DOM', async () => {
    client.compareResultChangeSet.mockResolvedValueOnce({
      ...comparison,
      textDiff: {
        ...comparison.textDiff,
        patch: '+input <- "/Users/private/project/input.csv"\n+windows <- "C:\\\\private\\\\project\\\\input.csv"',
      },
      jsonDiffs: [{
        relativePath: 'parameters.json',
        status: 'available',
        truncated: false,
        changes: [{
          field: 'input',
          changeType: 'changed',
          before: '/Users/private/project/old.csv',
          after: '/Users/private/project/new.csv',
        }],
      }],
    });
    render(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" mode="compare" />);
    expect(await screen.findByText('脚本与文本变化')).toBeTruthy();
    expect(document.body.textContent).not.toContain('/Users/private');
    expect(document.body.textContent).not.toContain('C:\\private');
    expect(document.body.textContent).toContain('[project file]');
  });

  it('adopts only through the client and activates the returned Revision', async () => {
    const activated = vi.fn();
    render(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" onRevisionActivated={activated} />);
    fireEvent.click(await screen.findByText('采用此版本'));
    await waitFor(() => expect(client.adoptResultChangeSet).toHaveBeenCalledWith('cs_2'));
    expect(activated).toHaveBeenCalledWith(expect.objectContaining({ revisionId: 'rev_2', isCurrent: true }));
  });

  it('reverts an adopted non-baseline ChangeSet but never offers baseline undo', async () => {
    const adopted = { ...changeSet, status: 'adopted' };
    client.listResultChangeSets.mockResolvedValueOnce({
      changeSets: [adopted],
      currentRevision: { ...candidate, isCurrent: true },
      revisions: [baseline, { ...candidate, isCurrent: true }],
    });
    const { unmount } = render(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" />);
    fireEvent.click(await screen.findByText('撤销本次采用'));
    await waitFor(() => expect(client.revertResultChangeSet).toHaveBeenCalledWith('cs_2'));
    unmount();

    client.listResultChangeSets.mockResolvedValueOnce({
      changeSets: [{ ...changeSet, changeSetId: 'cs_1', status: 'adopted', intentRef: 'baseline:tj_1:plot' }],
      currentRevision: baseline,
      revisions: [baseline],
    });
    render(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" />);
    expect(await screen.findByText('当前 v1')).toBeTruthy();
    expect(screen.queryByText('撤销本次采用')).toBeNull();
  });

  it('excludes a legacy baseline cohort when choosing the preferred ChangeSet', async () => {
    const legacyBaseline = {
      ...changeSet,
      changeSetId: 'cs_legacy_baseline',
      status: 'adopted' as const,
      intentRef: 'baseline-cohort:tj_legacy',
      validationSummary: { artifactTruthStatus: 'valid', intentSummary: '旧版基线 cohort' },
    };
    const adoptedCandidate = { ...changeSet, status: 'adopted' as const };
    client.listResultChangeSets.mockResolvedValueOnce({
      changeSets: [legacyBaseline, adoptedCandidate],
      currentRevision: { ...candidate, isCurrent: true },
      revisions: [baseline, { ...candidate, isCurrent: true }],
    });
    render(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" />);
    expect(await screen.findByText('把火山图配色调整为蓝色')).toBeTruthy();
    expect(screen.queryByText('旧版基线 cohort')).toBeNull();
    expect(screen.getByText('撤销本次采用')).toBeTruthy();
  });

  it('restores a historical Revision as a new version instead of mutating history', async () => {
    render(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" mode="history" />);
    const restoreButtons = await screen.findAllByText('恢复为新版本');
    fireEvent.click(restoreButtons[0]);
    await waitFor(() => expect(client.restoreArtifactRevision).toHaveBeenCalledWith('rev_2'));
  });

  it('shows durable storage status without expanding technical detail', async () => {
    render(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" />);
    expect(await screen.findByText('版本存储正常')).toBeTruthy();
    expect(screen.getByText('2 个版本 · 2 KB')).toBeTruthy();
  });

  it('loads table candidates progressively instead of rendering the whole file', async () => {
    const tableComparison = { ...comparison, artifacts: [{ ...comparison.artifacts[0], kind: 'table' as const, table: { status: 'available', before: { columns: ['gene'], rowCount: 1, rowCountIsLowerBound: false, bytes: 10 }, after: { columns: ['gene'], rowCount: 1, rowCountIsLowerBound: false, bytes: 10 }, addedColumns: [], removedColumns: [], sampleChanges: [], truncated: true } }] };
    client.compareResultChangeSet.mockResolvedValueOnce(tableComparison);
    render(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" mode="compare" />);
    fireEvent.click(await screen.findByText('渐进查看候选表'));
    expect(await screen.findByText('TP53')).toBeTruthy();
    expect(client.readRevisionTablePage).toHaveBeenCalledWith('rev_2', 0, 50);
  });

  it('shows declared scientific conclusion differences without inferring missing direction', async () => {
    const scientificTable = {
      ...comparison,
      artifacts: [{
        ...comparison.artifacts[0], artifactId: 'go_bp_results', kind: 'table' as const,
        table: { status: 'available', before: { columns: ['ID'], rowCount: 2, rowCountIsLowerBound: false, bytes: 10 }, after: { columns: ['ID'], rowCount: 2, rowCountIsLowerBound: false, bytes: 10 }, addedColumns: [], removedColumns: [], sampleChanges: [], truncated: false },
        scientific: {
          status: 'available' as const, kind: 'functional_enrichment',
          terms: { beforeCount: 2, afterCount: 2, membership: { gainedCount: 1, lostCount: 1, retainedCount: 1, gained: ['GO:3'], lost: ['GO:2'] }, topBefore: [{ rank: 1, id: 'GO:1', adjustedPValue: 0.001 }], topAfter: [{ rank: 1, id: 'GO:3', adjustedPValue: 0.0001 }] },
          direction: { status: 'unavailable' as const, reason: 'enrichment_table_has_no_declared_direction_column' },
        },
      }],
    };
    client.compareResultChangeSet.mockResolvedValueOnce(scientificTable);
    render(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" mode="compare" />);
    expect(await screen.findByText('科学结论差异')).toBeTruthy();
    expect(screen.getByText('当前结果表未声明方向，未作推断')).toBeTruthy();
    expect(screen.getByText('GO:1 → GO:3')).toBeTruthy();
  });

  it('shows exact enrichment direction changes and before-after details', async () => {
    const scientificTable = {
      ...comparison,
      artifacts: [{
        ...comparison.artifacts[0], artifactId: 'go_bp_results', kind: 'table' as const,
        table: { status: 'available', before: { columns: ['ID'], rowCount: 2, rowCountIsLowerBound: false, bytes: 10 }, after: { columns: ['ID'], rowCount: 2, rowCountIsLowerBound: false, bytes: 10 }, addedColumns: [], removedColumns: [], sampleChanges: [], truncated: false },
        scientific: {
          status: 'available' as const, kind: 'functional_enrichment',
          terms: { beforeCount: 2, afterCount: 2, membership: { gainedCount: 1, lostCount: 1, retainedCount: 1, gained: ['GO:3'], lost: ['GO:2'] }, topBefore: [{ rank: 1, id: 'GO:1', adjustedPValue: 0.001 }], topAfter: [{ rank: 1, id: 'GO:3', adjustedPValue: 0.0001 }] },
          direction: {
            status: 'available' as const,
            before: [{ id: 'GO:1', direction: 'up' }, { id: 'GO:2', direction: 'mixed' }],
            after: [{ id: 'GO:1', direction: 'down' }, { id: 'GO:3', direction: 'up' }],
            changedCount: 1,
            changes: [{ id: 'GO:1', before: 'up', after: 'down' }],
          },
        },
      }],
    };
    client.compareResultChangeSet.mockResolvedValueOnce(scientificTable);
    render(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" mode="compare" />);
    expect(await screen.findByText('1 条；GO:1 up → down')).toBeTruthy();
    expect(screen.getByText('GO:1 up、GO:2 mixed → GO:1 down、GO:3 up')).toBeTruthy();
    expect(screen.queryByText('已由结果表声明')).toBeNull();
  });

  it('shows exact executed workflow node IDs instead of only a count', async () => {
    client.listResultChangeSets.mockResolvedValueOnce({
      changeSets: [{
        ...changeSet,
        validationSummary: {
          ...changeSet.validationSummary,
          affectedScope: 'workflow_subgraph',
          affectedNodeCount: 2,
          executedNodeIds: ['job:tj_deg_candidate', 'job:tj_go_candidate'],
        },
      }],
      currentRevision: baseline,
      revisions: [baseline, candidate],
    });
    render(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" />);
    expect(await screen.findByLabelText('实际执行节点')).toBeTruthy();
    expect(screen.getByText('实际执行节点 · 2 个')).toBeTruthy();
    expect(screen.getByText('节点 1')).toBeTruthy();
    expect(screen.getByText('节点 2')).toBeTruthy();
    expect(screen.queryByText('job:tj_deg_candidate')).toBeNull();
    expect(screen.queryByText('job:tj_go_candidate')).toBeNull();
    expect(screen.getByText('影响下游流程 · 2 个节点')).toBeTruthy();
  });

  it('views a historical Revision without invoking any write client', async () => {
    const viewed = vi.fn();
    render(<ResultStudioChangeSetPanel
      projectId="p_1"
      artifactFamilyId="family"
      activeRevisionId="rev_1"
      mode="history"
      onRevisionViewed={viewed}
    />);
    fireEvent.click((await screen.findAllByText('查看'))[0]);
    expect(viewed).toHaveBeenCalledWith(expect.objectContaining({ revisionId: 'rev_2' }));
    expect(client.adoptResultChangeSet).not.toHaveBeenCalled();
    expect(client.revertResultChangeSet).not.toHaveBeenCalled();
    expect(client.restoreArtifactRevision).not.toHaveBeenCalled();
    expect(client.recoverResultStudioWorkspace).not.toHaveBeenCalled();
  });

  it('requires an explicit action before recovering interrupted state', async () => {
    client.getResultStudioWorkspaceStatus.mockResolvedValue({
      lifecycle: { status: 'recovery_available', interrupted: [{ changeSetId: 'cs_2', status: 'running', recovery: 'resume', revisionIds: [] }], checkpoint: null, revisionIntegrity: { revisionCount: 2, intact: true, issues: [] } },
      storage: { revisionCount: 2, logicalArtifactBytes: 2048, uniqueArtifactBytes: 2048, deduplicableBytes: 0, duplicateGroupCount: 0, privateStorage: { bytes: 0, files: 0, truncated: false } },
    });
    render(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" mode="history" />);
    expect(await screen.findByText('检测到未完成的修改现场')).toBeTruthy();
    expect(client.recoverResultStudioWorkspace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('恢复修改现场'));
    await waitFor(() => expect(client.recoverResultStudioWorkspace).toHaveBeenCalledWith('p_1'));
  });

  it('keeps compare failure actionable without entering an automatic retry loop', async () => {
    client.compareResultChangeSet
      .mockRejectedValueOnce(new Error('比较服务暂不可用'))
      .mockResolvedValueOnce(comparison);
    render(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" mode="compare" />);
    expect(await screen.findByText('比较服务暂不可用')).toBeTruthy();
    expect(client.compareResultChangeSet).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('重试比较'));
    expect(await screen.findByText('plot · 前后对比')).toBeTruthy();
    expect(client.compareResultChangeSet).toHaveBeenCalledTimes(2);
  });

  it('keeps a version-list failure actionable with an explicit retry', async () => {
    client.listResultChangeSets
      .mockRejectedValueOnce(new Error('版本服务暂不可用'))
      .mockResolvedValueOnce({ changeSets: [changeSet], currentRevision: baseline, revisions: [baseline, candidate] });
    render(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" />);
    expect(await screen.findByText('版本服务暂不可用')).toBeTruthy();
    expect(client.listResultChangeSets).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('重试版本'));
    expect(await screen.findByText('当前 v1')).toBeTruthy();
    expect(client.listResultChangeSets).toHaveBeenCalledTimes(2);
  });

  it('keeps workspace inspection failure separate and retryable', async () => {
    client.getResultStudioWorkspaceStatus
      .mockRejectedValueOnce(new Error('storage offline'))
      .mockResolvedValueOnce({
        lifecycle: { status: 'ready', interrupted: [], checkpoint: null, revisionIntegrity: { revisionCount: 2, intact: true, issues: [] } },
        storage: { revisionCount: 2, logicalArtifactBytes: 2048, uniqueArtifactBytes: 2048, deduplicableBytes: 0, duplicateGroupCount: 0, privateStorage: { bytes: 0, files: 0, truncated: false } },
      });
    render(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" />);
    expect(await screen.findByText('版本存储状态暂不可用；结果与版本列表仍可查看。')).toBeTruthy();
    fireEvent.click(screen.getByText('重试存储状态'));
    expect(await screen.findByText('版本存储正常')).toBeTruthy();
    expect(client.getResultStudioWorkspaceStatus).toHaveBeenCalledTimes(2);
  });
});
