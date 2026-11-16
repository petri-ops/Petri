/**
 * settingsSearch — 设置面板的搜索索引与过滤（BLOCK-201 W2 / P0-3）。
 *
 * 设计边界（刻意的）：
 *  · **只做分区级过滤**，不做"设置项级"跳转：面板里 10 个分区的字段形态各异，
 *    为一个搜索框去给每个字段建第二份描述表，等于把设置面复制一遍（负改善）。
 *  · 索引与 `SETTINGS_SECTIONS` 的 id/label/description **逐项相等**，由
 *    `settingsSearch.test.ts` 与 `block201-settings-baseline.test.mjs` 双向钉——
 *    新增分区忘了补索引会红，而不是"搜不到但没人知道"。
 *  · 纯函数、零依赖、零 IO：匹配规则可被单测穷举。
 */

export type SettingsSectionId =
  | 'appearance'
  | 'desktop'
  | 'models'
  | 'network'
  | 'compute'
  | 'usage'
  | 'keymap'
  | 'general'
  | 'maintenance'
  | 'decisions'
  | 'reasoning'
  | 'experimental'
  | 'diagnostics';

export interface SettingsSearchEntry {
  id: SettingsSectionId;
  label: string;
  description: string;
  /** 用户可能用的同义词（含英文），只做匹配，不显示。 */
  keywords: string[];
}

export const SETTINGS_SEARCH_INDEX: readonly SettingsSearchEntry[] = Object.freeze([
  {
    id: 'models',
    label: '模型接口',
    description: '模型、API Key 与能力渠道',
    keywords: ['模型', '接口', '渠道', 'api', 'key', 'endpoint', 'provider', 'vision', '视觉', 'ocr', '搜索', '检索后端', '能力渠道'],
  },  {
    id: 'appearance',
    label: '外观',
    description: '主题、字号与强调色',
    keywords: ['主题', '外观', '字号', '界面', '主题色', '动效', '缩放', 'theme', 'appearance', 'font', 'accent', 'motion'],
  },  {
    id: 'desktop',
    label: '通知与桌面',
    description: '提醒、托盘与免打扰',
    keywords: ['通知', '托盘', '免打扰', '桌面', '关闭窗口', 'notification', 'tray', 'dock', 'dnd'],
  },  {
    id: 'usage',
    label: '用量与资源',
    description: '成本、缓存与本机状态',
    keywords: ['用量', '成本', '费用', '缓存', '资源', 'token', 'cost', 'usage', '上限'],
  },  {
    // UI-704 — general（配置迁移）并入 maintenance：其搜索关键词随迁（搜索可达不回退）。
    id: 'maintenance',
    label: '数据与维护',
    description: '数据、备份与反馈',
    keywords: ['隐私', '维护', '反馈', '更新', '备份', '导出', '导入', '迁移', '配置', '外部', 'codex', 'zcode', 'toml', 'json', 'config', 'feedback', 'update', '诊断', '数据'],
  },  {
    id: 'decisions',
    label: '治理与决策',
    description: 'Agent 规则、审批与审计',
    keywords: ['决策', '阈值', '接点', '审批', '编排', '治理', '规则', '审计', '记忆', 'judge', 'decision', 'threshold', '路由', '校准'],
  },  {
    id: 'reasoning',
    label: '推理档位',
    description: '思考档位与协议映射',
    keywords: ['推理', '档位', '思考', 'reasoning', 'effort', 'thinking', '预算', 'budget'],
  },  {
    id: 'network',
    label: '联网与代理',
    description: '代理、证书与检索',
    keywords: ['联网', '网络', '代理', '证书', '检索', '抓取', '白名单', 'proxy', 'ca', 'web', 'search', 'http'],
  },  {
    id: 'compute',
    label: '远程与计算',
    description: '远程目标与 Harness 环境',
    keywords: ['计算', '远程', 'ssh', '联邦', '回收站', 'runtime', 'python', 'r', '工具包', 'harness', '数据管理'],
  },  {
    id: 'keymap',
    label: '快捷键',
    description: '命令键位与冲突',
    keywords: ['快捷键', '键位', '键盘', '冲突', 'keymap', 'shortcut', 'hotkey', '命令'],
  },  {
    id: 'diagnostics',
    label: '运行时与诊断',
    description: '服务、运行时与日志',
    keywords: ['诊断', '日志', '运行时', '服务', '后端', 'backend', 'runtime', '进程'],
  },  {
    id: 'experimental',
    label: '实验特性',
    description: '尚未定型的开关',
    keywords: ['实验', '开关', '特性', 'flag', 'feature', '工作台', 'agent'],
  },]);

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
/** 单条目打分：label 命中权重最高，keywords 次之，description 最低；0=不命中。 */
function scoreEntry(entry: SettingsSearchEntry, tokens: string[]): number {
  const label = normalize(entry.label);
  const description = normalize(entry.description);
  const keywords = entry.keywords.map(normalize);
  let score = 0;
  for (const token of tokens) {
    let tokenScore = 0;
    if (label === token) tokenScore = 6;
    else if (label.includes(token)) tokenScore = 5;
    else if (keywords.some((keyword) => keyword.includes(token))) tokenScore = 3;
    else if (description.includes(token)) tokenScore = 1;
    if (tokenScore === 0) return 0; // 多词查询按 AND：任一 token 未命中即整条不命中
    score += tokenScore;
  }
  return score;
}

/** 过滤分区：空查询返回全部（保持索引顺序），否则按得分降序、同分保持索引顺序。 */
export function filterSettingsSections(query: string): SettingsSectionId[] {
  const normalized = normalize(query);
  if (normalized === '') return SETTINGS_SEARCH_INDEX.map((entry) => entry.id);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return SETTINGS_SEARCH_INDEX
    .map((entry, index) => ({ entry, index, score: scoreEntry(entry, tokens) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((row) => row.entry.id);
}

/** 该分区是否命中当前查询（供导航高亮/空态判定）。 */
export function isSettingsSectionMatch(id: SettingsSectionId, query: string): boolean {
  return filterSettingsSections(query).includes(id);
}
