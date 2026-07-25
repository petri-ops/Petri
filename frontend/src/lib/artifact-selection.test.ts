import { describe, expect, it } from 'vitest';
import {
  MAX_PERSISTED_ENTITY_IDS,
  type ArtifactInteractionManifest,
  buildColumnSelection,
  buildPointSelection,
  buildQuerySelection,
  buildRegionSelection,
  buildRowSelection,
  describeFilter,
  formatSelectionChip,
  fromPersistedSelection,
  hashEntityIds,
  isSameSelection,
  readEntityId,
  summarizeSelectionForAgent,
  toPersistPayload,
} from './artifact-selection';

function tableManifest(overrides: Partial<ArtifactInteractionManifest> = {}): ArtifactInteractionManifest {
  return {
    interactionVersion: 1,
    artifactId: 'deg_table',
    revisionId: 'rev_1',
    artifactKind: 'table',
    entityType: 'gene',
    idField: 'gene_id',
    idStrategy: 'inferred_column',
    selectionDurable: true,
    columns: [
      { field: 'gene_id', sortable: true, filterable: true },
      { field: 'log2FC', sortable: true, filterable: true, numeric: true },
      { field: 'padj', sortable: true, filterable: true, numeric: true },
    ],
    totalRowCount: 100000,
    capabilities: ['row_select', 'column_select', 'sort', 'filter'],
    ...overrides,
  };
}

const ROWS = [
  { gene_id: 'ENSG001', log2FC: 2.4, padj: 0.001 },
  { gene_id: 'ENSG002', log2FC: -1.8, padj: 0.02 },
  { gene_id: 'ENSG003', log2FC: 0.4, padj: 0.6 },
];

describe('artifact-selection · 稳定实体 ID', () => {
  it('从声明的 idField 取 ID，不使用行号', () => {
    const manifest = tableManifest();
    expect(readEntityId(manifest, ROWS[0])).toBe('ENSG001');
    expect(readEntityId(manifest, {})).toBeNull();
    expect(readEntityId(manifest, null)).toBeNull();
  });

  it('行选择产出稳定 ID 而不是索引', () => {
    const { selection, droppedRowCount } = buildRowSelection(tableManifest(), [ROWS[0], ROWS[2]]);
    expect(selection.entityIds).toEqual(['ENSG001', 'ENSG003']);
    expect(selection.entityIdCount).toBe(2);
    expect(droppedRowCount).toBe(0);
    expect(selection.durable).toBe(true);
    expect(selection.origin).toBe('row_select');
  });

  it('选择在重新排序后保持不变（这是不用行号的意义）', () => {
    const manifest = tableManifest();
    const ascending = buildRowSelection(manifest, [ROWS[0], ROWS[1]]).selection;
    const reordered = [...ROWS].reverse();
    const descending = buildRowSelection(manifest, [reordered[2], reordered[1]]).selection;
    expect(descending.entityIds).toEqual(ascending.entityIds);
    expect(descending.entityIdsHash).toBe(ascending.entityIdsHash);
  });

  it('点击顺序不同视为同一选择', () => {
    const manifest = tableManifest();
    const a = buildRowSelection(manifest, [ROWS[0], ROWS[1]]).selection;
    const b = buildRowSelection(manifest, [ROWS[1], ROWS[0]]).selection;
    expect(b.entityIdsHash).toBe(a.entityIdsHash);
    expect(isSameSelection(a, b)).toBe(true);
  });

  it('去重重复行', () => {
    const { selection } = buildRowSelection(tableManifest(), [ROWS[0], ROWS[0], ROWS[1]]);
    expect(selection.entityIds).toEqual(['ENSG001', 'ENSG002']);
  });

  it('无稳定 ID 字段时不伪造 ID，并把选择标为不可持久', () => {
    const manifest = tableManifest({ idField: null, idStrategy: 'positional', selectionDurable: false });
    const { selection, droppedRowCount } = buildRowSelection(manifest, ROWS);
    expect(selection.entityIds).toEqual([]);
    expect(droppedRowCount).toBe(3);
    expect(selection.durable).toBe(false);
    expect(formatSelectionChip(selection)).toContain('不支持持久选择');
  });
});

describe('artifact-selection · 大规模选择', () => {
  it('10 万行的选择用 query 表达且保持可复现', () => {
    const manifest = tableManifest();
    const selection = buildQuerySelection(manifest, {
      filterExpression: { logic: 'and', clauses: [{ field: 'padj', op: 'lt', value: 0.05 }] },
      sort: [{ field: 'padj', direction: 'asc' }],
      matchedEntityIds: ['ENSG001', 'ENSG002'],
      matchedCount: 100000,
      entityIdsHash: 'a'.repeat(64),
      filterHash: 'b'.repeat(64),
    });
    expect(selection.entityIdCount).toBe(100000);
    expect(selection.entityIdsTruncated).toBe(true);
    // filter 本身就是复现依据，因此超上限仍然 durable
    expect(selection.durable).toBe(true);
    expect(selection.filterExpression?.clauses[0].field).toBe('padj');
  });

  it('超上限的显式选择只持久化前 N 个，但计数说真话', () => {
    const manifest = tableManifest();
    const many = Array.from({ length: MAX_PERSISTED_ENTITY_IDS + 500 }, (_, i) => ({ gene_id: `G${i}` }));
    const { selection } = buildRowSelection(manifest, many);
    expect(selection.entityIds.length).toBe(MAX_PERSISTED_ENTITY_IDS);
    expect(selection.entityIdCount).toBe(MAX_PERSISTED_ENTITY_IDS + 500);
    expect(selection.entityIdsTruncated).toBe(true);
  });

  it('hash 覆盖全部 ID，截断不影响变更检测', () => {
    const manifest = tableManifest();
    const base = Array.from({ length: MAX_PERSISTED_ENTITY_IDS + 10 }, (_, i) => ({ gene_id: `G${i}` }));
    const changedTail = [...base];
    // 只改被截断掉的尾部
    changedTail[MAX_PERSISTED_ENTITY_IDS + 5] = { gene_id: 'DIFFERENT' };
    const a = buildRowSelection(manifest, base).selection;
    const b = buildRowSelection(manifest, changedTail).selection;
    expect(b.entityIds).toEqual(a.entityIds);
    expect(b.entityIdsHash).not.toBe(a.entityIdsHash);
  });

  it('交给 Agent 的摘要恒定有界', () => {
    const manifest = tableManifest();
    const many = Array.from({ length: 500000 }, (_, i) => ({ gene_id: `G${i}` }));
    const { selection } = buildRowSelection(manifest, many);
    const summary = summarizeSelectionForAgent(selection);
    expect(summary?.entityIdCount).toBe(500000);
    expect(summary?.sampleEntityIds.length).toBe(12);
    expect(summary?.truncated).toBe(true);
    expect(JSON.stringify(summary).length).toBeLessThan(1000);
  });
});

describe('artifact-selection · 列与图形选择', () => {
  it('列选择只接受 manifest 声明过的列', () => {
    const selection = buildColumnSelection(tableManifest(), ['padj', 'nope', 'log2FC']);
    expect(selection.fields).toEqual(['padj', 'log2FC']);
    expect(selection.origin).toBe('column_select');
  });

  it('点选映射回稳定 ID', () => {
    const selection = buildPointSelection(tableManifest({ artifactKind: 'plot' }), [ROWS[1]]);
    expect(selection.entityIds).toEqual(['ENSG002']);
    expect(selection.origin).toBe('point_select');
  });

  it('框选同时保存几何范围与命中实体', () => {
    const selection = buildRegionSelection(
      tableManifest({ artifactKind: 'plot' }),
      { x0: 3, y0: 4, x1: 1, y1: 2 },
      [ROWS[0], ROWS[1]],
    );
    // 范围被规范化为 min/max，避免反向拖拽产生负宽度
    expect(selection.region).toEqual({ x0: 1, y0: 2, x1: 3, y1: 4 });
    expect(selection.entityIds).toEqual(['ENSG001', 'ENSG002']);
  });
});

describe('artifact-selection · 摘要与持久化', () => {
  it('filter 渲染成人类可读说明', () => {
    expect(describeFilter({ logic: 'and', clauses: [{ field: 'padj', op: 'lt', value: 0.05 }] }))
      .toBe('padj<0.05');
    expect(describeFilter({
      logic: 'and',
      clauses: [
        { field: 'padj', op: 'lt', value: 0.05 },
        { field: 'log2FC', op: 'gte', value: 1 },
      ],
    })).toBe('padj<0.05 且 log2FC≥1');
    expect(describeFilter(null)).toBeNull();
  });

  it('选择 chip 同时给出规模与条件', () => {
    const selection = buildQuerySelection(tableManifest(), {
      filterExpression: { logic: 'and', clauses: [{ field: 'padj', op: 'lt', value: 0.05 }] },
      matchedEntityIds: ['ENSG001'],
      matchedCount: 27,
      entityIdsHash: 'a'.repeat(64),
      filterHash: 'b'.repeat(64),
    });
    expect(formatSelectionChip(selection)).toBe('已选择 27 个 gene · padj<0.05');
  });

  it('持久化载荷使用后端 SelectionContext v1 的字段名', () => {
    const { selection } = buildRowSelection(tableManifest(), [ROWS[0]]);
    const payload = toPersistPayload(selection, {
      selectionId: 'sel_1',
      projectId: 'project_1',
      conversationId: 'conv_1',
    });
    expect(payload.selectionId).toBe('sel_1');
    expect(payload.artifactId).toBe('deg_table');
    expect(payload.revisionId).toBe('rev_1');
    expect(payload.entityType).toBe('gene');
    expect(payload.entityIds).toEqual(['ENSG001']);
    expect((payload.displayState as Record<string, unknown>).origin).toBe('row_select');
  });

  it('重启后能从后端记录还原选择', () => {
    const { selection } = buildRowSelection(tableManifest(), [ROWS[0], ROWS[1]]);
    const payload = toPersistPayload(selection, { selectionId: 'sel_1', projectId: 'project_1' });
    // 模拟后端回读（带上后端补的计数字段）
    const restored = fromPersistedSelection({
      ...payload,
      entityIdCount: 2,
      entityIdsTruncated: false,
      createdAt: '2026-07-25T00:00:00.000Z',
    });
    expect(restored?.entityIds).toEqual(['ENSG001', 'ENSG002']);
    expect(restored?.entityType).toBe('gene');
    expect(restored?.origin).toBe('row_select');
    expect(restored?.revisionId).toBe('rev_1');
    // 恢复后的选择与原选择等价
    expect(isSameSelection(restored, selection)).toBe(true);
  });

  it('还原残缺记录时不崩溃', () => {
    expect(fromPersistedSelection(null)).toBeNull();
    expect(fromPersistedSelection(undefined)).toBeNull();
    const restored = fromPersistedSelection({ artifactId: 'x' });
    expect(restored?.entityIds).toEqual([]);
    expect(restored?.entityType).toBe('row');
  });

  it('空选择的 hash 为 null', () => {
    expect(hashEntityIds([])).toBeNull();
    expect(hashEntityIds(['A'])).not.toBeNull();
  });

  it('不同产物的同名选择不视为相同', () => {
    const a = buildRowSelection(tableManifest(), [ROWS[0]]).selection;
    const b = buildRowSelection(tableManifest({ artifactId: 'other_table' }), [ROWS[0]]).selection;
    expect(isSameSelection(a, b)).toBe(false);
  });
});
