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
    render(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" activeRevisionId="rev_1" />);
    expect(await screen.findByText('待采用')).toBeTruthy();
    expect(screen.getByText('当前 v1')).toBeTruthy();
    expect(screen.queryByText('高级 Git 信息')).toBeNull();

    fireEvent.click(screen.getByText('比较结果'));
    expect(await screen.findByText('plot · 前后对比')).toBeTruthy();
    expect(screen.getByText('参数与结构变化')).toBeTruthy();
    expect(screen.getByText('脚本与文本变化')).toBeTruthy();
    expect(screen.getByText('高级 Git 信息')).toBeTruthy();
    expect(screen.getByAltText('plot 修改前').getAttribute('src')).toBe('/artifact/rev_1');
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

  it('restores a historical Revision as a new version instead of mutating history', async () => {
    render(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" />);
    fireEvent.click(await screen.findByText('比较结果'));
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
    render(<ResultStudioChangeSetPanel projectId="p_1" artifactFamilyId="family" />);
    fireEvent.click(await screen.findByText('比较结果'));
    fireEvent.click(await screen.findByText('渐进查看候选表'));
    expect(await screen.findByText('TP53')).toBeTruthy();
    expect(client.readRevisionTablePage).toHaveBeenCalledWith('rev_2', 0, 50);
  });
});
