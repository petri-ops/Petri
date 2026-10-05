import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactInteractionManifest, ArtifactSelection } from '@/lib/artifact-selection';
import type { ResultTableQuery } from '@/lib/result-studio-interaction-client';
import { ScientificInteractionViewer } from './ScientificInteractionViewer';

// ============================================================================
// 红侧契约测试 — BLOCK-141 R-6 matrix 行选 idField 回退链加固（plan §1.3）
//
// 被钉裁决（此刻尚无实现，测试必须真实失败）：
// - rowField 回退链 = mapping.rowIdField → manifest.idField → query.columns[0]
//   （ScientificInteractionViewer.tsx ScientificMatrix）。前两级是后端**声明的
//   稳定实体 ID 列**，可如实作为行选 idField；回退到 columns[0] 只是"第一列
//   数据"——现状把它的单元格值写进 rowManifest.idField（且 rowManifest 还强制
//   selectionDurable=true），fabricated entityIds（如数值 '1.2'）会冒充稳定
//   实体 ID 经选择总线 / D2 注入流到 Agent 上下文 = 虚构 idField 语义。
// - 加固取向（plan §1.3 二选一之**拒绝注入**）：回退链前两级在场时行选照常
//   （不回退既有声明列契约）；两级都缺失时行选**不得产出非 null 的 row_select
//   选择**——实现可禁用行按钮或点击产出 null，但 fabricated 选择不得离场。
//   列选择不受影响（列本身即稳定标识）。
// ============================================================================

const queryResultStudioTable = vi.fn<(...args: unknown[]) => unknown>();
vi.mock('@/lib/result-studio-interaction-client', () => ({
  queryResultStudioTable: (...args: unknown[]) => queryResultStudioTable(...args),
}));

afterEach(() => {
  cleanup();
  queryResultStudioTable.mockReset();
});

function matrixManifest(patch: { rowIdField?: string; idField?: string | null } = {}): ArtifactInteractionManifest {
  const declared = !!patch.rowIdField || !!patch.idField;
  return {
    interactionVersion: 1,
    artifactId: 'heatmap',
    revisionId: 'rev_1',
    artifactKind: 'plot',
    entityType: 'gene',
    idField: patch.idField ?? null,
    // 无声明 ID 列时后端口径即 positional（readEntityId 契约：idField 空 → 返回
    // null，调用方必须把选择标成 not durable，而不是退回行号/任意列伪装成 ID）。
    idStrategy: declared ? 'declared_column' : 'positional',
    selectionDurable: declared,
    columns: [{ field: 'sample_a' }, { field: 'sample_b' }],
    totalRowCount: 2,
    capabilities: ['row_select', 'column_select'],
    interactionMode: 'matrix',
    mapping: {
      artifactId: 'heatmap',
      mode: 'matrix',
      entityType: 'gene',
      ...(patch.rowIdField ? { rowIdField: patch.rowIdField } : {}),
      rowEntityType: 'gene',
      columnEntityType: 'sample',
      dataArtifactId: 'vst_matrix',
    },
  };
}

function matrixQuery(withGeneColumn: boolean): ResultTableQuery {
  const columns: ResultTableQuery['columns'] = withGeneColumn
    ? [
        { field: 'gene', type: 'string', sortable: true, filterable: true },
        { field: 'sample_a', type: 'number', sortable: true, filterable: true },
        { field: 'sample_b', type: 'number', sortable: true, filterable: true },
      ]
    : [
        { field: 'sample_a', type: 'number', sortable: true, filterable: true },
        { field: 'sample_b', type: 'number', sortable: true, filterable: true },
      ];
  const rows: Array<Record<string, string>> = withGeneColumn
    ? [
        { gene: 'TP53', sample_a: '1.2', sample_b: '-0.4' },
        { gene: 'EGFR', sample_a: '0.2', sample_b: '2.1' },
      ]
    : [
        { sample_a: '1.2', sample_b: '-0.4' },
        { sample_a: '0.2', sample_b: '2.1' },
      ];
  return {
    tableQueryVersion: 1,
    columns,
    rows,
    totalRows: 2,
    matchedCount: 2,
    offset: 0,
    nextOffset: null,
    limit: 200,
    virtualized: false,
    filterExpression: { logic: 'and', clauses: [] },
    sort: [],
    filterHash: 'a'.repeat(64),
    selectionEvidence: {
      idField: withGeneColumn ? 'gene' : null,
      entityIdsHash: withGeneColumn ? 'b'.repeat(64) : null,
      sampleEntityIds: withGeneColumn ? ['TP53', 'EGFR'] : [],
      entityIdCount: withGeneColumn ? 2 : 0,
    },
  };
}

function renderMatrix(
  manifest: ArtifactInteractionManifest,
  query: ResultTableQuery,
  onSelectionChange: (selection: ArtifactSelection | null) => void,
): void {
  render(
    <ScientificInteractionViewer
      language="r"
      jobId="job_1"
      artifactName="heatmap.png"
      manifest={manifest}
      backingTable={query}
      selection={null}
      onSelectionChange={onSelectionChange}
    />,
  );
}

describe('BLOCK-141 R-6 matrix 行选 idField 回退链（不虚构 idField 语义）', () => {
  it('回退链第一级：mapping.rowIdField 在场 → 行选 entityIds 来自 rowIdField 列', () => {
    const onSelectionChange = vi.fn<(selection: ArtifactSelection | null) => void>();
    renderMatrix(matrixManifest({ rowIdField: 'gene' }), matrixQuery(true), onSelectionChange);
    fireEvent.click(screen.getByRole('button', { name: 'TP53' }));
    const selection = onSelectionChange.mock.calls[0][0]!;
    expect(selection.origin).toBe('row_select');
    expect(selection.entityIds).toEqual(['TP53']);
    expect(selection.entityType).toBe('gene');
  });

  it('回退链第二级：mapping.rowIdField 缺省、manifest.idField 在场 → 行选 entityIds 来自 manifest.idField 列', () => {
    const onSelectionChange = vi.fn<(selection: ArtifactSelection | null) => void>();
    renderMatrix(matrixManifest({ idField: 'gene' }), matrixQuery(true), onSelectionChange);
    fireEvent.click(screen.getByRole('button', { name: 'TP53' }));
    const selection = onSelectionChange.mock.calls[0][0]!;
    expect(selection.origin).toBe('row_select');
    expect(selection.entityIds).toEqual(['TP53']);
  });

  it('回退链末级（columns[0]）不得虚构 idField：两级声明列都缺失时行选不得产出非 null 选择（拒绝注入）', () => {
    const onSelectionChange = vi.fn<(selection: ArtifactSelection | null) => void>();
    renderMatrix(matrixManifest(), matrixQuery(false), onSelectionChange);
    // 现状缺陷锚点：rowField 回退到 columns[0]（sample_a），行按钮以**数值单元格
    // 值 '1.2'** 为标签；点击产出 entityIds=['1.2']、durable=true 的"稳定基因
    // ID"选择。契约只钉可观察出口（fabricated 选择不得离场），不钉 UI 形状
    // （禁用按钮 / 产 null / 移除按钮均可）。
    const rowButton = screen.getAllByText('1.2')
      .map((element) => element.closest('button'))
      .find((button): button is HTMLButtonElement => !!button);
    if (rowButton) fireEvent.click(rowButton);
    const nonNullEmits = onSelectionChange.mock.calls.filter((call) => call[0] !== null);
    expect(nonNullEmits).toEqual([]);

    // 拒绝注入不殃及列选：列本身即稳定标识（取 sample_b——不受 rowField 取舍
    // 摆布的列，两种加固形状下都在 columnManifest.columns 里）。
    fireEvent.click(screen.getByTitle('选择 sample_b'));
    const columnSelection = onSelectionChange.mock.calls.at(-1)![0]!;
    expect(columnSelection.origin).toBe('column_select');
    expect(columnSelection.entityType).toBe('sample');
    expect(columnSelection.fields).toEqual(['sample_b']);
  });
});
