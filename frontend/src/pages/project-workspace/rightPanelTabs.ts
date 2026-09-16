import type { IconName } from '@/components/icons/Icon';

// BLOCK-92 Wave B-1 — 右栏 tab 词表与常量外迁（原 project-workspace.tsx，纯搬运零行为变化）。
// 原导出路径 '@/pages/project-workspace' 经页面 re-export 保持兼容。

export type RightPanelMode = 'home' | 'results' | 'files' | 'browser' | 'chat' | 'analyze' | 'review' | 'io' | 'jobs' | 'agent';

export const RIGHT_PANEL_ITEMS: Array<{ id: RightPanelMode; label: string; icon: IconName }> = [
  { id: 'results', label: '结果', icon: 'bar-chart' },
  { id: 'files', label: '文件', icon: 'folder' },
  { id: 'browser', label: '浏览器', icon: 'globe' },
  { id: 'chat', label: '聊天', icon: 'sidebar' },
  { id: 'analyze', label: '分析', icon: 'sparkles' },
  // BLOCK-28.5 — 审阅并入右侧边栏 tab 体系（与其它入口同级，不再是浮层另类）
  { id: 'review', label: '审阅', icon: 'git-branch' },
  // UI-362 — 指挥中心 tab 化（用户裁决：入口应像结果/文件/审阅一样项目绑定）：
  // 瓦片墙按当前项目过滤；全局俯瞰仍由 Ctrl/Cmd+Shift+C 独立窗承载。
  { id: 'jobs', label: '指挥中心', icon: 'command' },
  // BLOCK-68 / UI-317 — 模型 I/O 信息流从 composer ⋯ 菜单迁入 tab 体系（绑会话，只读）
  { id: 'io', label: '模型 I/O', icon: 'list-details' },
  // UI-385 — 子智能体实时详情迁入右栏（原独立专属窗退役）：中断/留言/续派交互完整保留
  { id: 'agent', label: '智能体', icon: 'bot' },
  // BLOCK-72 / UI-320 — 「后端」「知识空间」迁出右栏：设备级全局能力，入口在左栏工作台
  // （/backend 与 /knowledge 全局页），右栏不再承载，不预留空壳。
];
