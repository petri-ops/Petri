// ============================================================
// commandCenterModel — BLOCK-64 指挥中心瓦片墙的纯投影逻辑。
//
// 零第二真相（plan §10 治理红线）：只对 /api/tools/history 的既有
// 真相做重排与计数，不产生也不缓存任何任务状态。独立成模块以便
// 单测直接覆盖分层/截断规则。
// ============================================================
import type { ToolJob } from '@/lib/project-types';

export interface WallPartition {
  /** running/pending（活跃作业，置顶区） */
  active: ToolJob[];
  /** done/failed（历史区） */
  history: ToolJob[];
  /** 置顶区在前、各区内部 created_at 降序的最终顺序 */
  ordered: ToolJob[];
}

const byCreatedDesc = (a: ToolJob, b: ToolJob): number => b.created_at - a.created_at;

/**
 * 活跃作业置顶：done/failed 历史不再把 running/pending 挤出俯瞰墙
 * （BLOCK-64 §3 #4——连续小作业场景下长任务不可见）。
 */
export function orderJobsForWall(jobs: ToolJob[]): WallPartition {
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'pending').sort(byCreatedDesc);
  const history = jobs.filter((j) => j.status !== 'running' && j.status !== 'pending').sort(byCreatedDesc);
  return { active, history, ordered: [...active, ...history] };
}

export function isActiveJob(job: ToolJob): boolean {
  return job.status === 'running' || job.status === 'pending';
}

/**
 * BLOCK-150 ① — 排队位次（BLOCK-130 PL-3 队列化的前端消费）。
 *
 * 后端入队时返回 queuePosition=同用户 pending 中先于本作业的数量+1
 * （tools-executor.js 入队分支），但该值只在 run 响应里、不落列；任务墙的
 * 唯一真相是 /api/tools/history（全量未 scope 的用户作业投影，不含测试行），
 * 故位次在消费侧从同一真相重投影：pending 按 created_at 升序的位次（1 起）。
 * 同毫秒并列时与后端 `created_at < ?` 口径可能有 ±1 误差——展示位次是排队
 * 深度的诚实近似，不是调度承诺。
 */
export function computeQueuePositions(jobs: ToolJob[]): ReadonlyMap<string, number> {
  const positions = new Map<string, number>();
  jobs
    .filter((job) => job.status === 'pending')
    .sort((a, b) => a.created_at - b.created_at)
    .forEach((job, index) => positions.set(job.id, index + 1));
  return positions;
}
