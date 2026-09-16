import type { Project, ToolJob } from '@/lib/project-types';

// BLOCK-92 Wave B-6 — 首页最近项目/最近作业选择纯函数外迁
// （原 home.tsx，纯搬运零行为变化）。

export function pickRecentProject(projects: Project[]): Project | null {
  if (projects.length === 0) return null;
  return [...projects].sort((a, b) => {
    const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
    const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
    return bt - at;
  })[0] || null;
}

export function pickRecentCompletedJob(jobs: ToolJob[], projects: Project[]): ToolJob | null {
  const projectIds = new Set(projects.map((project) => project.id));
  return (
    [...jobs]
      .filter((job) => job.project_id && projectIds.has(job.project_id) && job.status === 'done')
      .sort((a, b) => {
        const bt = b.completed_at || b.created_at || 0;
        const at = a.completed_at || a.created_at || 0;
        return bt - at;
      })[0] || null
  );
}
