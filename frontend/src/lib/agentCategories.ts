// ============================================================
// agentCategories — UI-387：子智能体职能类别（图标区分）。
//
// 形状=职能、颜色=状态：图标由类别决定（检索/搜集/整理/读取/分析/通用 +
// BLOCK-93 四扩展：测试/写作/规划/修复），运行状态仍由既有 status 配色表达，
// 两个维度不混用。
//
// 数据源两级（BLOCK-93 P1 起生效）：
//   1. 显式 spawn role（服务端 agent-roles.js 注册表落库，key 与本表对齐）—
//      第一优先，getAgentCategoryByKey 直查；
//   2. 文本推断（关键词首匹配，序即优先级）— 无显式角色时的兜底（含全部
//      历史任务，零迁移生效）。
// 角色职责描述与 prompt 指令片段的服务端单一事实源 = agent-roles.js，本表
// 只承载呈现面（label/emoji）。
// ============================================================
export interface AgentCategory {
  key:
    | 'search'
    | 'collect'
    | 'organize'
    | 'read'
    | 'analysis'
    | 'general'
    | 'test'
    | 'write'
    | 'plan'
    | 'fix'
    | 'investigator';
  label: string;
  /** 彩色 emoji 图标（用户裁决：比单色线条图标生动直观）。 */
  emoji: string;
}

/** 类别表：顺序即关键词首匹配优先级（具体在前，通用兜底在最后）。 */
export const AGENT_CATEGORIES: readonly AgentCategory[] = [
  { key: 'search', label: '检索', emoji: '🔍' },
  { key: 'collect', label: '搜集', emoji: '🌐' },
  { key: 'organize', label: '整理', emoji: '📁' },
  { key: 'read', label: '读取', emoji: '📄' },
  { key: 'analysis', label: '分析', emoji: '📊' },
  { key: 'test', label: '测试', emoji: '🧪' },
  { key: 'write', label: '写作', emoji: '✍️' },
  { key: 'plan', label: '规划', emoji: '🗺️' },
  { key: 'fix', label: '修复', emoji: '🔧' },
  { key: 'investigator', label: '调查员', emoji: '🔬' },
  { key: 'general', label: '通用', emoji: '🤖' },
] as const;

const KEYWORDS: ReadonlyArray<readonly string[]> = [
  ['检索', '搜索', '查找', '查询', '搜寻'],
  ['搜集', '收集', '采集', '抓取'],
  ['整理', '归纳', '分类', '归档', '清理', '组织'],
  ['读取', '阅读', '读一下', '查看', '浏览', '读出'],
  ['分析', '统计', '对比', '核对', '计算', '验证', '评估'],
  ['测试', '用例', '跑一下测试', '回归'],
  ['写作', '撰写', '起草', '成文', '写文档', '写说明'],
  ['规划', '拆解', '方案', '计划', '排期'],
  ['修复', '修一下', '修好', '缺陷', 'bug', '报错排查'],
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

/** 显式 spawn role（服务端注册表 key）→ 类别；未知 key → null（交回推断兜底）。 */
export function getAgentCategoryByKey(key: string | null | undefined): AgentCategory | null {
  const normalized = String(key || '').trim();
  if (!normalized) return null;
  return AGENT_CATEGORIES.find((c) => c.key === normalized) || null;
}

/**
 * BLOCK-93 P2 — 类别解析统一入口：显式 role 第一优先，文本推断兜底。
 * 三处消费面（内联实况卡 / 右栏面板头 / 摘要卡图标带）共用，保证同真值一张皮。
 */
export function resolveAgentCategory(
  role: string | null | undefined,
  taskText: string | null | undefined,
): AgentCategory {
  return getAgentCategoryByKey(role) ?? inferAgentCategory(taskText);
}
