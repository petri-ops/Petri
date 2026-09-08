// ============================================================
// useProjectTreeState — 左栏项目树展开 + 会话搜索状态簇（UI-305 P1.2）
//
// 从 project-workspace.tsx 主组件整簇平移，零行为变化：
// - expandedProjects（原 308）+ toggleProjectExpand（原 948-958）+
//   expandProject（原 847/878/949 三处相同的「展开单项目」内联写法收敛）；
// - workspaceSearchQuery + searchConversationIndex + ensureSearchConversationIndex
//   （原 312-313 + 805-815；search 模式激活时的预热 effect 仍留在主组件）。
// ============================================================
import { useCallback, useState } from 'react';
import type { Project } from '@/lib/project-types';
import { listConversations, type ConversationSummary } from '@/components/copilot/copilotConversationsClient';

export function useProjectTreeState(
  projectId: string | null | undefined,
  allProjects: Project[],
) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set([projectId || '']));
  const [workspaceSearchQuery, setWorkspaceSearchQuery] = useState('');
  const [searchConversationIndex, setSearchConversationIndex] = useState<Record<string, ConversationSummary[]>>({});

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

  const ensureSearchConversationIndex = useCallback(async () => {
    const targets = allProjects.filter((item) => !searchConversationIndex[item.id]);
    if (targets.length === 0) return;
    const loaded = await Promise.all(
      targets.map(async (item) => [item.id, await listConversations('active', item.id)] as const)
    );
    setSearchConversationIndex((prev) => {
      const next = { ...prev };
      loaded.forEach(([id, list]) => {
        next[id] = list;
      });
      return next;
    });
  }, [allProjects, searchConversationIndex]);

  return {
    expandedProjects,
    setExpandedProjects,
    toggleProjectExpand,
    expandProject,
    workspaceSearchQuery,
    setWorkspaceSearchQuery,
    searchConversationIndex,
    ensureSearchConversationIndex,
  };
}
