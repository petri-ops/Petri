import React from 'react';
import {
  OrchestrationGraph,
  projectOrchestration,
  type OrchestrationTask,
} from '@/components/workspace-panels/OrchestrationGraph';
import { TraceSurface } from './TraceSurface';

/**
 * item88 第二波：2D 专业皮肤总览三视图（目标树 / 协作关系图 / 审计流水）。
 * 零新数据、零写操作：组合既有 projectOrchestration 投影与 TraceSurface 时间轴，
 * 不引 bridge/IPC/dispatch，ReactFlow 由 OrchestrationGraph 以只读三 props 渲染。
 */
export function WorkbenchOverviewSurface({
  tasks,
  rootTaskId,
  conversationId,
}: {
  tasks: OrchestrationTask[];
  rootTaskId: string | null;
  conversationId: string | null;
}): React.ReactElement {
  const projection = projectOrchestration(tasks || [], rootTaskId || null);
  return (
    <div data-testid="workbench-overview">
      <div data-testid="wb-overview-goal-tree">目标树 · {projection.nodes.length} 节点</div>
      <OrchestrationGraph tasks={tasks || []} rootTaskId={rootTaskId || null} />
      <TraceSurface conversationId={conversationId} />
    </div>
  );
}
