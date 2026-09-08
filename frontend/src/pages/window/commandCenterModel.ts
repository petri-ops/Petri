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
