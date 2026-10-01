/**
 * LineageGraph 投影纯函数 — BLOCK-138 P1（成果面切片 B·血缘 DAG 画布）。
 *
 * /lineage 权威响应（resultStudioClient.ts UI-456 契约）是祖先链：上游在前、
 * 当前节点末尾；下游只有数字（downstreamCount），节点字段只有
 * toolJobId/toolId/isCurrent（无 artifactId/kind、无下游节点列表）——按前端
 * 可投影子集投影：节点=链上 job（id=toolJobId）、边=相邻依赖（上游→下游）、
 * 自左向右（plan D3 工具链时间序）。后端扩字段（artifact 节点/下游分支）留
 * 集成阶段，本函数形状只增不改。
 */

import type { Edge, Node } from '@xyflow/react';
import type { ResultLineageResponse } from './resultStudioClient';

/** 血缘画布节点 data（React Flow v12 要求 data extends Record<string, unknown>）。 */
export interface LineageGraphNodeData extends Record<string, unknown> {
  toolJobId: string;
  toolId: string | null;
  /** 目录标题 → toolId → toolJobId 回退链的最终展示名。 */
  label: string;
  isCurrent: boolean;
  /** 当前节点携带后端 downstreamCount；非当前节点为 0（链上无下游信息）。 */
  downstreamCount: number;
}

export interface LineageFlowProjection {
  nodes: Node<LineageGraphNodeData>[];
  edges: Edge[];
}

export interface LineageProjectionOptions {
  /** 注入目录标题解析（组件用 useToolCatalog）；返回 null 走 toolId 兜底。 */
  resolveLabel?: (toolId: string | null) => string | null;
}

/** 自左向右排布的节点水平间距（px）。 */
const LINEAGE_NODE_SPACING_X = 260;

/**
 * 血缘 graph 响应 → React Flow nodes/edges 的纯映射。
 * 无持久化图（response/lineage 缺失）→ 空投影（诚实，不伪造节点）；
 * 单节点链 → 1 节点 0 边（可见性策略归组件）；重复 toolJobId 防御性去重
 * （React Flow 要求节点 id 唯一），永不出自环边。
 */
export function projectLineageToFlow(
  response: ResultLineageResponse | null | undefined,
  options: LineageProjectionOptions = {},
): LineageFlowProjection {
  const lineage = response?.lineage ?? null;
  if (!lineage) return { nodes: [], edges: [] };

  const nodes: Node<LineageGraphNodeData>[] = [];
  const seenJobIds = new Set<string>();
  for (const chainNode of lineage.chain) {
    if (seenJobIds.has(chainNode.toolJobId)) continue;
    seenJobIds.add(chainNode.toolJobId);
    const resolved = chainNode.toolId != null && options.resolveLabel
      ? options.resolveLabel(chainNode.toolId)
      : null;
    nodes.push({
      id: chainNode.toolJobId,
      position: { x: nodes.length * LINEAGE_NODE_SPACING_X, y: 0 },
      data: {
        toolJobId: chainNode.toolJobId,
        toolId: chainNode.toolId,
        label: resolved ?? chainNode.toolId ?? chainNode.toolJobId,
        isCurrent: chainNode.isCurrent,
        downstreamCount: chainNode.isCurrent ? lineage.downstreamCount : 0,
      },
    });
  }

  const edges: Edge[] = [];
  const seenEdgeIds = new Set<string>();
  let previousJobId: string | null = null;
  for (const chainNode of lineage.chain) {
    if (previousJobId !== null && previousJobId !== chainNode.toolJobId) {
      const id = `lineage-edge-${previousJobId}->${chainNode.toolJobId}`;
      if (!seenEdgeIds.has(id)) {
        seenEdgeIds.add(id);
        edges.push({ id, source: previousJobId, target: chainNode.toolJobId });
      }
    }
    previousJobId = chainNode.toolJobId;
  }

  return { nodes, edges };
}
