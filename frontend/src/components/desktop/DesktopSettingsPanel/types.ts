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
 * 分区层级（BLOCK-424）：`core` = 日常会用、常驻左栏；`advanced` = 开发者/高频调参向，
 * 收进左栏「高级」折叠组，默认不展开。判据来自 2026-11-11 实机盘点：
 * 决策原语 29 输入 / 118 下拉 / 9152 字符、运行时与诊断 8846 字符，均属绝大多数用户
 * 不需要关注与点击的面。
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
  { id: 'appearance', label: '外观', description: '主题、字号与动效', icon: 'sun', tier: 'core' },
  { id: 'desktop', label: '通知与桌面', description: '通知、托盘与免打扰', icon: 'bell', tier: 'core' },
  { id: 'models', label: '模型接口', description: 'URL、模型与 Key', icon: 'bot', tier: 'core' },
  { id: 'network', label: '联网与代理', description: '代理、证书与检索', icon: 'globe', tier: 'core' },
  { id: 'compute', label: '计算与数据', description: '存储、远程目标与回收站', icon: 'database', tier: 'core' },
  { id: 'usage', label: '用量与资源', description: '成本、缓存与机器状态', icon: 'bar-chart', tier: 'core' },
  { id: 'keymap', label: '快捷键', description: '命令键位与冲突', icon: 'key', tier: 'core' },
  { id: 'general', label: '配置迁移', description: '从外部 Agent 导入', icon: 'download', tier: 'core' },
  { id: 'maintenance', label: '隐私与维护', description: '反馈、更新与备份', icon: 'shield', tier: 'core' },
  { id: 'decisions', label: '决策原语', description: '决策接点、审批与编排', icon: 'zap', tier: 'advanced' },
  { id: 'reasoning', label: '推理档位', description: '思考档位与协议映射', icon: 'brain', tier: 'advanced' },
  { id: 'experimental', label: '实验特性', description: '尚未定型的开关', icon: 'sparkles', tier: 'advanced' },
  { id: 'diagnostics', label: '运行时与诊断', description: '服务、运行时与日志', icon: 'terminal', tier: 'advanced' },
];

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
