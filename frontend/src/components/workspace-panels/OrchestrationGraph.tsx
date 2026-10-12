// ============================================================
// OrchestrationGraph — BLOCK-173 CP-9 编排 DAG 可视化（W3）。
//
// 数据源 = useSubAgentTasksForConversation 的运行快照（单一真相零第二账本）：
//   节点 = 主任务（root）+ 子/孙 agent 任务；边 = parentTaskId 父子链。
// @xyflow/react 只读三 props（不可拖/不可连/不可选），自上而下 fitView。
// 诚实纪律：无子任务 → null（不渲染空画布）；节点文案截断 60 字符。
// ============================================================
import React from 'react';
import { Background, ReactFlow } from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';
import styles from './OrchestrationGraph.module.css';

export interface OrchestrationTask {
  taskId?: string;
  parentTaskId?: string;
  status: string;
  userContent: string;
}

const STATUS_COLOR: Record<string, string> = {
  running: 'var(--petri-info, #2563eb)',
  done: 'var(--petri-status-success, #16a34a)',
  stopped: 'var(--petri-text-muted, #6a6a73)',
  cancelled: 'var(--petri-text-muted, #6a6a73)',
  error: 'var(--petri-danger, #ef4444)',
};

function shortLabel(content: string): string {
  const firstLine = (content || '').split('\n')[0].trim();
  return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine || '(空任务)';
}

/** 把 tasks 快照投影为只读 DAG 节点/边（父→子方向）。 */
export function projectOrchestration(tasks: OrchestrationTask[], rootTaskId: string | null): {
  nodes: Node[];
  edges: Edge[];
} {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  // 无 taskId 的快照无法成节点（防御性过滤；run 快照正常都有 id）
  const knownTasks = tasks.filter((t) => typeof t.taskId === 'string' && t.taskId.length > 0) as Array<
    OrchestrationTask & { taskId: string }
  >;
  const known = new Set(knownTasks.map((t) => t.taskId));

  if (rootTaskId) {
    nodes.push({
      id: rootTaskId,
      position: { x: 0, y: 0 },
      data: { label: '主任务 · root' },
      style: {
        padding: '6px 10px',
        borderRadius: 'var(--petri-radius-md, 6px)',
        border: `1px solid ${STATUS_COLOR.done || 'var(--petri-border)'}`,
        background: 'var(--petri-bg, #fff)',
        color: 'var(--petri-text, #111)',
        fontSize: 'var(--petri-font-size-xs, 11px)',
      },
    });
  }

  // 自上而下简单分层：按父链深度排 y，同层按序排 x。
  const depthOf = new Map<string, number>();
  for (const task of knownTasks) {
    let depth = 1;
    let cursor: string | undefined = task.parentTaskId;
    let guard = 0;
    while (cursor && known.has(cursor) && guard < 8) {
      depth += 1;
      cursor = tasks.find((t) => t.taskId === cursor)?.parentTaskId;
      guard += 1;
    }
    depthOf.set(task.taskId, depth);
  }
  const maxDepth = Math.max(1, ...[...depthOf.values()]);
  const layerWidth = 260;
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const layer = knownTasks.filter((t) => (depthOf.get(t.taskId) ?? 1) === depth);
    layer.forEach((task, index) => {
      nodes.push({
        id: task.taskId,
        position: { x: index * layerWidth, y: depth * 90 },
        data: { label: shortLabel(task.userContent) },
        style: {
          padding: '6px 10px',
          borderRadius: 'var(--petri-radius-md, 6px)',
          border: `1px solid ${STATUS_COLOR[task.status] || 'var(--petri-border)'}`,
          background: 'var(--petri-bg, #fff)',
          color: 'var(--petri-text, #111)',
          fontSize: 'var(--petri-font-size-xs, 11px)',
          maxWidth: 240,
        },
      });
    });
  }

  for (const task of knownTasks) {
    if (task.parentTaskId && known.has(task.parentTaskId)) {
      edges.push({
        id: `e:${task.parentTaskId}->${task.taskId}`,
        source: task.parentTaskId,
        target: task.taskId,
        animated: task.status === 'running',
        style: { stroke: 'var(--petri-border, #ccc)' },
      });
    } else if (rootTaskId && !task.parentTaskId) {
      edges.push({ id: `e:${rootTaskId}->${task.taskId}`, source: rootTaskId, target: task.taskId });
    }
  }
  return { nodes, edges };
}

export function OrchestrationGraph({ tasks, rootTaskId }: {
  tasks: OrchestrationTask[];
  rootTaskId: string | null;
}): React.ReactElement | null {
  if (tasks.length === 0) return null;
  const { nodes, edges } = projectOrchestration(tasks, rootTaskId);
  return (
    <div className={styles.orchestrationGraph} data-testid="orchestration-graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background gap={16} />
      </ReactFlow>
      <div className={styles.legend}>
        <span className={styles.legendItem}><i style={{ background: 'var(--petri-info, #2563eb)' }} />运行中</span>
        <span className={styles.legendItem}><i style={{ background: 'var(--petri-status-success, #16a34a)' }} />完成</span>
        <span className={styles.legendItem}><i style={{ background: 'var(--petri-danger, #ef4444)' }} />失败</span>
      </div>
    </div>
  );
}
