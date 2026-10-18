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
import { useThemeOptional } from '@/themes/ThemeProvider';

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

  // BLOCK-213 — 可选主题上下文：命令面板要能"发现"外观与动效（W7c 新能力），
  // 但本钩子会被单测脱离 Provider 直接调用，故用可选读取而不是 useTheme。
  const theme = useThemeOptional();

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];
    const go = (id: string, label: string, description: string, icon: string, to: string, shortcut?: string) =>
      items.push({ id, label, description, icon, shortcut, category: 'command', action: () => navigate(to) });
    const doIt = (id: string, label: string, description: string, icon: string, action: () => void) =>
      items.push({ id, label, description, icon, category: 'command', action });

    // ① 导航（6）——键位徽章不写在这里：由 `appKeymap` 注册表派生（BLOCK-200 P1，
    // 此前此处硬编码 '⌘N' 而全仓没有 Cmd+N 处理器，徽章是装饰）。
    go('nav-home', '欢迎页 · 新对话', '回到欢迎页并开始新对话', 'plus', '/');
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

    // ⑤ 扩展中心货架 tab（此前只能进默认 tab，插件/MCP 两架在面板里不可达）
    go('nav-extensions-plugins', '扩展 · 领域插件', '领域插件货架', 'zap', '/extensions?tab=domain-plugins');
    go('nav-extensions-mcp', '扩展 · MCP 服务', 'MCP 服务货架', 'zap', '/extensions?tab=mcp');

    // ⑥ 设置深链（BLOCK-213：改为**覆盖全部节**——此前只写死 5 个，keymap/reasoning/
    // experimental 等节在面板里根本找不到，正是"发现率"缺口）
    for (const section of SETTINGS_SECTIONS) {
      items.push({
        id: `settings:${section.id}`,
        label: `设置 · ${section.label}`,
        description: section.description || '打开设置页',
        icon: 'settings',
        category: 'command',
        action: () => navigate(`/settings?section=${section.id}`),
      });
    }

    // ⑦ 外观与动效（BLOCK-208/W7c 的能力要靠面板才"被发现"；无 Provider 时跳过）
    if (theme) {
      doIt('view-theme-system', '外观 · 跟随系统', '明暗跟随系统', 'settings', () => theme.setPreference('system'));
      doIt('view-theme-light', '外观 · 日间', '固定使用日间模式', 'settings', () => theme.setPreference('light'));
      doIt('view-theme-dark', '外观 · 夜间', '固定使用夜间模式', 'settings', () => theme.setPreference('dark'));
      doIt('view-motion-system', '动效 · 跟随系统', '动效跟随系统「减弱动态效果」', 'settings', () => theme.setMotion('system'));
      doIt('view-motion-full', '动效 · 完整', '显式要求完整动效（可覆盖系统设置）', 'settings', () => theme.setMotion('full'));
      doIt('view-motion-reduced', '动效 · 精简', '关闭本应用界面的过渡与动画', 'settings', () => theme.setMotion('reduced'));
    }

    return items;
  }, [navigate, projects, skills, theme]);

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
