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
  } catch (error) {
    console.warn();
    return { TOOLS: {}, TOOL_ALIASES: {} };
  }
}

const _domain = _loadDomainEntries();
const TOOLS = Object.freeze({ ..._domain.TOOLS });

// Backward compatibility aliases (for old job records / external links)
const TOOL_ALIASES = Object.freeze({ ..._domain.TOOL_ALIASES });

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

module.exports = {
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
