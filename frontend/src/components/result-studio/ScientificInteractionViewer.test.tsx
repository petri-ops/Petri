import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactInteractionManifest, ArtifactSelection } from '@/lib/artifact-selection';
import type { ResultTableQuery } from '@/lib/result-studio-interaction-client';
import { ScientificInteractionViewer } from './ScientificInteractionViewer';

const queryResultStudioTable = vi.fn();
vi.mock('@/lib/result-studio-interaction-client', () => ({
  queryResultStudioTable: (...args: unknown[]) => queryResultStudioTable(...args),
}));
afterEach(() => { cleanup(); queryResultStudioTable.mockReset(); });

function tableQuery(rows = 200): ResultTableQuery {
  return {
    tableQueryVersion: 1,
    columns: [
      { field: 'gene', type: 'string', sortable: true, filterable: true },
      { field: 'padj', type: 'number', sortable: true, filterable: true },
    ],
    rows: Array.from({ length: rows }, (_, index) => ({ gene: `G${index}`, padj: String(index / 1000) })),
    totalRows: 100_000,
    matchedCount: 100_000,
    offset: 0,
    nextOffset: 200,
    limit: 200,
    virtualized: true,
    filterExpression: { logic: 'and', clauses: [] },
    sort: [],
    filterHash: 'a'.repeat(64),
    selectionEvidence: {
      idField: 'gene', entityIdsHash: 'b'.repeat(64), sampleEntityIds: ['G0', 'G1'], entityIdCount: 100_000,
    },
  };
}

function manifest(mode: 'table' | 'scatter'): ArtifactInteractionManifest {
  return {
    interactionVersion: 1,
    artifactId: mode === 'table' ? 'deg_table' : 'volcano',
    revisionId: 'rev_1', artifactKind: mode === 'table' ? 'table' : 'plot',
    entityType: 'gene', idField: 'gene', idStrategy: 'declared_column', selectionDurable: true,
    columns: [{ field: 'gene' }, { field: 'padj' }], totalRowCount: 100_000,
    capabilities: mode === 'table' ? ['row_select', 'column_select', 'filter', 'sort'] : ['point_select', 'region_select'],
    interactionMode: mode,
    mapping: mode === 'table'
      ? { artifactId: 'deg_table', mode: 'table', entityType: 'gene', idField: 'gene' }
      : { artifactId: 'volcano', mode: 'scatter', entityType: 'gene', idField: 'gene', xField: 'log2FoldChange', yField: 'pvalue', yTransform: 'neg_log10' },
  };
}

function matrixManifest(): ArtifactInteractionManifest {
  return {
    interactionVersion: 1,
    artifactId: 'heatmap',
    revisionId: 'rev_1',
    artifactKind: 'plot',
    entityType: 'gene',
    idField: 'gene',
    idStrategy: 'declared_column',
    selectionDurable: true,
    columns: [{ field: 'gene' }, { field: 'sample_a' }, { field: 'sample_b' }],
    totalRowCount: 2,
    capabilities: ['row_select', 'column_select'],
    interactionMode: 'matrix',
    mapping: {
      artifactId: 'heatmap', mode: 'matrix', entityType: 'gene', rowIdField: 'gene',
      rowEntityType: 'gene', columnEntityType: 'sample', dataArtifactId: 'vst_matrix',
    },
  };
}

describe('ScientificInteractionViewer', () => {
  it('renders only viewport rows for a 100k authoritative table', async () => {
    queryResultStudioTable.mockResolvedValue(tableQuery());
    render(<ScientificInteractionViewer language="r" jobId="job_1" artifactName="deg_table.csv" manifest={manifest('table')} selection={null} onSelectionChange={() => {}} />);
    await waitFor(() => expect(screen.getByText('100,000 / 100,000 行')).toBeTruthy());
    expect(screen.getAllByRole('checkbox').filter((item) => item.getAttribute('aria-label')?.startsWith('选择 G'))).toHaveLength(18);
    expect(screen.queryByText('G199')).toBeNull();
  });

  it('renders the correct bounded window while scrolling inside one query page', async () => {
    queryResultStudioTable.mockResolvedValue(tableQuery());
    render(<ScientificInteractionViewer language="r" jobId="job_1" artifactName="deg_table.csv" manifest={manifest('table')} selection={null} onSelectionChange={() => {}} />);
    const viewport = await screen.findByRole('generic', { name: '科学结果表格' });
    Object.defineProperty(viewport, 'scrollTop', { value: 100 * 32, writable: true });
    fireEvent.scroll(viewport);
    expect(await screen.findByText('G100')).toBeTruthy();
    expect(screen.queryByText('G0')).toBeNull();
    expect(screen.getAllByRole('checkbox').filter((item) => item.getAttribute('aria-label')?.startsWith('选择 G'))).toHaveLength(18);
  });

  it('loads the next authoritative page at a virtual-scroll boundary', async () => {
    queryResultStudioTable.mockImplementation(async (input: { offset?: number }) => {
      const pageOffset = input.offset || 0;
      return {
        ...tableQuery(),
        offset: pageOffset,
        nextOffset: pageOffset + 200,
        rows: Array.from({ length: 200 }, (_, index) => ({
          gene: `G${pageOffset + index}`,
          padj: String((pageOffset + index) / 1000),
        })),
      };
    });
    render(<ScientificInteractionViewer language="r" jobId="job_1" artifactName="deg_table.csv" manifest={manifest('table')} selection={null} onSelectionChange={() => {}} />);
    const viewport = await screen.findByRole('generic', { name: '科学结果表格' });
    Object.defineProperty(viewport, 'scrollTop', { value: 220 * 32, writable: true });
    fireEvent.scroll(viewport);
    expect(await screen.findByText('G220')).toBeTruthy();
    expect(screen.queryByText('G20')).toBeNull();
  });

  it('select-all uses authoritative count and hashes instead of enumerating browser rows', async () => {
    queryResultStudioTable.mockResolvedValue(tableQuery());
    const onSelectionChange = vi.fn();
    render(<ScientificInteractionViewer language="r" jobId="job_1" artifactName="deg_table.csv" manifest={manifest('table')} selection={null} onSelectionChange={onSelectionChange} />);
    const button = await screen.findByRole('button', { name: '选择全部筛选结果' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    const selection = onSelectionChange.mock.calls[0][0];
    expect(selection.entityIdCount).toBe(100_000);
    expect(selection.entityIds).toEqual(['G0', 'G1']);
    expect(selection.durable).toBe(true);
  });

  it('hydrates row checkboxes from a restored durable selection', async () => {
    queryResultStudioTable.mockResolvedValue(tableQuery());
    const onSelectionChange = vi.fn();
    const restored: ArtifactSelection = {
      contractVersion: 1,
      artifactId: 'deg_table',
      revisionId: 'rev_1',
      entityType: 'gene',
      origin: 'row_select',
      entityIds: ['G0'],
      entityIdCount: 1,
      entityIdsTruncated: false,
      entityIdsHash: 'restored-hash',
      fields: [],
      filterExpression: null,
      sort: [],
      region: null,
      durable: true,
      createdAt: '2026-07-25T00:00:00.000Z',
      selectionId: 'sel_restored',
      compatibility: 'compatible',
    };
    render(<ScientificInteractionViewer language="r" jobId="job_1" artifactName="deg_table.csv" manifest={manifest('table')} selection={restored} onSelectionChange={onSelectionChange} />);
    const first = await screen.findByRole('checkbox', { name: '选择 G0' });
    expect((first as HTMLInputElement).checked).toBe(true);
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 G1' }));
    expect(onSelectionChange.mock.calls[0][0].entityIds).toEqual(['G0', 'G1']);
  });

  it('selects stable table columns without confusing them with row entities', async () => {
    queryResultStudioTable.mockResolvedValue(tableQuery());
    const onSelectionChange = vi.fn();
    render(<ScientificInteractionViewer language="r" jobId="job_1" artifactName="deg_table.csv" manifest={manifest('table')} selection={null} onSelectionChange={onSelectionChange} />);
    const padj = await screen.findByRole('checkbox', { name: '选择列 padj' });
    fireEvent.click(padj);
    const selection = onSelectionChange.mock.calls[0][0];
    expect(selection.origin).toBe('column_select');
    expect(selection.fields).toEqual(['padj']);
    expect(selection.entityIds).toEqual([]);
    expect(selection.durable).toBe(true);
  });

  it('maps a scatter point click back to its stable gene id', () => {
    const onSelectionChange = vi.fn();
    const query = {
      ...tableQuery(0),
      rows: [
        { gene: 'TP53', log2FoldChange: '2', pvalue: '0.001' },
        { gene: 'EGFR', log2FoldChange: '-1', pvalue: '0.05' },
      ],
      columns: [
        { field: 'gene', type: 'string', sortable: true, filterable: true },
        { field: 'log2FoldChange', type: 'number', sortable: true, filterable: true },
        { field: 'pvalue', type: 'number', sortable: true, filterable: true },
      ],
    } satisfies ResultTableQuery;
    const { container } = render(<ScientificInteractionViewer language="r" jobId="job_1" artifactName="volcano.png" manifest={manifest('scatter')} backingTable={query} selection={null} onSelectionChange={onSelectionChange} />);
    fireEvent.click(container.querySelector('circle') as SVGCircleElement);
    expect(onSelectionChange.mock.calls[0][0].entityIds).toEqual(['TP53']);
  });

  it('lets keyboard users focus and select a scatter point', () => {
    const onSelectionChange = vi.fn();
    const query: ResultTableQuery = {
      ...tableQuery(0),
      rows: [{ gene: 'TP53', log2FoldChange: '2', pvalue: '0.001' }],
      columns: [
        { field: 'gene', type: 'string', sortable: true, filterable: true },
        { field: 'log2FoldChange', type: 'number', sortable: true, filterable: true },
        { field: 'pvalue', type: 'number', sortable: true, filterable: true },
      ],
    };
    render(<ScientificInteractionViewer language="r" jobId="job_1" artifactName="volcano.png" manifest={manifest('scatter')} backingTable={query} selection={null} onSelectionChange={onSelectionChange} />);
    const point = screen.getByRole('button', { name: '选择 TP53' });
    point.focus();
    expect(document.activeElement).toBe(point);
    fireEvent.keyDown(point, { key: 'Enter' });
    expect(onSelectionChange.mock.calls[0][0].entityIds).toEqual(['TP53']);
  });

  it('maps a scatter legend and dragged region to stable entity ids', () => {
    const onSelectionChange = vi.fn();
    const scatterManifest = {
      ...manifest('scatter'),
      mapping: { ...manifest('scatter').mapping!, legendField: 'direction' },
      capabilities: ['point_select', 'region_select', 'legend_select'] as ArtifactInteractionManifest['capabilities'],
    };
    const query = {
      ...tableQuery(0),
      rows: [
        { gene: 'TP53', log2FoldChange: '2', pvalue: '0.001', direction: 'up' },
        { gene: 'EGFR', log2FoldChange: '-1', pvalue: '0.05', direction: 'down' },
      ],
      columns: [
        { field: 'gene', type: 'string', sortable: true, filterable: true },
        { field: 'log2FoldChange', type: 'number', sortable: true, filterable: true },
        { field: 'pvalue', type: 'number', sortable: true, filterable: true },
        { field: 'direction', type: 'string', sortable: true, filterable: true },
      ],
    } satisfies ResultTableQuery;
    const { container } = render(<ScientificInteractionViewer language="r" jobId="job_1" artifactName="volcano.png" manifest={scatterManifest} backingTable={query} selection={null} onSelectionChange={onSelectionChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'up' }));
    expect(onSelectionChange.mock.calls[0][0].origin).toBe('legend_select');
    expect(onSelectionChange.mock.calls[0][0].entityIds).toEqual(['TP53']);

    const svg = container.querySelector('svg') as SVGSVGElement;
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 350, width: 600, height: 350,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(svg, { clientX: 1, clientY: 1 });
    fireEvent.pointerMove(svg, { clientX: 599, clientY: 349 });
    fireEvent.pointerUp(svg, { clientX: 599, clientY: 349 });
    expect(onSelectionChange.mock.calls[1][0].origin).toBe('region_select');
    expect(onSelectionChange.mock.calls[1][0].entityIds.sort()).toEqual(['EGFR', 'TP53']);
  });

  it('maps heatmap rows to genes and columns to samples', () => {
    const onSelectionChange = vi.fn();
    const query = {
      ...tableQuery(0),
      rows: [
        { gene: 'TP53', sample_a: '1.2', sample_b: '-0.4' },
        { gene: 'EGFR', sample_a: '0.2', sample_b: '2.1' },
      ],
      columns: [
        { field: 'gene', type: 'string', sortable: true, filterable: true },
        { field: 'sample_a', type: 'number', sortable: true, filterable: true },
        { field: 'sample_b', type: 'number', sortable: true, filterable: true },
      ],
    } satisfies ResultTableQuery;
    render(<ScientificInteractionViewer language="r" jobId="job_1" artifactName="heatmap.png" manifest={matrixManifest()} backingTable={query} selection={null} onSelectionChange={onSelectionChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'TP53' }));
    expect(onSelectionChange.mock.calls[0][0].origin).toBe('row_select');
    expect(onSelectionChange.mock.calls[0][0].entityIds).toEqual(['TP53']);
    fireEvent.click(screen.getByTitle('选择 sample_a'));
    expect(onSelectionChange.mock.calls[1][0].origin).toBe('column_select');
    expect(onSelectionChange.mock.calls[1][0].entityType).toBe('sample');
    expect(onSelectionChange.mock.calls[1][0].fields).toEqual(['sample_a']);
  });

  it('fails closed as read-only when a plot has no stable mapping', () => {
    const readOnlyManifest = {
      ...manifest('scatter'),
      idField: null,
      selectionDurable: false,
      capabilities: [],
      interactionMode: 'read_only' as const,
      mapping: null,
      diagnostics: [{ code: 'plot_without_entity_mapping', message: '插件没有提供稳定实体映射。' }],
    };
    render(<ScientificInteractionViewer language="r" jobId="job_1" artifactName="pca.png" manifest={readOnlyManifest} selection={null} onSelectionChange={() => {}} />);
    expect(screen.getByText('只读结果')).toBeTruthy();
    expect(screen.getByText('插件没有提供稳定实体映射。')).toBeTruthy();
  });

  it('keeps 100k-table scroll, selection, sort and filter feedback inside the 100ms renderer budget', async () => {
    queryResultStudioTable.mockResolvedValue(tableQuery());
    function ControlledViewer(): React.ReactElement {
      const [selection, setSelection] = React.useState<ArtifactSelection | null>(null);
      return (
        <ScientificInteractionViewer
          language="r"
          jobId="job_1"
          artifactName="deg_table.csv"
          manifest={manifest('table')}
          selection={selection}
          onSelectionChange={setSelection}
        />
      );
    }
    render(<ControlledViewer />);
    await waitFor(() => expect(screen.getByText('100,000 / 100,000 行')).toBeTruthy());

    const samples: Record<string, number> = {};
    const viewport = screen.getByRole('generic', { name: '科学结果表格' });
    Object.defineProperty(viewport, 'scrollTop', { value: 100 * 32, writable: true });
    let started = performance.now();
    fireEvent.scroll(viewport);
    expect(screen.getByText('G100')).toBeTruthy();
    samples.scrollFeedbackMs = performance.now() - started;

    started = performance.now();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 G100' }));
    expect((screen.getByRole('checkbox', { name: '选择 G100' }) as HTMLInputElement).checked).toBe(true);
    samples.selectionFeedbackMs = performance.now() - started;

    started = performance.now();
    fireEvent.click(screen.getByRole('button', { name: 'gene' }));
    expect(screen.getByRole('button', { name: 'gene ↑' })).toBeTruthy();
    samples.sortFeedbackMs = performance.now() - started;

    fireEvent.change(screen.getByRole('combobox', { name: '筛选字段' }), { target: { value: 'gene' } });
    const filter = screen.getByRole('textbox', { name: '筛选内容' }) as HTMLInputElement;
    started = performance.now();
    fireEvent.change(filter, { target: { value: 'G1' } });
    expect(filter.value).toBe('G1');
    samples.filterFeedbackMs = performance.now() - started;

    for (const [metric, value] of Object.entries(samples)) {
      expect(value, `${metric} exceeded the frozen renderer feedback budget`).toBeLessThan(100);
    }
    const rounded = Object.fromEntries(Object.entries(samples).map(([key, value]) => [key, Number(value.toFixed(3))]));
    console.log(`RS_P2_RENDERER_PERF ${JSON.stringify({ budgetMs: 100, ...rounded })}`);
  });
});
