/**
 * BLOCK-156 D2 — 扩展中心货架分类学（领域/通用界定单源）。
 *
 * 扩展中心 = /extensions 四货架（领域插件 / 领域技能 / 通用技能 / MCP 服务）。
 * 领域 vs 通用的界定采用 category 命名空间前缀规则，读取层判定、零 manifest 迁移：
 *   - 前缀命中 DOMAIN_CATEGORY_PREFIXES（如 `bioinformatics/ngs`）→ 领域技能
 *   - 其余（如 `coding/playbook`）→ 通用技能
 * 未来平行新增第二个领域时，向前缀表加一行即可（数据驱动，非硬编码 if）。
 */

/** 扩展中心货架 ID（URL ?tab= 的合法值域）。 */
export type ExtensionShelfId =
  | 'domain-plugins'
  | 'domain-skills'
  | 'general-skills'
  | 'mcp';

/** 技能归属的两条货架。 */
export type SkillShelfId = 'domain-skills' | 'general-skills';

/**
 * 领域 category 前缀表（D2 裁决：当前唯一领域 = 生信）。
 * 匹配规则：category === prefix 或 category 以 `${prefix}/` 开头。
 */
export const DOMAIN_CATEGORY_PREFIXES: readonly string[] = ['bioinformatics'];

/** 按 category 判定技能货架（D2 单源；前端唯一判定入口）。 */
export function classifySkillShelf(category: string): SkillShelfId {
  const hit = DOMAIN_CATEGORY_PREFIXES.some(
    (prefix) => category === prefix || category.startsWith(`${prefix}/`)
  );
  return hit ? 'domain-skills' : 'general-skills';
}

/** 货架元数据（tab 栏渲染与测试断言的数据源，顺序即展示序）。 */
export interface ExtensionShelfMeta {
  id: ExtensionShelfId;
  label: string;
  description: string;
}

export const EXTENSION_SHELVES: readonly ExtensionShelfMeta[] = [
  {
    id: 'domain-plugins',
    label: '领域插件',
    description: '生信分析工具与领域包（运行时 / 分析插件）',
  },
  {
    id: 'domain-skills',
    label: '领域技能',
    description: '生信分析方法论与流程',
  },
  {
    id: 'general-skills',
    label: '通用技能',
    description: '不绑领域的方法论（编码 / 通用 playbook）',
  },
  {
    id: 'mcp',
    label: 'MCP 服务',
    description: '第三方 MCP server 接入（应用作为 MCP 客户端）',
  },
];

/** URL tab 参数守卫：非合法值一律回落首货架（fail-closed）。 */
export function isExtensionShelfId(value: string): value is ExtensionShelfId {
  return EXTENSION_SHELVES.some((shelf) => shelf.id === value);
}
