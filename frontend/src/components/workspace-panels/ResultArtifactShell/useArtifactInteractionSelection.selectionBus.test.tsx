import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRowSelection, type ArtifactInteractionManifest } from '@/lib/artifact-selection';
import { getSelectionBusState, setSelectionBusArtifact, setSelectionBusSelection } from '@/lib/selectionBus';
import { useArtifactInteractionSelection } from './useArtifactInteractionSelection';

// ============================================================================
// 红侧契约测试 — BLOCK-139 评审修复：生产线接总线（评审 P1-1）
//
// 被钉契约：ResultArtifactShell 的交互选择簇（useArtifactInteractionSelection）
// 是选择总线的生产接线点——
//   1. 绑定执行点（D1）：交互 manifest 绑定/解绑时 setSelectionBusArtifact，
//      「切换 artifact 即换上下文」在生产发生（旧 artifact 选择不泄漏）。
//   2. shell 可见选择（用户写入 / 后端恢复 / 清除 / 保存回滚）统一镜像进总线，
//      生产下游（composer 注入、继续分析）读到的是真实生产真相。
//   3. viewer 保持回调模式（摘两 prop 会绕过 saveResultStudioSelection 持久化流，
//      属零回归红线）；总线是镜像读真相，不是第二写入通道。
// ============================================================================

const fetchArtifactInteraction = vi.fn<(...args: unknown[]) => unknown>();
const restoreResultStudioSelection = vi.fn<(...args: unknown[]) => unknown>();
const saveResultStudioSelection = vi.fn<(...args: unknown[]) => unknown>();
const deleteResultStudioSelection = vi.fn<(...args: unknown[]) => unknown>();
vi.mock('@/lib/result-studio-interaction-client', () => ({
  fetchArtifactInteraction: (...args: unknown[]) => fetchArtifactInteraction(...args),
  restoreResultStudioSelection: (...args: unknown[]) => restoreResultStudioSelection(...args),
  saveResultStudioSelection: (...args: unknown[]) => saveResultStudioSelection(...args),
  deleteResultStudioSelection: (...args: unknown[]) => deleteResultStudioSelection(...args),
}));

function manifestFor(artifactId: string, revisionId: string = 'rev_1'): ArtifactInteractionManifest {
  return {
    interactionVersion: 1,
    artifactId,
    revisionId,
    artifactKind: 'table',
    entityType: 'gene',
    idField: 'gene',
    idStrategy: 'declared_column',
    selectionDurable: true,
    columns: [{ field: 'gene' }, { field: 'padj' }],
    totalRowCount: 100,
    capabilities: ['row_select'],
    interactionMode: 'table',
    mapping: { artifactId, mode: 'table', entityType: 'gene', idField: 'gene' },
  };
}

function geneRows(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, index) => ({ gene: `G${index}`, padj: '0.001' }));
}

const project = { id: 'proj_1' } as never;
const job = { id: 'job_1' } as never;

type HookProps = { selectedArtifactName: string };
type HookResult = ReturnType<typeof useArtifactInteractionSelection>;

function mountHook(selectedArtifactName: string) {
  return renderHook<HookResult, HookProps>(
    (props: HookProps) => useArtifactInteractionSelection({
      project,
      conversationId: 'conv_1',
      job,
      effectiveJobStatus: 'done',
      lang: 'r',
      selectedArtifactName: props.selectedArtifactName,
      viewedRevision: null,
      viewerAdapter: 'table',
    }),
    { initialProps: { selectedArtifactName } },
  );
}

beforeEach(() => {
  fetchArtifactInteraction.mockReset();
  restoreResultStudioSelection.mockReset();
  saveResultStudioSelection.mockReset();
  deleteResultStudioSelection.mockReset();
  restoreResultStudioSelection.mockResolvedValue(null);
  saveResultStudioSelection.mockImplementation((...args: unknown[]) => (args[0] as { selection: unknown }).selection);
  setSelectionBusArtifact({ artifactId: '', revisionId: null });
  setSelectionBusSelection(null);
});

describe('BLOCK-139 生产线接总线（评审 P1-1）', () => {
  it('交互 manifest 绑定时执行 setSelectionBusArtifact（D1 绑定执行点）', async () => {
    fetchArtifactInteraction.mockResolvedValue({ manifest: manifestFor('deg_table', 'rev_1'), revision: null });
    const { result } = mountHook('deg_table.csv');

    await waitFor(() => expect(result.current.boundInteractionManifest?.artifactId).toBe('deg_table'));
    await waitFor(() => expect(getSelectionBusState().artifactId).toBe('deg_table'));
    await waitFor(() => expect(getSelectionBusState().revisionId).toBe('rev_1'));
  });

  it('shell 选择写入镜像进总线并携带 manifest.idField（生产下游读真相）', async () => {
    fetchArtifactInteraction.mockResolvedValue({ manifest: manifestFor('deg_table', 'rev_1'), revision: null });
    const { result } = mountHook('deg_table.csv');
    await waitFor(() => expect(result.current.boundInteractionManifest?.artifactId).toBe('deg_table'));
    await waitFor(() => expect(getSelectionBusState().artifactId).toBe('deg_table'));

    const { selection } = buildRowSelection(manifestFor('deg_table'), geneRows(3));
    act(() => {
      result.current.handleSelectionChange(selection);
    });

    const state = getSelectionBusState();
    expect(state.selection).not.toBeNull();
    expect(state.selection!.entityIds).toEqual(['G0', 'G1', 'G2']);
    expect(state.selection!.selectionId).toBeTruthy();
    expect(state.idField).toBe('gene');
  });

  it('切换 artifact 即换上下文：解绑旧 manifest 后总线回到空上下文，旧选择不泄漏', async () => {
    fetchArtifactInteraction.mockResolvedValue({ manifest: manifestFor('deg_table', 'rev_1'), revision: null });
    const { result, rerender } = mountHook('deg_table.csv');
    await waitFor(() => expect(getSelectionBusState().artifactId).toBe('deg_table'));
    act(() => {
      result.current.handleSelectionChange(buildRowSelection(manifestFor('deg_table'), geneRows(2)).selection);
    });
    await waitFor(() => expect(getSelectionBusState().selection).not.toBeNull());

    fetchArtifactInteraction.mockResolvedValue({ manifest: manifestFor('heatmap', 'rev_2'), revision: null });
    rerender({ selectedArtifactName: 'heatmap.png' });

    await waitFor(() => expect(getSelectionBusState().artifactId).toBe('heatmap'));
    expect(getSelectionBusState().selection).toBeNull();
    expect(getSelectionBusState().idField).toBeNull();
  });

  it('清除选择镜像进总线（resetInteractionSelection → 总线回空）', async () => {
    fetchArtifactInteraction.mockResolvedValue({ manifest: manifestFor('deg_table', 'rev_1'), revision: null });
    const { result } = mountHook('deg_table.csv');
    await waitFor(() => expect(getSelectionBusState().artifactId).toBe('deg_table'));
    act(() => {
      result.current.handleSelectionChange(buildRowSelection(manifestFor('deg_table'), geneRows(2)).selection);
    });
    await waitFor(() => expect(getSelectionBusState().selection).not.toBeNull());

    act(() => {
      result.current.resetInteractionSelection();
    });
    await waitFor(() => expect(getSelectionBusState().selection).toBeNull());
  });
});
