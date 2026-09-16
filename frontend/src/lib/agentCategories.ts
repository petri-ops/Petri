// ============================================================
// agentCategories — UI-387：子智能体职能类别（图标区分）。
//
// 形状=职能、颜色=状态：图标由任务文本推断的类别决定（检索/搜集/整理/
// 读取/分析/通用），运行状态仍由既有 status 配色表达，两个维度不混用。
//
// 推断是纯前端启发式（关键词首匹配，序即优先级），对历史任务零迁移即可
// 生效；BLOCK-93（智能体专职化）落地 spawn 角色参数后，显式角色将取代
// 文本推断成为第一优先数据源。
// ============================================================
import type { IconName } from '@/components/icons/Icon';

export interface AgentCategory {
  key: 'search' | 'collect' | 'organize' | 'read' | 'analysis' | 'general';
  label: string;
  icon: IconName;
}

/** 类别表：顺序即关键词首匹配优先级（具体在前，通用兜底在最后）。 */
export const AGENT_CATEGORIES: readonly AgentCategory[] = [
  { key: 'search', label: '检索', icon: 'search', },
  { key: 'collect', label: '搜集', icon: 'globe' },
  { key: 'organize', label: '整理', icon: 'folder' },
  { key: 'read', label: '读取', icon: 'file' },
  { key: 'analysis', label: '分析', icon: 'bar-chart' },
  { key: 'general', label: '通用', icon: 'bot' },
] as const;

const KEYWORDS: ReadonlyArray<readonly string[]> = [
  ['检索', '搜索', '查找', '查询', '搜寻'],
  ['搜集', '收集', '采集', '抓取'],
  ['整理', '归纳', '分类', '归档', '清理', '组织'],
  ['读取', '阅读', '读一下', '查看', '浏览', '读出'],
  ['分析', '统计', '对比', '核对', '计算', '验证', '评估'],
];

/** 从任务文本推断职能类别；空文本 / 无命中 → 通用（bot）。 */
export function inferAgentCategory(taskText: string | null | undefined): AgentCategory {
  const text = String(taskText || '');
  if (!text) return AGENT_CATEGORIES[AGENT_CATEGORIES.length - 1];
  for (let i = 0; i < KEYWORDS.length; i += 1) {
    if (KEYWORDS[i].some((k) => text.includes(k))) {
      return AGENT_CATEGORIES[i];
    }
  }
  return AGENT_CATEGORIES[AGENT_CATEGORIES.length - 1];
}
