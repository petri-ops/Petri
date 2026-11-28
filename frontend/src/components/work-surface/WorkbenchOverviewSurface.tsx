import React from 'react';
import {
  OrchestrationGraph,
  projectOrchestration,
  type OrchestrationTask,
} from '@/components/workspace-panels/OrchestrationGraph';
import { TraceSurface } from './TraceSurface';
import { Icon } from '@/components/icons/Icon';
import { fetchWbOverview, type WbOverview } from '@/lib/wbOverviewClient';
import { getApiPrefix } from '@/lib/env';
import styles from './WorkbenchOverviewSurface.module.css';

/**
 * item 88 polish ②——任务标签可读性。
 * 优先级：显式标题 > 产物类型（去括号规格）> 首条验收标准 > 数字兜底「任务 N」。
 * 不再把裸 id 残片（demo_wb_task_1 / hk_xxx）铺在图节点上。
 */
type TaskWithSpec = {
  id: string;
  spec: { 标题?: string; label?: string; title?: string; 产物类型?: string; 验收标准?: string[] } | null;
};

function readableTaskTitle(task: TaskWithSpec): string {
  const spec = task.spec;
  const explicit = spec?.['标题'] ?? spec?.['label'] ?? spec?.['title'];
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const artifact = spec?.['产物类型'];
  if (typeof artifact === 'string' && artifact.trim()) return artifact.split('（')[0].trim();
  const criteria = spec?.['验收标准'];
  if (Array.isArray(criteria) && typeof criteria[0] === 'string' && criteria[0].trim()) return criteria[0].trim();
  const suffix = task.id.replace(/^(demo_wb_task_|hk_|task_)/, '');
  return /^\d+$/.test(suffix) ? `任务 ${suffix}` : (suffix.replace(/[_-]+/g, ' ').trim() || '未命名任务');
}

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
        // polish ③——目标节点不再逐条挂 🎯；目标/任务靠图结构分层，不靠 emoji 堆砌。
        userContent: goal.description,
      });
      for (const task of goal.tasks) {
        out.push({
          taskId: task.id,
          parentTaskId: goal.id,
          status: task.status,
          userContent: readableTaskTitle(task),
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
    <div className={styles.root} data-testid="workbench-overview">
      {/* polish ④——三分区：目标树/协作图（弹性主区）· 教练条（只读带）· 执行轨迹（独立区）。
          教练条与 wb 五态投影的既有数据/testid 原样保留，仅改呈现层次。 */}
      <section className={`${styles.section} ${styles.graphSection}`} data-testid="wb-section-graph">
        <div className={styles.sectionHead}>
          <Icon name="layers" size={14} />
          <h2 className={styles.sectionTitle}>目标树 / 协作图</h2>
          <span className={styles.sectionMeta} data-testid="wb-overview-goal-tree">
            {wbTasks.length > 0
              ? `${projection.nodes.length} 节点 · wb 五态投影 ${wbTasks.filter((task) => task.parentTaskId).length} 任务`
              : `${projection.nodes.length} 节点`}
          </span>
        </div>
        <div className={styles.graphWrap}>
          <OrchestrationGraph tasks={mergedTasks} rootTaskId={effectiveRoot} />
        </div>
      </section>
      {coaching && coaching.runs.length > 0 && (
        <div
          className={styles.coachingStrip}
          data-testid="coaching-strip"
          data-coaching-phase={coaching.runs[0]?.phase ?? ''}
        >
          教练 · 相位 {coaching.runs[0]?.phase} · 决策讲解 {coaching.runs.reduce((sum, run) => sum + (run.decision_count || 0), 0)} 条 · 复盘分歧 {coaching.divergences.reduce((sum, d) => sum + d.divergences.length, 0)} 点
        </div>
      )}
      <section className={`${styles.section} ${styles.traceSection}`} data-testid="wb-section-trace">
        <TraceSurface conversationId={conversationId} />
      </section>
    </div>
  );
}
