import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { buildRowSelection, MAX_PERSISTED_ENTITY_IDS, type ArtifactInteractionManifest } from '@/lib/artifact-selection';
import type { CopilotAskDetail } from '@/lib/events';
import { petriEvents } from '@/lib/events';
import { setSelectionBusArtifact, setSelectionBusSelection } from '@/lib/selectionBus';
import { ContinueAnalysisMenu } from './ContinueAnalysisMenu';

// ============================================================================
// 契约测试 — BLOCK-139 P1「继续分析」实体坐标驱动（评审 P1-2 修订：如实陈述）
//
// 被钉契约（组件级）：
//   1. 不存在 detail.selection 死负载/第二注入通道（D2 防止）：copilot-ask 唯一
//      监听者只消费 prompt/analysisMode/resultContext，完整实体列表到达 Agent 的
//      通道是既有后端 selection 通道（shell 写入时 saveResultStudioSelection
//      持久化 → selectionId → selection/current），菜单不另开负载。
//   2. prompt 只如实陈述实际携带的内容：计数 + entityType + 标记列 + ≤12 样本；
//      已持久化（selectionId 在）注明可经结果选择通道读取完整列表；未持久化
//      明说「仅以上样本」，不得向 Agent 声称消息里带了完整列表。
//   3. D3：样本有界、计数如实不因截断说谎（2500 → 样本 ≤12、真实规模如实）。
//   4. 总线无选择时保持既有形态。下游工具白名单属 BIO-3 P2 不做。
// ============================================================================

vi.mock('@/lib/tool-catalog', () => ({
  useToolCatalog: () => ({
    tools: [
      { id: 'alpha-analysis', title: 'Alpha 分析', inputs: [{ id: 'input_csv', type: 'file', required: true }], comingSoon: false },
    ],
    loading: false,
    error: null,
    reload: () => undefined,
  }),
  findCatalogTool: () => null,
}));

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
    capabilities: ['row_select'],
    interactionMode: 'table',
    mapping: { artifactId, mode: 'table', entityType: 'gene', idField: 'gene' },
  };
}

function geneRows(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, index) => ({ gene: `G${index}`, padj: '0.001' }));
}

function bindSelection(count: number, selectionId?: string): void {
  setSelectionBusArtifact({ artifactId: 'deg_table', revisionId: 'rev_1' });
  const { selection } = buildRowSelection(manifestFor('deg_table'), geneRows(count));
  setSelectionBusSelection(selectionId ? { ...selection, selectionId } : selection, { idField: 'gene' });
}

afterEach(() => {
  cleanup();
  setSelectionBusArtifact({ artifactId: '', revisionId: null });
  setSelectionBusSelection(null);
});

function copilotAskEventsFrom(spy: MockInstance<typeof window.dispatchEvent>): Array<CustomEvent<CopilotAskDetail>> {
  return spy.mock.calls
    .map(([event]) => event)
    .filter(
      (event): event is CustomEvent<CopilotAskDetail> =>
        event instanceof CustomEvent && event.type === petriEvents.copilotAsk,
    );
}

async function clickAlphaAnalysis(): Promise<Array<CustomEvent<CopilotAskDetail>>> {
  const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
  render(<ContinueAnalysisMenu jobId="job-123" artifactName="deg_table.csv" />);
  fireEvent.click(screen.getByLabelText('继续分析'));
  fireEvent.click(await screen.findByRole('button', { name: 'Alpha 分析' }));
  const events = copilotAskEventsFrom(dispatchSpy);
  dispatchSpy.mockRestore();
  return events;
}

describe('BLOCK-139 P1「继续分析」实体坐标驱动（如实陈述）', () => {
  it('总线持有选择时：prompt 携带计数/entityType/标记列/≤12 样本', async () => {
    bindSelection(3);
    const events = await clickAlphaAnalysis();

    expect(events).toHaveLength(1);
    const prompt = events[0].detail.prompt;
    expect(prompt).toContain('job-123');
    expect(prompt).toContain('deg_table.csv');
    expect(prompt).toContain('Alpha 分析');
    expect(prompt).toContain('3 个 gene');
    expect(prompt).toContain('标记列 gene');
    expect(prompt).toContain('G0');
    expect(prompt).toContain('G2');
  });

  it('不另开第二注入通道：copilot-ask 负载无 selection 字段（D2）', async () => {
    bindSelection(3);
    const events = await clickAlphaAnalysis();

    expect(events).toHaveLength(1);
    expect('selection' in events[0].detail).toBe(false);
  });

  it('已持久化选择（selectionId 在）：prompt 注明完整列表经结果选择通道可读', async () => {
    bindSelection(3, 'sel_saved_1');
    const events = await clickAlphaAnalysis();

    const prompt = events[0].detail.prompt;
    expect(prompt).toContain('sel_saved_1');
    expect(prompt).toContain('结果选择通道');
    expect(prompt).not.toContain('已随本消息');
  });

  it('未持久化选择：prompt 明说仅携带样本，不向 Agent 声称带完整列表', async () => {
    bindSelection(3);
    const events = await clickAlphaAnalysis();

    const prompt = events[0].detail.prompt;
    expect(prompt).toContain('仅携带以上');
    expect(prompt).toContain('不携带完整列表');
    expect(prompt).not.toContain('已随本消息');
  });

  it('D3 有界：2500 实体选择 prompt 样本 ≤12、真实规模如实（计数不因截断说谎）', async () => {
    bindSelection(2500);
    const events = await clickAlphaAnalysis();

    const prompt = events[0].detail.prompt;
    expect(prompt).toContain('2500 个 gene');
    expect(prompt).toContain(`真实规模 2500`);
    expect(prompt).toContain(String(MAX_PERSISTED_ENTITY_IDS));
    const sampleListed = ['G0', 'G11'].filter((id) => prompt.includes(id));
    expect(sampleListed).toEqual(['G0', 'G11']);
    expect(prompt).not.toContain('G12、G13');
  });

  it('总线无选择时保持既有形态：prompt 不含实体句', async () => {
    const events = await clickAlphaAnalysis();

    expect(events).toHaveLength(1);
    expect(events[0].detail.prompt).toContain('job-123');
    expect(events[0].detail.prompt).not.toContain('已选中');
  });
});
