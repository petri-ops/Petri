// ============================================================
// useProjectTreeState — 左栏项目树展开状态簇（UI-305 P1.2）
//
// 从 project-workspace.tsx 主组件整簇平移，零行为变化：
// - expandedProjects（原 308）+ toggleProjectExpand（原 948-958）+
//   expandProject（原 847/878/949 三处相同的「展开单项目」内联写法收敛）。
// - （UI-347）workspaceSearchQuery + searchConversationIndex +
//   ensureSearchConversationIndex 已随左栏「搜索」入口退役一并移除。
// ============================================================
import { useCallback, useState } from 'react';
import type { Project } from '@/lib/project-types';

export function useProjectTreeState(
  projectId: string | null | undefined,
  _allProjects: Project[],
) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set([projectId || '']));

  const toggleProjectExpand = useCallback((pid: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }, []);

  const expandProject = useCallback((pid: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      next.add(pid);
      return next;
    });
  }, []);

  return {
    expandedProjects,
    setExpandedProjects,
    toggleProjectExpand,
    expandProject,
  };
}
