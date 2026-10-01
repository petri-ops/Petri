/**
 * LineageGraph 组件契约测试（BLOCK-138 P1，HK-01 红绿先行）。
 *
 * 只读 DAG 画布：数据源与 LineageStrip 同一条 /lineage 客户端（fetchResultLineage），
 * 投影走本目录 lineageProjection（本文件集成真实投影，不 mock）；React Flow 只读三
 * props（nodesDraggable/nodesConnectable/elementsSelectable=false）；节点点击走既有
 * projectOpenResult 打开链（与 LineageStrip.tsx:48 完全同链，detail={toolJobId, projectId}）。
 * 诚实纪律与条带对齐：端点失败 / lineage=null / 单节点链 → 不渲染。
 * ReactFlow 以桩件 mock（happy-dom 无尺寸测量，边几何无法断言，属实机走查范围
 * acceptance/block-138/）；本文件只断 props 契约、节点投影与交互接线。
 * 契约先行——LineageGraph.tsx 由实现步落地，本测试当前必须红。
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LineageGraph } from './LineageGraph';
import type { ResultLineageResponse } from './resultStudioClient';

const flow = vi.hoisted(() => ({ propsLog: [] as Array<Record<string, unknown>> }));

vi.mock('@xyflow/react', (): Record<string, unknown> => {
  const ReactFlowStub = (props: Record<string, unknown>) => {
    flow.propsLog.push(props);
    const nodes = (Array.isArray(props.nodes) ? props.nodes : []) as Array<{ id: string; data?: { label?: string } }>;
    return (
      <div data-testid="react-flow-stub">
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            data-testid={`flow-node-${node.id}`}
            onClick={(event) => {
              const onNodeClick = props.onNodeClick;
              if (typeof onNodeClick === 'function') {
                (onNodeClick as (event: unknown, node: unknown) => void)(event, node);
              }
            }}
          >
            {node.data?.label ?? node.id}
          </button>
        ))}
      </div>
    );
  };
  return {
    ReactFlow: ReactFlowStub,
    Background: () => null,
    MarkerType: { ArrowClosed: 'arrowclosed' },
  };
});

const fetchResultLineage = vi.fn<(...args: unknown[]) => Promise<ResultLineageResponse>>();
vi.mock('./resultStudioClient', () => ({
  fetchResultLineage: (...args: unknown[]) => fetchResultLineage(...args),
}));
vi.mock('@/lib/tool-catalog', () => ({
  useToolCatalog: () => ({ tools: [{ id: 'deseq2', title: 'DESeq2 差异表达' }, { id: 'go-kegg', title: 'GO/KEGG 富集' }], loading: false, error: null, reload: () => {} }),
  findCatalogTool: (tools: Array<{ id: string }>, toolId: string | null) =>
    (toolId ? tools.find((tool) => tool.id === toolId) || null : null),
}));

const lineageOf = (chain: ResultLineageResponse['lineage']): ResultLineageResponse => ({ ok: true, lineage: chain });

const upstreamChain: ResultLineageResponse['lineage'] = {
  chain: [
    { toolJobId: 'j1', toolId: 'deseq2', isCurrent: false },
    { toolJobId: 'j2', toolId: 'go-kegg', isCurrent: true },
  ],
  downstreamCount: 0,
};

afterEach(() => {
  cleanup();
  fetchResultLineage.mockReset();
  flow.propsLog.length = 0;
  Reflect.deleteProperty(window, 'dispatchEvent');
});

describe('LineageGraph（BLOCK-138 P1 血缘 DAG 画布）', () => {
  it('renders one DAG node per chain job with catalog titles through the real projection', async () => {
    fetchResultLineage.mockResolvedValue(lineageOf(upstreamChain));
    render(<LineageGraph projectId="p1" jobId="j2" />);
    expect((await screen.findByTestId('flow-node-j1')).textContent).toContain('DESeq2 差异表达');
    expect(screen.getByTestId('flow-node-j2').textContent).toContain('GO/KEGG 富集');
    expect(screen.getByLabelText('结果血缘图')).toBeTruthy();
  });

  it('renders the flow read-only (no dragging, no connecting, no selection)', async () => {
    fetchResultLineage.mockResolvedValue(lineageOf(upstreamChain));
    render(<LineageGraph projectId="p1" jobId="j2" />);
    await screen.findByTestId('flow-node-j2');
    const props = flow.propsLog[flow.propsLog.length - 1] ?? {};
    expect(props.nodesDraggable).toBe(false);
    expect(props.nodesConnectable).toBe(false);
    expect(props.elementsSelectable).toBe(false);
  });

  it('dispatches projectOpenResult with the clicked job (same open chain as LineageStrip)', async () => {
    const dispatchSpy = vi.fn();
    window.dispatchEvent = dispatchSpy;
    fetchResultLineage.mockResolvedValue(lineageOf(upstreamChain));
    render(<LineageGraph projectId="p1" jobId="j2" />);
    fireEvent.click(await screen.findByTestId('flow-node-j1'));
    const target = dispatchSpy.mock.calls
      .map((call) => call[0] as Event)
      .find((evt) => evt.type === 'gewu:project-open-result');
    expect(target, 'projectOpenResult event must be dispatched').toBeTruthy();
    expect((target as CustomEvent).detail).toEqual({ toolJobId: 'j1', projectId: 'p1' });
  });

  it('renders nothing for a single-node chain or missing lineage (no fabricated DAG)', async () => {
    fetchResultLineage.mockResolvedValue(lineageOf({
      chain: [{ toolJobId: 'j1', toolId: 'deseq2', isCurrent: true }],
      downstreamCount: 0,
    }));
    const first = render(<LineageGraph projectId="p1" jobId="j1" />);
    await waitFor(() => expect(fetchResultLineage).toHaveBeenCalled());
    expect(first.container.querySelector('[aria-label="结果血缘图"]')).toBeNull();
    expect(first.container.querySelector('[data-testid="react-flow-stub"]')).toBeNull();

    cleanup();
    fetchResultLineage.mockResolvedValue({ ok: true, lineage: null, note: '暂无' });
    const second = render(<LineageGraph projectId="p1" jobId="j1" />);
    await waitFor(() => expect(fetchResultLineage).toHaveBeenCalledTimes(2));
    expect(second.container.querySelector('[aria-label="结果血缘图"]')).toBeNull();
  });

  it('fails silent (renders nothing) when the lineage endpoint errors', async () => {
    fetchResultLineage.mockRejectedValue(new Error('boom'));
    const { container } = render(<LineageGraph projectId="p1" jobId="j1" />);
    await waitFor(() => expect(fetchResultLineage).toHaveBeenCalled());
    expect(container.querySelector('[aria-label="结果血缘图"]')).toBeNull();
  });
});
