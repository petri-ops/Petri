/**
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
  createModelResultState,
  createRejectedToolResult,
  executeToolCall,
  replaceToolResultData,
  serializeToolResultForModel,
} = require('./tool-execution');
const {
  MAX_AGENT_ITERS,
  MAX_AGENT_TOOL_ITERS,
  MAX_AGENT_TOOL_CALLS,
  MAX_IDENTICAL_TOOL_CALLS,
  MAX_FINALIZATION_ATTEMPTS,
  MAX_CONTINUATION_CHAINS,
  MAX_CONTINUATION_TOKENS,
  shouldFinalizeAgentIteration,
  assessFinalizationResult,
  buildFinalizationRetryRequest,
  buildFinalizationFallbackMessage,
  finalizationFallbackReason,
  createAgentProgressRecorder,
  createContinuationGuard,
  createResultEditCompletionGuard,
  createAgentToolCallController,
  runAgentToolCallBatch,
} = require('./agent-loop-control');
const {
  buildToolCallEvent,
  buildToolOutputEvent,
  buildToolResultEvent,
  createToolOutputStream,
  createToolActivityRecorder,
} = require('./tool-events');
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
  createModelResultState,
  createRejectedToolResult,
  executeToolCall,
  replaceToolResultData,
  serializeToolResultForModel,
  buildToolCallEvent,
  buildToolOutputEvent,
  buildToolResultEvent,
  createToolOutputStream,
  createToolActivityRecorder,
  MAX_AGENT_ITERS,
  MAX_AGENT_TOOL_ITERS,
  MAX_AGENT_TOOL_CALLS,
  MAX_IDENTICAL_TOOL_CALLS,
  MAX_FINALIZATION_ATTEMPTS,
  MAX_CONTINUATION_CHAINS,
  MAX_CONTINUATION_TOKENS,
  shouldFinalizeAgentIteration,
  assessFinalizationResult,
  buildFinalizationRetryRequest,
  buildFinalizationFallbackMessage,
  finalizationFallbackReason,
  createAgentProgressRecorder,
  createContinuationGuard,
  createResultEditCompletionGuard,
  createAgentToolCallController,
  runAgentToolCallBatch,
};
module.exports.ackActToken = _ackActToken;
module.exports.pendingActAcks = _pendingActAcks;
