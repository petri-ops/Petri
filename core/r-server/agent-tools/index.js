/**
 * agent-tools/index.js — Entry point for AI agent tool system.
 *
 * Re-exports getToolDefs() and dispatchTool() which are the only public API
 * consumed by routes/ai-agent.js.
 *
 * Also exports ackActToken + pendingActAcks for server.js act-ack endpoint.
 */

const { getToolDefs } = require('./tool-defs');
const { _ackActToken, _pendingActAcks } = require('./act-tools');
const { getToolHandler } = require('./registry');
const { inferExecutionPolicy } = require('../helpers/agent-execution-policy');

const MUTATING_WORKSPACE_TOOLS = new Set([
  'workspace_write',
  'workspace_replace',
  'workspace_exec',
]);

async function dispatchTool(name, argsObj, ctx = {}) {
  const isAnalysisRun = name === 'run_tool' && argsObj && argsObj.op === 'run';
  if ((isAnalysisRun || MUTATING_WORKSPACE_TOOLS.has(name)) && ctx.allowExecution === false) {
    return {
      ok: false,
      error: 'execution_not_allowed',
      message: '用户当前明确要求只检查或规划，禁止执行分析、修改文件或运行命令。',
      reason: ctx.executionPolicyReason || 'explicit_read_only_request',
    };
  }
  if (MUTATING_WORKSPACE_TOOLS.has(name) && ctx.accessMode === 'read') {
    return {
      ok: false,
      error: 'access_mode_read_only',
      message: '聊天当前处于只读模式，禁止修改项目文件或运行命令。',
    };
  }
  const handler = getToolHandler(name);
  if (!handler) return { error: 'unknown_tool', message: '未知工具: ' + name };
  return handler(argsObj, ctx);
}

module.exports = { getToolDefs, dispatchTool, inferExecutionPolicy };
module.exports.ackActToken = _ackActToken;
module.exports.pendingActAcks = _pendingActAcks;
