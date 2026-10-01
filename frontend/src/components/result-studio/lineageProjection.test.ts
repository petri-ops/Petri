/**
 * projectLineageToFlow 契约测试（BLOCK-138 P1，HK-01 红绿先行）。
 *
 * /lineage 真实形状（resultStudioClient.ts UI-456 契约）：ResultLineageResponse =
 * { ok, projectId?, graphId?, lineage: { chain: [{ toolJobId, toolId, isCurrent }], downstreamCount } | null }。
 * 链为祖先链——上游在前、当前节点末尾；下游只有数字（downstreamCount），无下游节点列表，
 * 节点字段只有 toolJobId/toolId/isCurrent（无 artifactId/kind）。
 * 可投影子集：节点=链上 job（id=toolJobId）、边=相邻依赖（上游→下游）、自左向右（D3）、
 * downstreamCount 投影为当前节点 data 属性。契约先行——lineageProjection.ts 由实现步落地。
 */

import { describe, expect, it } from 'vitest';
import { projectLineageToFlow } from './lineageProjection';
import type { ResultLineageResponse } from './resultStudioClient';

const responseOf = (lineage: ResultLineageResponse['lineage']): ResultLineageResponse => ({ ok: true, lineage });

const chainResponse = (
  chain: Array<{ toolJobId: string; toolId?: string | null; isCurrent?: boolean }>,
  downstreamCount = 0,
): ResultLineageResponse =>
  responseOf({
    chain: chain.map((node) => ({ toolJobId: node.toolJobId, toolId: node.toolId ?? null, isCurrent: node.isCurrent ?? false })),
    downstreamCount,
  });

interface LineageNodeDataProbe {
  toolJobId?: string;
  toolId?: string | null;
  label?: string;
  isCurrent?: boolean;
  downstreamCount?: number;
}

describe('projectLineageToFlow（BLOCK-138 P1 血缘 graph 响应 → React Flow 投影）', () => {
  it('projects no nodes or edges when there is no persisted lineage (honest, nothing fabricated)', () => {
    expect(projectLineageToFlow(null)).toEqual({ nodes: [], edges: [] });
    expect(projectLineageToFlow({ ok: true, lineage: null, note: '暂无' })).toEqual({ nodes: [], edges: [] });
  });

  it('maps each chain job to a node in chain order with toolId-fallback labels and current-node flags', () => {
    const { nodes } = projectLineageToFlow(chainResponse([
      { toolJobId: 'j1', toolId: 'deseq2' },
      { toolJobId: 'j2' },
      { toolJobId: 'j3', toolId: 'go-kegg', isCurrent: true },
    ], 2));

    expect(nodes.map((node) => node.id)).toEqual(['j1', 'j2', 'j3']);
    expect(nodes.map((node) => (node.data as LineageNodeDataProbe).label)).toEqual(['deseq2', 'j2', 'go-kegg']);
    expect(nodes.map((node) => (node.data as LineageNodeDataProbe).isCurrent)).toEqual([false, false, true]);
    expect(nodes.map((node) => (node.data as LineageNodeDataProbe).downstreamCount)).toEqual([0, 0, 2]);
  });

  it('lays nodes left-to-right along one horizontal lane (D3: tool-chain time order)', () => {
    const { nodes } = projectLineageToFlow(chainResponse([
      { toolJobId: 'j1', toolId: 'validator' },
      { toolJobId: 'j2', toolId: 'qc' },
      { toolJobId: 'j3', toolId: 'deseq2', isCurrent: true },
    ]));
    const xs = nodes.map((node) => node.position.x);
    const ys = nodes.map((node) => node.position.y);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(xs.length);
    expect(new Set(ys).size).toBe(1);
  });

  it('creates one dependency edge per adjacent chain pair, upstream → downstream, with unique ids', () => {
    const { edges } = projectLineageToFlow(chainResponse([
      { toolJobId: 'j1', toolId: 'validator' },
      { toolJobId: 'j2', toolId: 'qc' },
      { toolJobId: 'j3', toolId: 'deseq2' },
    ]));
    expect(edges.map((edge) => [edge.source, edge.target])).toEqual([['j1', 'j2'], ['j2', 'j3']]);
    expect(new Set(edges.map((edge) => edge.id)).size).toBe(edges.length);
  });

  it('lets the caller resolve catalog titles for labels and falls back when the resolver misses', () => {
    const { nodes } = projectLineageToFlow(chainResponse([
      { toolJobId: 'j1', toolId: 'deseq2' },
      { toolJobId: 'j2', toolId: 'never-seen' },
      { toolJobId: 'j3' },
    ]), {
      resolveLabel: (toolId) => (toolId === 'deseq2' ? 'DESeq2 差异表达' : null),
    });
    expect(nodes.map((node) => (node.data as LineageNodeDataProbe).label)).toEqual([
      'DESeq2 差异表达',
      'never-seen',
      'j3',
    ]);
  });

  it('dedupes repeated job ids (React Flow requires unique node ids) and never emits self-loop edges', () => {
    const { nodes, edges } = projectLineageToFlow(chainResponse([
      { toolJobId: 'j1', toolId: 'a' },
      { toolJobId: 'j2', toolId: 'b' },
      { toolJobId: 'j1', toolId: 'a' },
    ]));
    expect(new Set(nodes.map((node) => node.id)).size).toBe(nodes.length);
    expect(nodes.map((node) => node.id)).toEqual(['j1', 'j2']);
    expect(edges.every((edge) => edge.source !== edge.target)).toBe(true);
  });

  it('maps a single-node chain to one node and zero edges (visibility stays a component policy)', () => {
    const { nodes, edges } = projectLineageToFlow(chainResponse([{ toolJobId: 'j1', toolId: 'deseq2', isCurrent: true }]));
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe('j1');
    expect(edges).toEqual([]);
  });
});
