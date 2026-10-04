import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildPointSelection,
  buildRowSelection,
  type ArtifactInteractionManifest,
} from '@/lib/artifact-selection';
import {
  getSelectionBusState,
  setSelectionBusArtifact,
  setSelectionBusSelection,
} from '@/lib/selectionBus';

// ============================================================================
// 红侧契约测试 — BLOCK-139 P1 mark-to-entity（plan §2 P1 / g0-result-studio-plan §22.2 #2）
//
// 被钉契约：表格行选中 / 图上点选落总线时，总线必须携带 mark-to-entity 全套
// 标记——entityType（选择词汇既有字段）+ idField（实体 ID 源列，manifest 词汇，
// 新增于总线状态）。下游消费面据此把选中 ID 映射回源产物实体，不靠猜列。
//
// 契约行为：
//   1. setSelectionBusSelection(selection, { idField }) 写入时总线状态暴露
//      state.idField；entityType 不新造第二份词汇，仍读 state.selection.entityType。
//   2. 清除选择（null）→ idField 一并归 null（无活跃标记）。
//   3. 切换活跃 artifact 即换上下文 → idField 不跨 artifact 泄漏。
//   4. 未带上下文的写入不伪造标记列（idField 为 null，词汇不虚标）。
// ============================================================================

function manifestFor(artifactId: string): ArtifactInteractionManifest {
  return {
    interactionVersion: 1,
    artifactId,
    revisionId: 'rev_1',
    artifactKind: 'table',
    entityType: 'gene',
    idField: 'gene',
    idStrategy: 'declared_column',
    selectionDurable: true,
    columns: [{ field: 'gene' }, { field: 'padj' }],
    totalRowCount: 100,
    capabilities: ['row_select', 'point_select'],
    interactionMode: 'table',
    mapping: { artifactId, mode: 'table', entityType: 'gene', idField: 'gene' },
  };
}

function geneRows(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, index) => ({ gene: `G${index}`, padj: '0.001' }));
}

beforeEach(() => {
  setSelectionBusArtifact({ artifactId: '', revisionId: null });
  setSelectionBusSelection(null);
});

describe('BLOCK-139 P1 mark-to-entity：选择落总线携带 entityType+idField', () => {
  it('行选择写入带 idField 上下文：总线暴露标记列，entityType 沿用选择词汇', () => {
    setSelectionBusArtifact({ artifactId: 'deg_table', revisionId: 'rev_1' });
    const { selection } = buildRowSelection(manifestFor('deg_table'), geneRows(3));
    setSelectionBusSelection(selection, { idField: 'gene' });

    const state = getSelectionBusState();
    expect(state.idField).toBe('gene');
    expect(state.selection!.entityType).toBe('gene');
    expect(state.selection!.origin).toBe('row_select');
    expect(state.selection!.entityIds).toEqual(['G0', 'G1', 'G2']);
  });

  it('图上点选同样携带 idField（图形 mark-to-entity）', () => {
    setSelectionBusArtifact({ artifactId: 'volcano', revisionId: 'rev_1' });
    // buildPointSelection 直接返回 ArtifactSelection（与 buildRowSelection 的
    // { selection } 包装不同）。
    const selection = buildPointSelection(manifestFor('volcano'), [
      { gene: 'TP53', padj: '0.001' },
    ]);
    setSelectionBusSelection(selection, { idField: 'gene' });

    const state = getSelectionBusState();
    expect(state.idField).toBe('gene');
    expect(state.selection!.entityType).toBe('gene');
    expect(state.selection!.origin).toBe('point_select');
    expect(state.selection!.entityIds).toEqual(['TP53']);
  });

  it('清除选择（null）后标记列一并归 null（无活跃标记）', () => {
    setSelectionBusArtifact({ artifactId: 'deg_table', revisionId: 'rev_1' });
    setSelectionBusSelection(buildRowSelection(manifestFor('deg_table'), geneRows(2)).selection, { idField: 'gene' });
    expect(getSelectionBusState().idField).toBe('gene');

    setSelectionBusSelection(null);
    const state = getSelectionBusState();
    expect(state.selection).toBeNull();
    expect(state.idField).toBeNull();
  });

  it('切换活跃 artifact 即换上下文：idField 不跨 artifact 泄漏', () => {
    setSelectionBusArtifact({ artifactId: 'deg_table', revisionId: 'rev_1' });
    setSelectionBusSelection(buildRowSelection(manifestFor('deg_table'), geneRows(2)).selection, { idField: 'gene' });
    expect(getSelectionBusState().idField).toBe('gene');

    setSelectionBusArtifact({ artifactId: 'volcano', revisionId: null });
    const state = getSelectionBusState();
    expect(state.artifactId).toBe('volcano');
    expect(state.selection).toBeNull();
    expect(state.idField).toBeNull();
  });

  it('未带上下文的写入不伪造标记列（idField null，词汇不虚标）', () => {
    setSelectionBusArtifact({ artifactId: 'deg_table', revisionId: 'rev_1' });
    setSelectionBusSelection(buildRowSelection(manifestFor('deg_table'), geneRows(2)).selection);

    const state = getSelectionBusState();
    expect(state.selection).not.toBeNull();
    expect(state.idField).toBeNull();
  });

  it('绑定活跃 artifact 时总线状态的 idField 起始为 null（尚未有标记）', () => {
    setSelectionBusArtifact({ artifactId: 'deg_table', revisionId: 'rev_1' });
    expect(getSelectionBusState().idField).toBeNull();
  });
});
