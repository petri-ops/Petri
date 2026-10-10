// ============================================================
// slashSources — 斜杠菜单动态数据源（BLOCK-160 W2 P3/KNW-3）
//
// 在既有 UI 动作命令（SLASH_COMMANDS：新建/清空/切模型/导出/帮助）之外，
// 注入两个**执行意图**来源：
//   ① 产品 Skills（/skill-id）——选中注入「读手册按手册执行」结构化模板；
//   ② run_tool 工作流模板（/tpl:template-id）——选中注入「规划标准流程」模板。
// 选中即向 composer 注入文本模板（v1 预裁决：不自动跳页、不自动执行）；
// 结构化 chip 注入通道留 v2。
// ============================================================

import { getBridge } from '@/lib/desktopBridge';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

export interface SlashEntry {
  kind: 'action' | 'skill' | 'template';
  id: string;
  label: string;
  description: string;
}

const CACHE_TTL_MS = 60_000;
let cache: { entries: SlashEntry[]; loadedAt: number } = { entries: [], loadedAt: 0 };
/** 产品 Skills → /<skill-id> 条目（bridge discover；不可用=空）。 */
export function buildSkillEntries(skills: Array<{ id: string; name: string; description: string; category?: string }>): SlashEntry[] {
  return skills.map((skill) => ({
    kind: 'skill',
    id: skill.id,
    label: `${skill.name}（${skill.category}）`,
    description: skill.description || `产品技能 ${skill.id}`,
  }));
}

/** run_tool 工作流模板 → /tpl:<template-id> 条目。 */
export function buildTemplateEntries(templates: Array<{ id: string; title: string; description?: string; available?: boolean }>): SlashEntry[] {
  return templates.map((tpl) => ({
    kind: 'template',
    id: tpl.id,
    label: `${tpl.title}（${tpl.available === false ? '部分工具未激活' : '可规划'}）`,
    description: tpl.description || `工作流模板 ${tpl.id}`,
  }));
}

/** 拉取动态条目（Skills + 模板；60s 模块缓存；任一源失败=该源空，不互拖）。 */
export async function fetchSlashEntries(): Promise<SlashEntry[]> {
  if (cache.entries.length > 0 && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.entries;
  }
  const results = await Promise.allSettled([
    (async () => {
      const bridge = getBridge('skills');
      if (!bridge?.discover) return [];
      const result = await bridge.discover();
      return result.ok && Array.isArray(result.skills) ? buildSkillEntries(result.skills) : [];
    })(),
    (async () => {
      const response = await fetch(`${getPlatformApiPrefix()}/tools/workflow-templates`, {
        headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : undefined,
      });
      const data = (await response.json()) as { status?: string; templates?: Array<{ id: string; title: string; description?: string; available?: boolean }> };
      return data?.status === 'ok' && Array.isArray(data.templates) ? buildTemplateEntries(data.templates) : [];
    })(),
  ]);
  const entries = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  cache = { entries, loadedAt: Date.now() };
  return entries;
}

/** 纯函数过滤：query 匹配 label/id/description（大小写不敏感）。 */
export function filterSlashEntries(
  entries: SlashEntry[],
  query: string,
): SlashEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((entry) =>
    entry.label.toLowerCase().includes(q)
    || entry.id.toLowerCase().includes(q)
    || entry.description.toLowerCase().includes(q)
  );
}

/** 选中注入的文本模板（v1=文本模板注入 composer；结构化 chip 留 v2）。 */
export function slashIntentTemplate(entry: SlashEntry): string {
  if (entry.kind === 'skill') {
    return `请使用产品技能「${entry.id}」：先用 skill_get 读取该技能的手册，然后严格按手册的步骤与参数约定执行。我的任务：`;
  }
  if (entry.kind === 'template') {
    return `请用 run_tool 规划标准流程（op="plan", templateId="${entry.id}"）：`;
  }
  return '';
}
