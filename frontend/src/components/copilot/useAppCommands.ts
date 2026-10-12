// ============================================================
// useAppCommands — App 级命令面板真命令源（BLOCK-171 CP-3）。
//
// 此前 AppShell 挂载 CommandPalette 时 `commands={[]}`、`recentConversations={[]}`
// 硬灌空数组（395 行组件=空壳）。本钩子把五类真实数据源接进面板：
//   ①导航（欢迎/项目/知识库/扩展中心/审阅/设置）②项目（最近项目工作区直开）
//   ③会话（recentConversations 段，选中=跳工作区并预选该会话）
//   ④技能（slashSources 缓存源，跳扩展中心对应货架）⑤设置深链（?section= 直达节）。
// 自有形态纪律：全部命令=本地路由跳转/本地数据读取，零远端动作。
// 加载策略：面板打开（enabled=true）才拉取，三个源各自 settle 容错互不阻塞。
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import type { CommandItem } from './CommandPalette';
import type { ConversationSummary } from './copilotConversationsClient';
import { listConversations } from './copilotConversationsClient';
import { listProjects } from '@/lib/project-store';
import { fetchSlashEntries } from './SimpleChat/slashSources';
import { SETTINGS_SECTIONS } from '@/components/desktop/DesktopSettingsPanel/types';

export interface UseAppCommandsOptions {
  /** 面板打开时才拉取数据（AppShell 传 isOpen）。 */
  enabled: boolean;
  navigate: (to: string) => void;
  /** 当前路由上的项目 id（/project/:id/* 时非空；用于「打开当前工作区」）。 */
  currentProjectId: string | null;
}

export interface UseAppCommandsResult {
  commands: CommandItem[];
  recentConversations: ConversationSummary[];
  /** 选中最近会话：跳其项目工作区 + sessionStorage 预选（工作区一次性消费）。 */
  selectConversation: (conversation: ConversationSummary) => void;
}

export function useAppCommands({ enabled, navigate, currentProjectId: _currentProjectId }: UseAppCommandsOptions): UseAppCommandsResult {
  const [projects, setProjects] = useState<Array<{ id: string; name?: string }>>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [skills, setSkills] = useState<Array<{ id: string; label: string; description: string }>>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const [projectsResult, conversationsResult, skillsResult] = await Promise.allSettled([
        listProjects(),
        listConversations('active'),
        fetchSlashEntries(),
      ]);
      if (cancelled) return;
      if (projectsResult.status === 'fulfilled') {
        setProjects((projectsResult.value || []).slice(0, 3));
      }
      if (conversationsResult.status === 'fulfilled') {
        setConversations((conversationsResult.value || []).slice(0, 5));
      }
      if (skillsResult.status === 'fulfilled') {
        setSkills((skillsResult.value || []).slice(0, 4));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];
    const go = (id: string, label: string, description: string, icon: string, to: string, shortcut?: string) =>
      items.push({ id, label, description, icon, shortcut, category: 'command', action: () => navigate(to) });

    // ① 导航（6）
    go('nav-home', '欢迎页 · 新对话', '回到欢迎页并开始新对话', 'plus', '/', '⌘N');
    go('nav-projects', '项目库', '全部分析项目', 'bar-chart', '/projects');
    go('nav-knowledge', '知识空间', '知识与资料台', 'message-circle', '/knowledge');
    go('nav-extensions', '扩展中心', '插件 / 技能 / MCP 货架', 'zap', '/extensions');
    go('nav-review', '审阅工作区', '工作树变更审阅', 'search', '/review');
    go('nav-settings', '设置', '外观 / 模型 / 诊断', 'settings', '/settings');

    // ② 项目（最近 ≤3）
    for (const project of projects) {
      items.push({
        id: `project:${project.id}`,
        label: `打开「${project.name || project.id}」`,
        description: '进入项目工作区',
        icon: 'zap',
        category: 'command',
        action: () => navigate(`/project/${project.id}/chat`),
      });
    }

    // ④ 技能（slash 源 top4 → 扩展中心货架）
    for (const skill of skills) {
      items.push({
        id: `skill:${skill.id}`,
        label: `技能：${skill.label}`,
        description: skill.description || '查看产品技能',
        icon: 'zap',
        category: 'command',
        action: () => navigate('/extensions?tab=domain-skills'),
      });
    }

    // ⑤ 设置深链（节直达，?section= 由设置页消费）
    const deepLinks: Array<[string, string]> = [
      ['models', '模型接口'],
      ['usage', '用量与资源'],
      ['decisions', '决策原语'],
      ['diagnostics', '运行时与诊断'],
      ['maintenance', '隐私与维护'],
    ];
    for (const [sectionId, label] of deepLinks) {
      const meta = SETTINGS_SECTIONS.find((item) => item.id === sectionId);
      items.push({
        id: `settings:${sectionId}`,
        label: `设置 · ${label}`,
        description: meta?.description || '打开设置页',
        icon: 'settings',
        category: 'command',
        action: () => navigate(`/settings?section=${sectionId}`),
      });
    }

    return items;
  }, [navigate, projects, skills]);

  const selectConversation = (conversation: ConversationSummary) => {
    if (!conversation.project_id) return; // 无归属会话不跳转（诚实降级为无动作）
    try {
      sessionStorage.setItem(
        'petri.conversationPreselect',
        JSON.stringify({ conversationId: conversation.id })
      );
    } catch {
      /* 交接写入失败即退化为仅打开工作区 */
    }
    navigate(`/project/${conversation.project_id}/chat`);
  };

  return { commands, recentConversations: conversations, selectConversation };
}
