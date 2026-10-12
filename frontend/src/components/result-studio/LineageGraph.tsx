/**
 * LineageGraph — BLOCK-138 P1（成果面切片 B·血缘 DAG 画布）。
 *
 * 数据源与 LineageStrip 同一条 /lineage 只读客户端（fetchResultLineage），投影走
 * lineageProjection（节点=链上 job、边=相邻依赖、自左向右）。@xyflow/react 只读
 * 三 props 锁死交互面（不可拖/不可连/不可选），fitView 自适应；节点点击走既有
 * projectOpenResult 打开链（与 LineageStrip 完全同链，无会话 job 亦可达）。
 * 诚实纪律与条带对齐：端点失败 / lineage=null / 单节点链 → 不渲染。
 */

import React from 'react';
import { Background, MarkerType, ReactFlow } from '@xyflow/react';
import type { Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { fetchResultLineage, type ResultLineage } from './resultStudioClient';
import { projectLineageToFlow, type LineageGraphNodeData } from './lineageProjection';
import { findCatalogTool, useToolCatalog } from '@/lib/tool-catalog';
import { dispatchPetriEvent, petriEvents } from '@/lib/events';
import styles from './LineageGraph.module.css';

export function LineageGraph({ projectId, jobId, onPinArtifact }: {
  projectId: string | null;
  jobId: string;
  /** BLOCK-140 P1 — 「钉住」次级动作（右键节点，xyflow 下最轻形态）：钉该节点 job 产物入副栏。 */
  onPinArtifact?: (request: { projectId: string | null; toolJobId: string }) => void;
}): React.ReactElement | null {
  const [lineage, setLineage] = React.useState<ResultLineage | null>(null);
  const [failed, setFailed] = React.useState(false);
  const { tools: catalogTools } = useToolCatalog();

  // job/project 变化时清陈旧血缘再重取：render 期 adjust-state 模式（React 官方
  // 「You Might Not Need an Effect」，仓内先例 ResultArtifactShell prevViewedJobId），
  // 避免 effect 体内同步 setState（react-hooks/set-state-in-effect 门禁）。
  const fetchKey = `${jobId}:${projectId ?? ''}`;
  const [prevFetchKey, setPrevFetchKey] = React.useState(fetchKey);
  if (fetchKey !== prevFetchKey) {
    setPrevFetchKey(fetchKey);
    setLineage(null);
    setFailed(false);
  }

  React.useEffect(() => {
    let cancelled = false;
    fetchResultLineage(jobId, projectId)
      .then((response) => { if (!cancelled && response.lineage) setLineage(response.lineage); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [jobId, projectId]);

  if (failed) return null;
  if (!lineage || lineage.chain.length <= 1) return null;

  const projection = projectLineageToFlow({ ok: true, lineage }, {
    resolveLabel: (toolId) => (toolId ? findCatalogTool(catalogTools, toolId)?.title ?? null : null),
  });
  const nodes = projection.nodes.map((node) => ({
    ...node,
    className: node.data.isCurrent ? `${styles.node} ${styles.nodeCurrent}` : styles.node,
  }));

  const handleNodeClick = (_event: React.MouseEvent, node: Node<LineageGraphNodeData>): void => {
    dispatchPetriEvent(petriEvents.projectOpenResult, { toolJobId: node.id, projectId });
  };

  // BLOCK-140 P1 — 右键=钉住次级动作（主点击打开链不变）
  const handleNodeContextMenu = (event: React.MouseEvent, node: Node<LineageGraphNodeData>): void => {
    event.preventDefault();
    onPinArtifact?.({ projectId, toolJobId: node.id });
  };

  return (
    <section className={styles.lineageGraph} aria-label="结果血缘图" title="点击节点打开链 · 右键节点钉住">
      <ReactFlow
        nodes={nodes}
        edges={projection.edges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={onPinArtifact ? handleNodeContextMenu : undefined}
        defaultEdgeOptions={{
          style: { stroke: 'var(--petri-border-strong)' },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--petri-border-strong)' },
        }}
      >
        <Background />
      </ReactFlow>
    </section>
  );
}
