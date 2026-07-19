/**
 * agent-tools/index.js — Entry point for AI agent tool system.
 *
 * Re-exports getToolDefs() and dispatchTool() which are the only public API
 * consumed by routes/ai-agent.js.
 *
 * Also exports ackActToken + pendingActAcks for server.js act-ack endpoint.
 */

const { getToolDefs } = require('./tool-defs');
const { tool_query, tool_read_page, tool_search } = require('./query-tools');
const { tool_act, _ackActToken, _pendingActAcks } = require('./act-tools');
const { tool_plan } = require('./plan-ui-tools');
const {
  tool_discover_capabilities,
  tool_act_generic,
  tool_run_tool,
  tool_generate_methods,
  tool_suggest_next_steps,
  tool_verify_understanding,
  tool_suggest_review,
  tool_record_learning_signal,
} = require('./learning');
const { tool_verify_state } = require('./verify-dispatch');
const { tool_read_image } = require('./vision-tools');
const { inferExecutionPolicy } = require('../helpers/agent-execution-policy');
const {
  tool_workspace_list,
  tool_workspace_find,
  tool_workspace_search,
  tool_workspace_read,
  tool_workspace_write,
  tool_workspace_replace,
  tool_workspace_exec,
} = require('./workspace-tools');

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
  switch (name) {
    case 'query':
      return tool_query(argsObj, ctx);
    case 'read_page':
      return tool_read_page(argsObj, ctx);
    case 'search':
      return tool_search(argsObj, ctx);
    case 'act':
      return tool_act(argsObj, ctx);
    case 'plan':
      return tool_plan(argsObj, ctx);
    case 'verify_state':
      return tool_verify_state(argsObj, ctx);
    case 'discover_capabilities':
      return tool_discover_capabilities(argsObj, ctx);
    case 'act_generic':
      return tool_act_generic(argsObj, ctx);
    case 'run_tool':
      return tool_run_tool(argsObj, ctx);
    case 'read_image':
      return tool_read_image(argsObj, ctx);
    case 'generate_methods':
      return tool_generate_methods(argsObj, ctx);
    case 'suggest_next_steps':
      return tool_suggest_next_steps(argsObj, ctx);
    case 'verify_understanding':
      return tool_verify_understanding(argsObj, ctx);
    case 'suggest_review':
      return tool_suggest_review(argsObj, ctx);
    case 'record_learning_signal':
      return tool_record_learning_signal(argsObj, ctx);
    case 'workspace_list':
      return tool_workspace_list(argsObj, ctx);
    case 'workspace_find':
      return tool_workspace_find(argsObj, ctx);
    case 'workspace_search':
      return tool_workspace_search(argsObj, ctx);
    case 'workspace_read':
      return tool_workspace_read(argsObj, ctx);
    case 'workspace_write':
      return tool_workspace_write(argsObj, ctx);
    case 'workspace_replace':
      return tool_workspace_replace(argsObj, ctx);
    case 'workspace_exec':
      return tool_workspace_exec(argsObj, ctx);
    default:
      return { error: 'unknown_tool', message: '未知工具: ' + name };
  }
}

module.exports = { getToolDefs, dispatchTool, inferExecutionPolicy };
module.exports.ackActToken = _ackActToken;
module.exports.pendingActAcks = _pendingActAcks;
