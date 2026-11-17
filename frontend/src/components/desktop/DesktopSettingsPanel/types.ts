import type { IconName } from '@/components/icons/Icon';

// ============================================================
// DesktopSettingsPanel — shared types
//
// Extracted from src/components/desktop/DesktopSettingsPanel.tsx
// by BLOCK-9.2 PHASE 1. Original location: lines 47-67.
//
// Contains cross-section shared types: Props / SettingsSection /
// UsageSummary + the SETTINGS_SECTIONS navigation list.
// ============================================================

export interface Props {
  onClose: () => void;
  /** BLOCK-171 CP-3 — 设置深链（?section=）初始节；缺省 general。 */
  initialSection?: SettingsSection;
  /** UI-704 加映五 — 旧深链 ?section=diagnostics 直达维护页时自动展开诊断折叠块。 */
  initialDiagnosticsOpen?: boolean;
}

export type SettingsSection =
  // BLOCK-424 信息架构拆分：外观 / 通知与桌面 / 联网与代理 从 general、compute 抽出
  | 'appearance'
  | 'desktop'
  | 'general'
  | 'models'
  | 'network'
  | 'compute'
  | 'usage'
  | 'decisions'
  | 'keymap'
  | 'reasoning'
  | 'diagnostics'
  | 'experimental'
  | 'maintenance';

/**
 * 分区层级（BLOCK-424）：`core` = 日常会用、常驻左栏；`advanced` = 低频调参向，
 * 收进左栏「高级」折叠组。
 * UI-704（设置页 IA v2，设计源 docs/settings-ia-simplification-design.md）：core
 * 收敛到 5 组（models/appearance/desktop/usage/maintenance），network/compute/keymap/
 * general 等降为高级折叠组子项（功能不删、搜索可达）；`general`（配置迁移）并入
 * maintenance，深链经 normalizeInitialSection 映射，不产生死链。
 */
export type SettingsTier = 'core' | 'advanced';

export const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  description: string;
  /**
   * 图标改用 `IconName` 全域：原先只允许 5 个字面量，13 个分区被迫循环复用，
   * 左栏出现「外观/通知与桌面/快捷键都是齿轮」「计算/联网/用量都是方块」的重复。
   * BLOCK-424：每个分区配一个语义贴切的图标，13 项互不重复。
   */
  icon: IconName;
  tier: SettingsTier;
}> = [
  { id: 'models', label: '模型接口', description: '模型、API Key 与能力渠道', icon: 'bot', tier: 'core' },
  { id: 'appearance', label: '外观', description: '主题、字号与强调色', icon: 'sun', tier: 'core' },
  { id: 'desktop', label: '通知与桌面', description: '提醒、托盘与免打扰', icon: 'bell', tier: 'core' },
  { id: 'usage', label: '用量与资源', description: '成本、缓存与本机状态', icon: 'bar-chart', tier: 'core' },
  { id: 'maintenance', label: '数据与维护', description: '数据、备份与反馈', icon: 'shield', tier: 'core' },
  { id: 'decisions', label: '治理与决策', description: 'Agent 规则、审批与审计', icon: 'zap', tier: 'advanced' },
  { id: 'reasoning', label: '推理档位', description: '思考档位与协议映射', icon: 'brain', tier: 'advanced' },
  { id: 'network', label: '联网与代理', description: '代理、证书与检索', icon: 'globe', tier: 'advanced' },
  { id: 'compute', label: '远程与计算', description: '远程目标与 Harness 环境', icon: 'database', tier: 'advanced' },
  { id: 'keymap', label: '快捷键', description: '命令键位与冲突', icon: 'key', tier: 'advanced' },
  { id: 'experimental', label: '实验特性', description: '尚未定型的开关', icon: 'sparkles', tier: 'advanced' },
];

/**
 * UI-704 — 深链归一（?section= 旧值映射，不失效）：
 *  · `general`（原「配置迁移」独立分区）→ `maintenance`（两功能已并入同一分区）；
 *  · `diagnostics`（原「运行时与诊断」独立分区）→ `maintenance`（诊断面板并入维护页折叠块）；
 *  · 其余合法 id 原样返回；非法/未知 id → undefined（调用方落默认分区）。
 * 参数收 string（URL 原始值），校验在本函数内完成——调用方无需先行断言。
 */
export function normalizeInitialSection(section?: string): SettingsSection | undefined {
  if (!section) return undefined;
  if (section === 'general' || section === 'diagnostics') return 'maintenance';
  return SETTINGS_SECTIONS.some((item) => item.id === section) ? (section as SettingsSection) : undefined;
}

export interface UsageSummary {
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  estimated_cost_cny: number;
  unknown_cost_calls: number;
  cache_hit_rate: number;
  cost_status: 'partial' | 'estimated';
  /** BLOCK-79 — 平均整次调用墙钟延迟（ms；usage-mine 返回，此前未展示） */
  avg_latency?: number;
  /** BLOCK-79 — 按供应商的输出速率分组（端到端平均口径） */
  providers?: ProviderUsageRow[];
}

/** BLOCK-79 — 单供应商聚合行（summarizeProviderUsage 输出，snake_case 由后端直出） */
export interface ProviderUsageRow {
  provider: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  measurableCalls: number;
  noUsageCalls: number;
  tokensPerSecond: number | null;
  measurable: boolean;
}
