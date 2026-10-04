import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRowSelection,
  isSameSelection,
  type ArtifactInteractionManifest,
  type ArtifactSelection,
} from '@/lib/artifact-selection';
import {
  getSelectionBusState,
  setSelectionBusArtifact,
  setSelectionBusSelection,
} from '@/lib/selectionBus';
import { ScientificInteractionViewer } from './ScientificInteractionViewer';
import type { ResultTableQuery } from '@/lib/result-studio-interaction-client';

// ============================================================================
// 红侧契约测试 — BLOCK-139 P0-3 ScientificInteractionViewer 平迁接总线（plan §2）
//
// 被钉裁决（此刻尚无实现，测试必须真实失败）：
// - plan §2 P0-3：「行为不变，选择出口从组件内部状态换到总线（零行为平迁可审计）」。
// - 反目标约束：不动 IPC 面、后端零改动——本契约纯前端出口替换。
//
// 契约行为（P0 后）：
//   1. 总线出口：viewer 在未提供 onSelectionChange 回调时（总线模式），行选择等
//      交互把 ArtifactSelection 写进选择总线（D1），坐标来自 manifest。
//   2. 零行为平迁：同一交互经总线出口产生的选择与经既有回调出口产生的选择
//      在 ArtifactSelection 语义上同构（isSameSelection + entityType/durable/计数）。
//   3. 总线读回显：viewer 从总线读当前选择回显选中态，并随总线清除同步消失
//      （跨 viewer 共享的消费面）。
//
// 注意：onSelectionChange / selection 两个 prop 在平迁后必须变为可选
// （TypeScript strict 下体现为签名收窄）；本文件以「不传 prop」的总线用法为契约用法。
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
    totalRowCount: 100_000,
    capabilities: ['row_select', 'filter', 'sort'],
    interactionMode: 'table',
    mapping: { artifactId: 'deg_table', mode: 'table', entityType: 'gene', idField: 'gene' },
  };
}

function tableQuery(): ResultTableQuery {
  return {
    tableQueryVersion: 1,
    columns: [
      { field: 'gene', type: 'string', sortable: true, filterable: true },
      { field: 'padj', type: 'number', sortable: true, filterable: true },
    ],
    rows: Array.from({ length: 200 }, (_, index) => ({ gene: `G${index}`, padj: String(index / 1000) })),
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

async function renderBusModeViewer(): Promise<void> {
  queryResultStudioTable.mockResolvedValue(tableQuery());
  render(
    <ScientificInteractionViewer
      language="r"
      jobId="job_1"
      artifactName="deg_table.csv"
      manifest={tableManifest()}
    />,
  );
  await screen.findByRole('generic', { name: '科学结果表格' });
}

async function clickRow(entityId: string): Promise<void> {
  fireEvent.click(await screen.findByRole('checkbox', { name: `选择 ${entityId}` }));
}

describe('BLOCK-139 P0-3 viewer 选择出口换总线', () => {
  it('总线出口：未提供 onSelectionChange 时行选择写入总线，坐标来自 manifest', async () => {
    await renderBusModeViewer();
    await clickRow('G0');

    const state = getSelectionBusState();
    expect(state.selection).not.toBeNull();
    expect(state.selection!.artifactId).toBe('deg_table');
    expect(state.selection!.origin).toBe('row_select');
    expect(state.selection!.entityIds).toContain('G0');
    expect(state.selection!.entityIdCount).toBe(1);
  });

  it('零行为平迁：同一交互经总线出口与经既有回调出口产生的选择同构', async () => {
    // 现状形态：回调出口（既有测试面，保持零回归）。
    queryResultStudioTable.mockResolvedValue(tableQuery());
    const onSelectionChange = vi.fn<(selection: ArtifactSelection | null) => void>();
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
    await waitFor(() => expect(onSelectionChange).toHaveBeenCalled());
    const viaCallback = onSelectionChange.mock.calls[onSelectionChange.mock.calls.length - 1][0];
    cleanup();
    queryResultStudioTable.mockReset();

    // P0 形态：总线出口。
    await renderBusModeViewer();
    await clickRow('G0');
    const viaBus = getSelectionBusState().selection;

    expect(viaCallback).not.toBeNull();
    expect(viaBus).not.toBeNull();
    expect(isSameSelection(viaBus, viaCallback)).toBe(true);
    // isSameSelection 不覆盖的平迁维度：entityType / durable / truncated。
    expect(viaBus!.entityType).toBe(viaCallback!.entityType);
    expect(viaBus!.durable).toBe(viaCallback!.durable);
    expect(viaBus!.entityIdsTruncated).toBe(viaCallback!.entityIdsTruncated);
  });

  it('总线读回显：viewer 从总线读当前选择回显选中态，总线清除后同步消失', async () => {
    setSelectionBusArtifact({ artifactId: 'deg_table', revisionId: 'rev_1' });
    const manifest = tableManifest();
    setSelectionBusSelection(buildRowSelection(manifest, [{ gene: 'G1', padj: '0.001' }]).selection);

    await renderBusModeViewer();
    expect(await screen.findByRole('checkbox', { name: '选择 G1' })).toHaveProperty('checked', true);

    act(() => {
      setSelectionBusSelection(null);
    });
    expect(screen.getByRole('checkbox', { name: '选择 G1' })).toHaveProperty('checked', false);
  });
});
