/**
 * BLOCK-394 B-20 — goldenPath.tool 的结构化能力声明解析（替换源码 includes 扫描）。
 *
 * 为什么换：旧断言用 readFileSync(...).includes(toolId) 扫 resources/skills 各子目录下的 manifest.json，
 * 而这 11 个目录**全无独立 manifest.json**（真相在顶层 resources/skills/manifest.json
 * 与兄弟仓 petri-pack-bio/registry/tool-registry.json）。includes 既扫不到真声明，
 * 又会把「注释里提到工具名」误判为绿——是典型扫描式假契约。
 *
 * 现在按 JSON 解析后的字段逐一核对：顶层 manifest 的 skills[*].capabilities /
 * 兄弟仓 registry 的 TOOLS 键（真实工具定义对象），并返回命中来源供审计。
 * 纯函数、不读盘（调用方读盘后传入），可离线负测。
 *
 * @param {string} toolId
 * @param {{ skillsManifest?: object, packRegistry?: object }} sources
 * @returns {{ ok: boolean, hits: string[] }}
 */
export function findToolDeclarations(toolId, { skillsManifest, packRegistry } = {}) {
  const hits = [];
  if (!toolId || typeof toolId !== 'string') return { ok: false, hits };
  const skills = skillsManifest && typeof skillsManifest.skills === 'object' ? skillsManifest.skills : {};
  for (const [id, entry] of Object.entries(skills)) {
    const caps = Array.isArray(entry && entry.capabilities) ? entry.capabilities : [];
    // 真实字段命中：capabilities 显式列出，或 skill id 本身即该工具
    if (caps.includes(toolId) || id === toolId) hits.push(`skills:${id}`);
  }
  const tools = packRegistry && typeof packRegistry.TOOLS === 'object' ? packRegistry.TOOLS : {};
  if (Object.prototype.hasOwnProperty.call(tools, toolId) && tools[toolId] && typeof tools[toolId] === 'object') {
    hits.push('pack:TOOLS');
  }
  return { ok: hits.length > 0, hits };
}
