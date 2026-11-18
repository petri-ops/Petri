/**
 * frontend/src/components/copilot/gen-ui/compose/catalog.tsx
 *
 * BLOCK-461 [W11 路径 A] catalog 最小集（Card/Metric/Table/Chart）。
 * ResultNode 插座通电：数据叶子（metric/table/chart）映射既有 ResultNode
 * 经 ResultCardRenderer 渲染——零第二渲染真相（评估 §6 路径 A 判据）；
 * Card 为纯布局容器。P2：props 的 $state 引用经 resolveState 取数后进入 payload。
 */

import React from 'react';
import { ResultCardRenderer } from '../../ResultCardRenderer';
import type { ResultNode } from '../../types';
import type { ComposeNode, ComposeSpec } from './spec';
import { stateRefPath } from './spec';
import { dispatchPetriEvent, petriEvents } from '@/lib/events';
import { selectComposePresentation, sceneJsonSiblingFor } from './scenePolicy';

/** unknown → 展示文本守卫（禁 Object 默认字符串化；对象/空值归 '—'，字符串原样）。 */
function safeText(value: unknown, empty = '—'): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return empty;
}

/** $state 求值上下文：get-data 取回的 job 数据对象（P2；未取到时引用原样降级为空）。 */
export type StateData = Record<string, unknown> | null;

export function resolveStateValue(value: string, state: StateData): unknown {
  const path = stateRefPath(value);
  if (path === null) return value;
  if (state === null) return undefined;
  let cursor: unknown = state;
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = Object.entries(cursor as Record<string, unknown>).find(([k]) => k === segment)?.[1]; // own-enumerable（原型键结构性拒绝）
  }
  return cursor;
}

export function isNodeVisible(node: ComposeNode, state: StateData): boolean {
  if (node.visible === undefined) return true;
  return Boolean(resolveStateValue(node.visible, state));
}

function toResultNode(id: string, node: ComposeNode, state: StateData): ResultNode | null {
  const resolve = (v: unknown) => (typeof v === 'string' ? resolveStateValue(v, state) : v);
  if (node.kind === 'metric') {
    const value = resolve(node.value);
    return {
      id,
      type: 'text',
      title: node.title ?? '指标',
      payload: `${safeText(value)}${node.unit ? ` ${safeText(resolve(node.unit), '')}` : ''}`,
      createdAt: 'compose',
    };
  }
  if (node.kind === 'table') {
    const rows = resolve(node.rows);
    const normalized = Array.isArray(rows)
      ? rows
      : Array.isArray(node.rows)
        ? node.rows
        : [];
    return {
      id,
      type: 'table',
      title: node.title ?? '表格',
      payload: { columns: node.columns ?? [], rows: normalized },
      createdAt: 'compose',
    };
  }
  if (node.kind === 'chart') {
    const labels = resolve(node.labels);
    const series = (node.series ?? []).map((entry) => ({
      name: typeof entry.name === 'string' ? entry.name : 'series',
      values: resolve(entry.values),
    }));
    const chartType = node.chartType === 'line' ? 'line' : 'bar';
    return {
      id,
      type: 'chart',
      title: node.title ?? '图表',
      payload: chartType === 'line'
        ? { kind: 'line', xLabels: Array.isArray(labels) ? labels : [], series }
        : { kind: 'bar', labels: Array.isArray(labels) ? labels : [], series },
      createdAt: 'compose',
    };
  }
  return null; // card 不是 ResultNode 叶子（纯容器）
}

interface ComposeTreeNodeProps {
  spec: ComposeSpec;
  nodeId: string;
  state: StateData;
  depth: number;
  projectId?: string | null;
}

function ComposeTreeNode({ spec, nodeId, state, depth, projectId }: ComposeTreeNodeProps): React.ReactElement | null {
  const node = Object.entries(spec.nodes).find(([k]) => k === nodeId)?.[1];
  if (!node || !isNodeVisible(node, state)) return null;
  const children = Object.entries(spec.nodes)
    .filter(([id, child]) => (child)?.parent === nodeId && id !== nodeId)
    .map(([id]) => id);

  if (node.kind === 'card') {
    return (
      <div data-compose-node={nodeId} style={{ border: '1px solid var(--petri-border)', borderRadius: 10, padding: '10px 12px', margin: '8px 0' }}>
        {node.title ? <div style={{ fontWeight: 600, fontSize: 'var(--petri-font-size-sm, 12px)', marginBottom: 6 }}>{node.title}</div> : null}
        {children.map((child) => (
          <ComposeTreeNode key={child} spec={spec} nodeId={child} state={state} depth={depth + 1} projectId={projectId} />
        ))}
      </div>
    );
  }
  // BLOCK-463（双形态互达）：mesh-reference .glb 节点 → Result Studio 工作面
  //（selectComposePresentation 判定矩阵；scenePath 沿 model3d/runs 的 scene.json 配对惯例）。
  if (node.kind === 'mesh-reference') {
    const presentation = selectComposePresentation(node);
    if (presentation === 'open-workbench') {
      const glbPath = node.source?.path ?? '';
      const handleOpen = () => {
        dispatchPetriEvent(petriEvents.model3dOpen, {
          projectId: projectId ?? undefined,
          scenePath: sceneJsonSiblingFor(glbPath),
          meshPath: glbPath,
          label: node.title ?? glbPath,
        } as never);
      };
      return (
        <div data-compose-node={nodeId} style={{ margin: '8px 0' }}>
          <button
            type="button"
            data-testid="compose-open-workbench"
            onClick={handleOpen}
            style={{
              padding: '6px 12px',
              border: '1px solid var(--petri-border)',
              borderRadius: 8,
              background: 'transparent',
              color: 'var(--petri-text)',
              fontSize: 'var(--petri-font-size-sm, 12px)',
              cursor: 'pointer',
            }}
          >
            在 Result Studio 打开 · {node.title ?? glbPath}
          </button>
        </div>
      );
    }
    return null;
  }
  const resultNode = toResultNode(nodeId, node, state);
  if (resultNode === null) return null;
  return (
    <div data-compose-node={nodeId}>
      <ResultCardRenderer node={resultNode} />
    </div>
  );
}

export function ComposeTree({ spec, state = null, projectId = null }: { spec: ComposeSpec; state?: StateData; projectId?: string | null }): React.ReactElement {
  return <ComposeTreeNode spec={spec} nodeId={spec.root} state={state} depth={0} projectId={projectId} />;
}
