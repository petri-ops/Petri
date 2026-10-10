/**
 * core/petri-server/mcp/ide-tools/index.js
 *
 * IDE MCP 工具集入口（Phase 1 + Phase 1.5 + Phase 3）。
 * Tools: 18 个 ide_* 工具
 *   - Phase 1: file (7) + terminal (5)
 *   - Phase 1.5: search (1) + diff (1)
 *   - Phase 3: git (4) — git_diff / git_log / git_show / git_blame
 *
 * Resources: 2 个只读数据源（resources/list + resources/read）
 *   - ide://projects
 *   - ide://git-status?path=<path>
 *
 * 暴露：
 * - getIdeToolDefinitions() → 工具定义数组（MCP tools/list）
 * - callIdeTool(name, args)  → dispatch + 审计
 * - getIdeResourceDefinitions() → 资源定义（MCP resources/list）
 * - readIdeResource(uri) → 资源读取（MCP resources/read）
 */

'use strict';

const audit = require('./audit-log');
const { fileToolDefinitions, HANDLERS: FILE_HANDLERS } = require('./file');
const { terminalToolDefinitions, HANDLERS: TERMINAL_HANDLERS } = require('./terminal');
const { searchToolDefinitions, HANDLERS: SEARCH_HANDLERS } = require('./search');
const { diffToolDefinitions, HANDLERS: DIFF_HANDLERS } = require('./diff');
const { gitDiffToolDefinitions, HANDLERS: GIT_DIFF_HANDLERS } = require('./git-diff');
const { gitLogToolDefinitions, HANDLERS: GIT_LOG_HANDLERS } = require('./git-log');
const { gitShowToolDefinitions, HANDLERS: GIT_SHOW_HANDLERS } = require('./git-show');
const { gitBlameToolDefinitions, HANDLERS: GIT_BLAME_HANDLERS } = require('./git-blame');
const {
  getIdeResourceDefinitions: getResDefs,
  readIdeResource: readRes,
  listIdeResources: listRes,
} = require('./resources');

const ALL_HANDLERS = {
  ...FILE_HANDLERS,
  ...TERMINAL_HANDLERS,
  ...SEARCH_HANDLERS,
  ...DIFF_HANDLERS,
  ...GIT_DIFF_HANDLERS,
  ...GIT_LOG_HANDLERS,
  ...GIT_SHOW_HANDLERS,
  ...GIT_BLAME_HANDLERS,
};

function getIdeToolDefinitions() {
  return [
    ...fileToolDefinitions(),
    ...terminalToolDefinitions(),
    ...searchToolDefinitions(),
    ...diffToolDefinitions(),
    ...gitDiffToolDefinitions(),
    ...gitLogToolDefinitions(),
    ...gitShowToolDefinitions(),
    ...gitBlameToolDefinitions(),
  ];
}

/**
 * 包装一层：执行 + 审计。
 * - 成功 ok=true 记 ok=true
 * - 业务返回 ok=false 记 ok=false + error
 * - 抛异常同样记 ok=false + 错误消息
 */
function wrapWithAudit(toolName, handler) {
  return async function auditedCall(args = {}) {
    const start = Date.now();
    try {
      const result = await handler(args);
      const durationMs = Date.now() - start;
      audit.record({
        tool: toolName,
        args,
        ok: result?.ok === true,
        durationMs,
        error: result?.ok === true ? null : (result?.error || 'unknown error'),
      });
      return result;
    } catch (e) {
      const durationMs = Date.now() - start;
      audit.record({
        tool: toolName,
        args,
        ok: false,
        durationMs,
        error: e.message || String(e),
      });
      return { ok: false, error: e.message || String(e) };
    }
  };
}

const AUDITED_HANDLERS = Object.fromEntries(
  Object.entries(ALL_HANDLERS).map(([name, handler]) => [name, wrapWithAudit(name, handler)])
);

async function callIdeTool(name, args) {
  const handler = AUDITED_HANDLERS[name];
  if (!handler) {
    return { ok: false, error: `unknown IDE tool: ${name}` };
  }
  return handler(args);
}

module.exports = {
  getIdeToolDefinitions,
  callIdeTool,
  // MCP Resources（Phase 1.5）
  getIdeResourceDefinitions: getResDefs,
  listIdeResources: listRes,
  readIdeResource: readRes,
  // 供测试直连（不经过审计）
  _rawHandlers: ALL_HANDLERS,
};
