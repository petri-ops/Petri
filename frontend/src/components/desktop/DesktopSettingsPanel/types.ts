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
}

export type SettingsSection =
  | 'general'
  | 'models'
  | 'compute'
  | 'usage'
  | 'experimental'
  | 'maintenance';

export const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  description: string;
  icon: 'settings' | 'brain' | 'cpu' | 'wrench' | 'flag';
}> = [
  { id: 'general', label: '常规', description: '外观与应用偏好', icon: 'settings' },
  { id: 'models', label: '模型接口', description: 'URL、模型与 Key', icon: 'brain' },
  { id: 'compute', label: '计算与数据', description: '执行位置与存储', icon: 'cpu' },
  { id: 'usage', label: '用量与资源', description: '成本、缓存与机器状态', icon: 'cpu' },
  { id: 'experimental', label: '实验特性', description: 'Agent 工作台等实验开关', icon: 'flag' },
  { id: 'maintenance', label: '隐私与维护', description: '反馈、诊断与更新', icon: 'wrench' },
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
