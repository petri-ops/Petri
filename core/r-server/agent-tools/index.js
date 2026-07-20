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
const { interceptAgentToolCall } = require('./agent-tool-interceptor');
const {
  createCallId,
  createTraceId,
  executeToolCall,
  replaceToolResultData,
  serializeToolResultForModel,
} = require('./tool-execution');
const { buildToolCallEvent, buildToolResultEvent } = require('./tool-events');
const { inferExecutionPolicy } = require('../helpers/agent-execution-policy');

async function dispatchTool(name, argsObj, ctx = {}) {
  return interceptAgentToolCall(name, argsObj, ctx);
}

module.exports = {
  getToolDefs,
  dispatchTool,
  inferExecutionPolicy,
  createCallId,
  createTraceId,
  executeToolCall,
  replaceToolResultData,
  serializeToolResultForModel,
  buildToolCallEvent,
  buildToolResultEvent,
};
module.exports.ackActToken = _ackActToken;
module.exports.pendingActAcks = _pendingActAcks;
