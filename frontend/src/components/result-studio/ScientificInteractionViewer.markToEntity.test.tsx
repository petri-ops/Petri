import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactInteractionManifest } from '@/lib/artifact-selection';
import { getSelectionBusState, setSelectionBusArtifact, setSelectionBusSelection } from '@/lib/selectionBus';
import { ScientificInteractionViewer } from './ScientificInteractionViewer';
import type { ResultTableQuery } from '@/lib/result-studio-interaction-client';

// ============================================================================
// 红侧契约测试 — BLOCK-139 P1 mark-to-entity：viewer 总线出口带 entityType+idField
// （plan §2 P1 / g0-result-studio-plan §22.2 #2）
//
// 被钉契约（组件级）：
//   1. 总线模式（未提供 onSelectionChange）下，表格行选中把选择写进总线，
//      且总线状态携带 manifest 的 idField 与选择的 entityType（行 mark-to-entity）。
//   2. 图上点选同样：总线状态携带 idField/entityType，origin=point_select（图形 mark-to-entity）。
//   3. 回调模式（既有 prop 面）不写总线——总线出口与回调出口互斥，零回归护栏。
// ============================================================================

const queryResultStudioTable = vi.fn<(...args: unknown[]) => unknown>();
vi.mock('@/lib/result-studio-interaction-client', () => ({
  queryResultStudioTable: (...args: unknown[]) => queryResultStudioTable(...args),
}));

afterEach(() => {
  cleanup();
  queryResultStudioTable.mockReset();
  setSelectionBusArtifact({ artifactId: '', revisionId: null });
  setSelectionBusSelection(null);
});

function tableManifest(): ArtifactInteractionManifest {
  return {
    interactionVersion: 1,
    artifactId: 'deg_table',
    revisionId: 'rev_1',
    artifactKind: 'table',
    entityType: 'gene',
    idField: 'gene',
    idStrategy: 'declared_column',
    selectionDurable: true,
    columns: [{ field: 'gene' }, { field: 'padj' }],
    totalRowCount: 100,
    capabilities: ['row_select'],
    interactionMode: 'table',
    mapping: { artifactId: 'deg_table', mode: 'table', entityType: 'gene', idField: 'gene' },
  };
}

function scatterManifest(): ArtifactInteractionManifest {
  return {
    ...tableManifest(),
    artifactId: 'volcano',
    artifactKind: 'plot',
    capabilities: ['point_select'],
    interactionMode: 'scatter',
    mapping: {
      artifactId: 'volcano', mode: 'scatter', entityType: 'gene', idField: 'gene',
      xField: 'log2FoldChange', yField: 'pvalue',
    },
  };
}

function tableQuery(): ResultTableQuery {
  return {
    tableQueryVersion: 1,
    columns: [
      { field: 'gene', type: 'string', sortable: true, filterable: true },
      { field: 'padj', type: 'number', sortable: true, filterable: true },
    ],
    rows: Array.from({ length: 20 }, (_, index) => ({ gene: `G${index}`, padj: String(index / 1000) })),
    totalRows: 20,
    matchedCount: 20,
    offset: 0,
    nextOffset: 20,
    limit: 200,
    virtualized: true,
    filterExpression: { logic: 'and', clauses: [] },
    sort: [],
    filterHash: 'a'.repeat(64),
    selectionEvidence: {
      idField: 'gene', entityIdsHash: 'b'.repeat(64), sampleEntityIds: ['G0'], entityIdCount: 20,
    },
  };
}

function scatterQuery(): ResultTableQuery {
  return {
    ...tableQuery(),
    rows: [
      { gene: 'TP53', log2FoldChange: '2', pvalue: '0.001' },
      { gene: 'EGFR', log2FoldChange: '-1', pvalue: '0.05' },
    ],
    columns: [
      { field: 'gene', type: 'string', sortable: true, filterable: true },
      { field: 'log2FoldChange', type: 'number', sortable: true, filterable: true },
      { field: 'pvalue', type: 'number', sortable: true, filterable: true },
    ],
  };
}

describe('BLOCK-139 P1 viewer 总线出口 mark-to-entity（entityType+idField）', () => {
  it('总线模式行选中：总线携带 manifest.idField 与选择 entityType', async () => {
    queryResultStudioTable.mockResolvedValue(tableQuery());
    render(
      <ScientificInteractionViewer
        language="r"
        jobId="job_1"
        artifactName="deg_table.csv"
        manifest={tableManifest()}
      />,
    );
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 G0' }));

    const state = getSelectionBusState();
    expect(state.selection).not.toBeNull();
    expect(state.selection!.artifactId).toBe('deg_table');
    expect(state.selection!.entityType).toBe('gene');
    expect(state.selection!.origin).toBe('row_select');
    expect(state.selection!.entityIds).toContain('G0');
    expect(state.idField).toBe('gene');
  });

  it('总线模式图上点选：总线携带 idField/entityType，origin=point_select', () => {
    render(
      <ScientificInteractionViewer
        language="r"
        jobId="job_1"
        artifactName="volcano.png"
        manifest={scatterManifest()}
        backingTable={scatterQuery()}
      />,
    );
    fireEvent.click(document.querySelector('circle') as SVGCircleElement);

    const state = getSelectionBusState();
    expect(state.selection).not.toBeNull();
    expect(state.selection!.artifactId).toBe('volcano');
    expect(state.selection!.entityType).toBe('gene');
    expect(state.selection!.origin).toBe('point_select');
    expect(state.selection!.entityIds).toEqual(['TP53']);
    expect(state.idField).toBe('gene');
  });

  it('回调模式不写总线：既有 prop 面与总线出口互斥（零回归护栏）', async () => {
    queryResultStudioTable.mockResolvedValue(tableQuery());
    const onSelectionChange = vi.fn();
    render(
      <ScientificInteractionViewer
        language="r"
        jobId="job_1"
        artifactName="deg_table.csv"
        manifest={tableManifest()}
        selection={null}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 G0' }));
    await Promise.resolve();

    expect(onSelectionChange).toHaveBeenCalled();
    const state = getSelectionBusState();
    expect(state.selection).toBeNull();
    expect(state.idField).toBeNull();
  });

  it('总线读回显不因 idField 引入回归：清除后回显同步消失', async () => {
    queryResultStudioTable.mockResolvedValue(tableQuery());
    setSelectionBusArtifact({ artifactId: 'deg_table', revisionId: 'rev_1' });
    setSelectionBusSelection(
      (await import('@/lib/artifact-selection')).buildRowSelection(tableManifest(), [{ gene: 'G1', padj: '0.001' }]).selection,
      { idField: 'gene' },
    );
    render(
      <ScientificInteractionViewer
        language="r"
        jobId="job_1"
        artifactName="deg_table.csv"
        manifest={tableManifest()}
      />,
    );
    expect(await screen.findByRole('checkbox', { name: '选择 G1' })).toHaveProperty('checked', true);

    act(() => {
      setSelectionBusSelection(null);
    });
    expect(screen.getByRole('checkbox', { name: '选择 G1' })).toHaveProperty('checked', false);
  });
});
