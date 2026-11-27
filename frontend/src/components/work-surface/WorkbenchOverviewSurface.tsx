import React from 'react';
import {
  OrchestrationGraph,
  projectOrchestration,
  type OrchestrationTask,
} from '@/components/workspace-panels/OrchestrationGraph';
import { TraceSurface } from './TraceSurface';
import { fetchWbOverview, type WbOverview } from '@/lib/wbOverviewClient';

/**
 * item88 第二波：2D 专业皮肤总览三视图（目标树 / 协作关系图 / 审计流水）。
 *
 * 数据源两层（item88 第三波接线）：
 *   - wb_goals/wb_tasks 五态精确投影（project_scoped，经 /api/wb/overview 只读面）
 *     —— 目标树的主干：目标根节点 + 子任务五态（accepted/running/blocked/needs-user/queued）
 *       + 状态色（OrchestrationGraph STATUS_COLOR §4.4 扩展）。
 *   - 会话子代理快照（tasks/rootTaskId props，右栏会话绑定时传入）—— 执行层。
 *   合并去重按 taskId（wb 节点优先：wb id 空间 demo_wb_* 与 loop 的 demo_agent_* 天然分离）。
 * 零写操作：ReactFlow 由 OrchestrationGraph 以只读 props 渲染。
 */
export function WorkbenchOverviewSurface({
  tasks,
  rootTaskId,
  conversationId,
  projectId,
}: {
  tasks: OrchestrationTask[];
  rootTaskId: string | null;
  conversationId: string | null;
  /** item88 第三波 — wb 目标树按项目投影（独立入口 /overview 与右栏短入口都传）。 */
  projectId?: string | null;
}): React.ReactElement {
  const [wbOverview, setWbOverview] = React.useState<WbOverview | null>(null);
  React.useEffect(() => {
    if (!projectId) return;
    let alive = true;
    void fetchWbOverview(projectId).then((overview) => {
      if (alive) setWbOverview(overview);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  // wb_goals/wb_tasks → OrchestrationTask 形状（状态机五态原词透传给状态色表）
  const wbTasks: OrchestrationTask[] = React.useMemo(() => {
    if (!wbOverview?.goals?.length) return [];
    const out: OrchestrationTask[] = [];
    for (const goal of wbOverview.goals) {
      out.push({
        taskId: goal.id,
        status: goal.status === 'active' ? 'running' : goal.status,
        userContent: `🎯 ${goal.description}`,
      });
      for (const task of goal.tasks) {
        const specLabel = task.spec?.['产物类型'] ? `（${task.spec['产物类型']}）` : '';
        out.push({
          taskId: task.id,
          parentTaskId: goal.id,
          status: task.status,
          userContent: `${task.id.replace(/^demo_wb_task_/, '').replace(/^hk_/, '')} ${specLabel}`.trim() || task.id,
        });
      }
    }
    return out;
  }, [wbOverview]);

  // 合并去重：wb 节点优先（taskId 冲突时 wb 侧为准），loop 快照补执行层
  const mergedTasks = React.useMemo(() => {
    const seen = new Set(wbTasks.map((task) => task.taskId));
    const loopExtras = (tasks || []).filter((task) => task.taskId && !seen.has(task.taskId));
    return [...wbTasks, ...loopExtras];
  }, [wbTasks, tasks]);

  const wbRootId = wbOverview?.goals?.[0]?.id ?? null;
  const effectiveRoot = wbTasks.length > 0 ? wbRootId : rootTaskId;
  const projection = projectOrchestration(mergedTasks, effectiveRoot);

  return (
    <div data-testid="workbench-overview">
      <div data-testid="wb-overview-goal-tree">
        {wbTasks.length > 0 ? (
          <>目标树 · {projection.nodes.length} 节点 · wb 五态投影 {wbTasks.filter((task) => task.parentTaskId).length} 任务</>
        ) : (
          <>目标树 · {projection.nodes.length} 节点</>
        )}
      </div>
      <OrchestrationGraph tasks={mergedTasks} rootTaskId={effectiveRoot} />
      <TraceSurface conversationId={conversationId} />
    </div>
  );
}
