/**
 * tool-registry.js — TOOL_REGISTRY_v1（BLOCK-83 P4 中性化）
 *
 * 机制 = 核心职责：工具元数据注册表容器 + 查询接口（resolveToolId / getToolConfig /
 * listTools / listCsvTools / getToolSizeLimitMB）。消费方（learning.js / tools-executor.js /
 * mcp/registry.js / routes/tools.js）接口零改动。
 *
 * 数据 = 领域职责：工具条目（deseq2 / go-kegg / ...）随领域包交付。本注册表从
 *  指向的 JSON 惰性加载；未设置或文件缺失 = 空注册表
 * （无领域包安装态），不内联任何领域工具。
 *
 * 领域包作者：导出 { TOOLS: { <id>: { displayName, script, lang, pluginOnly?, description,
 * csvInputs?, sizeLimitMB? } }, TOOL_ALIASES? } 形状的 JSON，并设置该环境变量指向它。
 */

const fs = require('fs');

const REGISTRY_FILE = process.env.BIOF3_DOMAIN_TOOL_REGISTRY || '';

function _loadDomainEntries() {
  if (!REGISTRY_FILE || !fs.existsSync(REGISTRY_FILE)) {
    return { TOOLS: {}, TOOL_ALIASES: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8'));
    return {
      TOOLS: parsed.TOOLS && typeof parsed.TOOLS === 'object' ? parsed.TOOLS : {},
      TOOL_ALIASES: parsed.TOOL_ALIASES && typeof parsed.TOOL_ALIASES === 'object' ? parsed.TOOL_ALIASES : {},
    };
  } catch {
    console.warn();
    return { TOOLS: {}, TOOL_ALIASES: {} };
  }
}

const _domain = _loadDomainEntries();
const TOOLS = { ..._domain.TOOLS };

// Backward compatibility aliases (for old job records / external links)
const TOOL_ALIASES = { ..._domain.TOOL_ALIASES };

/** Resolve a tool id (handling aliases). Returns the canonical id, or null if unknown. */
function resolveToolId(toolId) {
  if (!toolId) return null;
  const aliased = TOOL_ALIASES[toolId] || toolId;
  return TOOLS[aliased] ? aliased : null;
}

/** Get full config for a tool (resolves aliases). Null if unknown. */
function getToolConfig(toolId) {
  const id = resolveToolId(toolId);
  return id ? {...TOOLS[id], id} : null;
}

/** Display label for a tool (handles aliases + falls back to id). */
function getToolDisplayName(toolId) {
  const cfg = getToolConfig(toolId);
  return cfg ? cfg.displayName : toolId;
}

/** All canonical tool ids (sorted). Use this when you need to list everything. */
function listToolIds() {
  return Object.keys(TOOLS).sort();
}

/** All tools with their full config (for UI / AI context / validation). */
function listTools() {
  return Object.entries(TOOLS).map(([id, cfg]) => ({id, ...cfg}));
}

/** Tools that accept CSV/TSV inputs (used by tools.js validateUploadedFiles). */
function listCsvTools() {
  return Object.entries(TOOLS)
    .filter(([_, cfg]) => Array.isArray(cfg.csvInputs) && cfg.csvInputs.length > 0)
    .map(([id]) => id);
}

/** Per-tool size limit in MB (defaults to 100). */
function getToolSizeLimitMB(toolId) {
  const cfg = getToolConfig(toolId);
  return cfg ? (cfg.sizeLimitMB || 100) : 100;
}

/** 
 * BLOCK-84：领域包 boot 接线——server 启动时为每个已装包注册其 registry JSON。
 * 同 id 条目后来者覆盖；TOOL_ALIASES 合并。文件缺失/坏 JSON=跳过不阻塞。
 */
function registerDomainToolsFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'registry_file_missing' };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    let merged = 0;
    for (const [id, cfg] of Object.entries(parsed.TOOLS || {})) { TOOLS[id] = cfg; merged += 1; }
    for (const [alias, target] of Object.entries(parsed.TOOL_ALIASES || {})) { TOOL_ALIASES[alias] = target; }
    return { ok: true, merged };
  } catch (error) {
    return { ok: false, error: 'registry_file_invalid:' + error.message };
  }
}

module.exports = {
  registerDomainToolsFile,
  TOOLS,
  TOOL_ALIASES,
  resolveToolId,
  getToolConfig,
  getToolDisplayName,
  listToolIds,
  listTools,
  listCsvTools,
  getToolSizeLimitMB,
};
