import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRowSelection, type ArtifactInteractionManifest } from '@/lib/artifact-selection';
import {
  setSelectionBusArtifact,
  setSelectionBusSelection,
} from '@/lib/selectionBus';
import { useResultStudioEditContext } from './useResultStudioEditContext';
import type { ActiveArtifact } from '@/components/workspace-panels/ResultView';

// ============================================================================
// 红侧契约测试 — BLOCK-139 P0-2 composer 结构化注入（plan §2 + §5 D2/D3）
//
// 被钉裁决（此刻尚无实现，测试必须真实失败）：
// - D2 注入通道：走既有 copilotContext 组装链扩展，不另开注入通道（防第二注入真相）。
//   「既有组装链」的本体 = useResultStudioEditContext 的 copilotActiveArtifact
//   （project-workspace.tsx 把它写入 setCopilotContext({ activeArtifact })，
//   并被 buildResultEditCopilotAsk → copilotAsk resultContext 消费）。
// - plan §2 P0-2：组装链携带选中实体坐标（artifactId/revisionId/entityType/
//   样本≤12/计数≤2000，恒定有界）——Agent 上下文从此有坐标。
// - D3：前端不得放宽 MAX_PERSISTED_ENTITY_IDS=2000 / 样本 12。
//
// 契约行为（P0 后）：
//   1. 选择坐标的真相源是选择总线（D1 单选择真相）——只要总线持有当前活跃
//      artifact 的兼容选择，copilotActiveArtifact.selection 就必须携带坐标，
//      而不是只认 ResultArtifactShell 经 prop 投影的 activeArtifact.selection。
//   2. 注入恒定有界：超大选择的投影样本 ≤12、计数如实。
//   3. 不兼容选择不注入：compatibility ≠ compatible 的总线选择不得交给 Agent
//      （与既有 prop 链同一语义，总线接入不得比既有链更宽）。
// ============================================================================

const fetchResultStudioContext = vi.fn<(...args: unknown[]) => unknown>();
vi.mock('@/lib/result-studio-interaction-client', () => ({
  fetchResultStudioContext: (...args: unknown[]) => fetchResultStudioContext(...args),
}));

vi.mock('@/components/copilot/conversationRunStore', () => ({
  isConversationRunning: () => false,
}));

const CONTEXT_TOKEN = 'a'.repeat(64);

function tableManifest(artifactId: string): ArtifactInteractionManifest {
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
    capabilities: ['row_select'],
    interactionMode: 'table',
    mapping: { artifactId, mode: 'table', entityType: 'gene', idField: 'gene' },
  };
}

function geneRows(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, index) => ({ gene: `G${index}`, padj: '0.001' }));
}

/** Shell 尚未投影选择（selection 为空）的 activeArtifact 现状形状。 */
function shellArtifactWithoutSelection(): ActiveArtifact {
  return {
    jobId: 'job_1',
    toolId: 'deg_tool',
    name: 'deg_table.csv',
    type: 'table',
    revisionId: 'rev_1',
  };
}

function renderEditContext() {
  const initialProps = {
    projectId: 'proj_1',
    activeConvId: 'conv_1',
    activeArtifact: shellArtifactWithoutSelection(),
    setActiveArtifact: vi.fn(),
    activeJobId: 'job_1',
    activeConversationRun: null,
    setWorkspaceNotice: vi.fn(),
  };
  // rerender 绑定 initialProps：裸 rerender() 会以 undefined 复渲染（RTL v16），
  // 生产 options 必填，测试侧显式传参（评审 Minor：不倒逼生产代码兜底）。
  const hook = renderHook((props: typeof initialProps) => useResultStudioEditContext(props), {
    initialProps,
  });
  return { ...hook, rerender: () => hook.rerender(initialProps) };
}

beforeEach(() => {
  fetchResultStudioContext.mockReset();
  // G0-RS-P3 契约：真相来自后端 context-envelope；此处 mock 为 ready 且 token 有效，
  // 使注入链的既有条件（contextToken 就位）成立，从而单独检验「坐标来自总线」这一新契约。
  fetchResultStudioContext.mockResolvedValue({
    status: 'ready',
    agentView: {
      contextVersion: 1,
      contextToken: CONTEXT_TOKEN,
      artifact: { name: null, kind: null, entityType: null, interactionMode: null },
      tool: null,
      revisionOrdinal: null,
      isCurrent: true,
      validation: { artifactTruthStatus: null, revisionValidationStatus: null },
      reproducibility: { status: null, scriptAvailable: false },
      selection: null,
      selectionState: { present: false, compatibility: null, reason: null, usableByAgent: true },
      editableParameters: [],
      actions: [],
      workflow: { available: false, nodeId: null, stepCount: null, downstreamNodeIds: [] },
      publicPhases: [],
    },
    editControls: null,
    diagnostics: [],
  });
  setSelectionBusArtifact({ artifactId: '', revisionId: null });
  setSelectionBusSelection(null);
});

describe('BLOCK-139 P0-2 composer 结构化注入（D2 既有组装链扩展）', () => {
  it('总线持有兼容选择时，copilotActiveArtifact.selection 携带实体坐标（即使 shell 未投影选择）', async () => {
    const { result, rerender } = renderEditContext();
    // 既有条件先就位：后端 envelope ready、contextToken 有效。
    await waitFor(() => expect(result.current.copilotActiveArtifact?.contextToken).toBe(CONTEXT_TOKEN));
    expect(result.current.copilotActiveArtifact?.selection).toBeNull();

    // 宿主绑定活跃 artifact + viewer 写选择进总线（D1）。
    act(() => {
      setSelectionBusArtifact({ artifactId: 'deg_table', revisionId: 'rev_1' });
      setSelectionBusSelection(buildRowSelection(tableManifest('deg_table'), geneRows(3)).selection);
    });
    rerender();
    await waitFor(() => expect(result.current.copilotActiveArtifact?.selection).not.toBeNull());

    const projection = result.current.copilotActiveArtifact!.selection!;
    expect(projection.artifactId).toBe('deg_table');
    expect(projection.revisionId).toBe('rev_1');
    expect(projection.entityType).toBe('gene');
    expect(projection.origin).toBe('row_select');
    expect(projection.entityIdCount).toBe(3);
    expect(projection.sampleEntityIds).toContain('G0');
  });

  it('注入恒定有界（D3）：2500 个实体的选择注入样本 ≤12、计数如实、truncated 如实', async () => {
    const { result, rerender } = renderEditContext();
    await waitFor(() => expect(result.current.copilotActiveArtifact?.contextToken).toBe(CONTEXT_TOKEN));

    act(() => {
      setSelectionBusArtifact({ artifactId: 'deg_table', revisionId: 'rev_1' });
      setSelectionBusSelection(buildRowSelection(tableManifest('deg_table'), geneRows(2500)).selection);
    });
    rerender();
    await waitFor(() => expect(result.current.copilotActiveArtifact?.selection).not.toBeNull());

    const projection = result.current.copilotActiveArtifact!.selection!;
    expect(projection.sampleEntityIds.length).toBeLessThanOrEqual(12);
    expect(projection.entityIdCount).toBe(2500);
    expect(projection.truncated).toBe(true);
  });

  it('不兼容选择不注入：总线选择 compatibility ≠ compatible 时 selection 保持 null（不比既有链更宽）', async () => {
    const { result, rerender } = renderEditContext();
    await waitFor(() => expect(result.current.copilotActiveArtifact?.contextToken).toBe(CONTEXT_TOKEN));

    const stale = {
      ...buildRowSelection(tableManifest('deg_table'), geneRows(3)).selection,
      compatibility: 'stale' as const,
    };
    act(() => {
      setSelectionBusArtifact({ artifactId: 'deg_table', revisionId: 'rev_1' });
      setSelectionBusSelection(stale);
    });
    rerender();
    await waitFor(() =>
      expect(result.current.copilotActiveArtifact?.selectionCompatibility).toBe('stale'),
    );
    expect(result.current.copilotActiveArtifact!.selection).toBeNull();
  });
});
