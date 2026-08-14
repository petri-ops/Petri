/**
 * core/r-server/mcp/ide-tools/index.js
 *
 * IDE MCP 工具集入口（Phase 1：文件 + 终端）。
 * 暴露：
 * - getIdeToolDefinitions()  → 数组，追加到 MCP listTools()
 * - callIdeTool(name, args)  → dispatch 到 file / terminal handler
 * - wrapWithAudit(tool, handler) → 包装一层审计日志
 *
 * 后续 Phase 2 / Phase 3 编辑器 / 搜索 / Git 工具在此扩展。
 */

'use strict';

const audit = require('./audit-log');
const { fileToolDefinitions, HANDLERS: FILE_HANDLERS } = require('./file');
const { terminalToolDefinitions, HANDLERS: TERMINAL_HANDLERS } = require('./terminal');

const ALL_HANDLERS = { ...FILE_HANDLERS, ...TERMINAL_HANDLERS };

function getIdeToolDefinitions() {
  return [
    ...fileToolDefinitions(),
    ...terminalToolDefinitions(),
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
  // 供测试直连（不经过审计）
  _rawHandlers: ALL_HANDLERS,
};
