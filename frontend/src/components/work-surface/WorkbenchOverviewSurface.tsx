import React from 'react';
import {
  OrchestrationGraph,
  projectOrchestration,
  type OrchestrationTask,
} from '@/components/workspace-panels/OrchestrationGraph';
import { TraceSurface } from './TraceSurface';
import { fetchWbOverview, type WbOverview } from '@/lib/wbOverviewClient';
import { getApiPrefix } from '@/lib/env';

// item 87 第二波 — 教练循环摘要（只读）：phase/决策数/分歧数，bio 试点域白名单在后端。
export interface CoachingRunSummary {
  runId: string;
  goalId: string;
  taskId?: string | null;
  domain: string;
  userId: string;
  phase: string;
  handover_ratio: number;
  decision_count: number;
  accepted_count: number;
  total_count: number;
}

export interface CoachingSummary {
  ok: boolean;
  projectId: string;
  pilotDomains: string[];
  runs: CoachingRunSummary[];
  divergences: Array<{ profileId: string; runId: string; divergences: Array<Record<string, string>>; createdAt: string }>;
}

async function fetchCoachingSummary(projectId: string): Promise<CoachingSummary | null> {
  try {
    const response = await fetch(
      `${getApiPrefix()}/do/coaching/summary?projectId=${encodeURIComponent(projectId)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return (data as CoachingSummary)?.ok === true ? (data as CoachingSummary) : null;
  } catch {
    return null;
  }
}

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

  // item 87 第二波 — 教练循环摘要（影子/交接相位 + 决策/分歧计数）
  const [coaching, setCoaching] = React.useState<CoachingSummary | null>(null);
  React.useEffect(() => {
    if (!projectId) return;
    let alive = true;
    void fetchCoachingSummary(projectId).then((summary) => {
      if (alive) setCoaching(summary);
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
      {coaching && coaching.runs.length > 0 && (
        <div data-testid="coaching-strip" data-coaching-phase={coaching.runs[0]?.phase ?? ''}>
          教练 · 相位 {coaching.runs[0]?.phase} · 决策讲解 {coaching.runs.reduce((sum, run) => sum + (run.decision_count || 0), 0)} 条 · 复盘分歧 {coaching.divergences.reduce((sum, d) => sum + d.divergences.length, 0)} 点
        </div>
      )}
      <OrchestrationGraph tasks={mergedTasks} rootTaskId={effectiveRoot} />
      <TraceSurface conversationId={conversationId} />
    </div>
  );
}
