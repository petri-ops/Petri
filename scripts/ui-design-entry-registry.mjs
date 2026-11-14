#!/usr/bin/env node
/**
 * UI-D1 (BLOCK-416) — 单一入口表（canonical truth for 功能 → 路由）。
 *
 * 每个功能**恰好一条** canonical 路径；其余路径只能是显式登记、带 canonical 指向
 * 与理由的 alias（重定向 / 查询变体 / 深链 / internal 宿主）。
 * 与 App.tsx 路由、导航源码字面量、titlebar 页头清单的双向对账由
 * scripts/ui-design-entry-gate.mjs 机械执行，植入未登记入口必红。
 *
 * 本表是「事实」而非「状态」：不放宽阈值、不发明第二套导航真源。
 */

/** 主窗 + 独立窗的 canonical 路由。id 稳定，path 唯一。 */
export const CANONICAL_ENTRIES = [
  { id: 'welcome', path: '/', kind: 'page', standalone: true, surface: 'main', clicks: 1, note: '欢迎页 / 新对话（左栏「新建任务」+ nav-home + Mod+N）' },
  { id: 'projects', path: '/projects', kind: 'page', standalone: false, surface: 'main', clicks: 2, note: '项目库；左栏可见入口=显式 cancelled（U-01），命令面板/快捷键可达；页头 bare 形态归 U-06' },
  { id: 'extensions', path: '/extensions', kind: 'page', standalone: true, surface: 'main', clicks: 1, note: '扩展中心四货架；BLOCK-156 已合并 /skills /plugins' },
  { id: 'settings', path: '/settings', kind: 'page', standalone: true, surface: 'main', clicks: 1, note: '设置独立页；深链 ?section= 见 ALIASES' },
  { id: 'knowledge', path: '/knowledge', kind: 'page', standalone: true, surface: 'main', clicks: 1, note: '知识空间全局页' },
  { id: 'review', path: '/review', kind: 'page', standalone: false, surface: 'main', clicks: 2, note: '审阅主区路由页；右栏 workSurface tab 为同 canonical 的第二宿主（见 SURFACE_ALIASES）；页头 bare 形态归 U-06' },
  { id: 'project-workspace', path: '/project/:projectId/*', kind: 'page', standalone: false, surface: 'main', clicks: 1, note: '项目工作区；左栏项目树直达' },
  { id: 'legacy-results', path: '/project/:projectId/results', kind: 'redirect', standalone: false, surface: 'main', clicks: 0, note: 'UI-456 独立结果页退役，优雅回落工作区' },
  { id: 'fallback-main', path: '*', kind: 'fallback', standalone: false, surface: 'main', clicks: 0, note: '主窗兜底 → /' },
  { id: 'window-terminal', path: '/window/terminal/:sessionId', kind: 'internal', standalone: false, surface: 'detached', clicks: 0, note: '独立窗：终端会话' },
  { id: 'window-command-center', path: '/window/command-center', kind: 'internal', standalone: false, surface: 'detached', clicks: 0, note: '独立窗：指挥中心' },
  { id: 'window-side-chat', path: '/window/side-chat', kind: 'internal', standalone: false, surface: 'detached', clicks: 0, note: '独立窗：侧边会话' },
  { id: 'window-rail', path: '/window/rail', kind: 'internal', standalone: false, surface: 'detached', clicks: 0, note: 'rail 容器：主进程 CONTENT_TYPES.rail internal:true，无生产 popOut 路径；由 src/ipc/window-manager.js:282 ensureRailWindow 直载，不走白名单（显式留因，不删路由）' },
  { id: 'fallback-window', path: '*', kind: 'fallback', standalone: false, surface: 'detached', clicks: 0, note: '独立窗兜底 → /' },
];

/** 已退役但保留的深链 / 查询变体：必须指向某条 canonical，且带留因。 */
export const ALIASES = [
  { path: '/skills', canonical: '/extensions', reason: 'BLOCK-156 重定向到领域技能货架；深链收藏保底' },
  { path: '/plugins', canonical: '/extensions', reason: 'BLOCK-156 重定向到领域插件货架；深链收藏保底' },
  { path: '/extensions?tab=domain-skills', canonical: '/extensions', reason: '扩展中心货架深链（技能 slash 命令）' },
  { path: '/extensions?tab=domain-plugins', canonical: '/extensions', reason: '扩展中心货架深链（命令面板 + 工作区「插件」入口）' },
  { path: '/extensions?tab=mcp', canonical: '/extensions', reason: '扩展中心货架深链（命令面板）' },
  { path: '/settings?section=', canonical: '/settings', reason: '设置分区深链（SETTINGS_SECTIONS 10 节，前缀匹配）' },
];

/** 同一 canonical 的第二宿主：显式登记，避免「双承载」变成两条真源。 */
export const SURFACE_ALIASES = [
  { id: 'review-dock', canonical: '/review', host: '右栏 workSurface tab `review`', note: 'lib/workSurface/registry.ts:60 + RightPanel.tsx:311-315 共用 ReviewMode 组件；是否物理收敛为单一宿主属 U-06，未裁决前不删任一承载' },
];

/** 导航源码里允许出现的路径字面量（去注释后）。新增入口必须先登记这里。 */
export const ENTRY_LITERALS = [
  '/', '/projects', '/extensions', '/settings', '/knowledge', '/review',
  '/extensions?tab=domain-skills', '/extensions?tab=domain-plugins', '/extensions?tab=mcp',
  '/project/', '/settings?section=',
];

/**
 * 页头标准件（isStandalonePagePath）应识别的独立页集合 —— 本表为唯一真源。
 * UI-D1 清理：移除已退役/重定向的 /backend、/skills、/plugins；补 /extensions
 * （/skills /plugins 的 canonical 承接，页头形态一致）。
 * /projects 与 /review 是否纳入 bare 形态会改变顶栏视觉 → U-06 待裁决，默认不纳入。
 */
export const STANDALONE_PATHS = [
  '/', '/extensions', '/settings', '/knowledge',
];

/** 显式无左栏可见入口的功能：孤儿页判据靠留因成立（U-01 未裁决）。 */
export const CANCELLED_ENTRIES = [
  { id: 'leftnav-projects', reason: 'U-01 未裁决：新增左栏入口会改变默认导航密度；现状由命令面板 nav-projects + Mod+Shift+P 可达，树测试寻路归 E-01', status: 'cancelled' },
  { id: 'leftnav-review', reason: 'U-01 未裁决：现状由命令面板 nav-review + Mod+Shift+R + 右栏 tab 可达，树测试寻路归 E-01', status: 'cancelled' },
  { id: 'backend-page', reason: 'UI-366 退役：诊断并入设置「运行时与诊断」分区，无路由；页头清单残留 /backend 已清', status: 'cancelled' },
];

/** 被扫描的导航源码文件（相对仓库根）。 */
export const ENTRY_SOURCE_FILES = [
  'frontend/src/App.tsx',
  'frontend/src/components/copilot/useAppCommands.ts',
  'frontend/src/lib/appKeymap.ts',
  'frontend/src/components/desktop/AppRail.tsx',
  'frontend/src/components/workspace-panels/LeftPanel.tsx',
  'frontend/src/pages/project-workspace.tsx',
];

/** 核心任务点击数上限（清单 v1 §5 B3 判据）。 */
export const MAX_TASK_CLICKS = 3;
