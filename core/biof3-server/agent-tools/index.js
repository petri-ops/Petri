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
  buildResultOutputText,
  emitReadOnlyResultOutput,
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
  buildResultOutputText,
  emitReadOnlyResultOutput,
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
// BLOCK-109-CORE-ARCH P2 — 工具执行元数据注册表（调度分组地基）
// BLOCK-113 W1-3 — 域映射转发（index→tool-defs 边已在 arch-cycles 基线；避免 agent-runner 直连 tool-defs 生成新环）
module.exports.DOMAIN_TOOL_DEFS = require('./tool-defs').DOMAIN_TOOL_DEFS;
module.exports.TOOL_METADATA = require('./tool-metadata').TOOL_METADATA;
module.exports.getToolMetadata = require('./tool-metadata').getToolMetadata;
module.exports.getExecutionMetadataByName = require('./tool-metadata').getToolMetadata;
module.exports.METADATA_KEYS = require('./tool-metadata').METADATA_KEYS;
module.exports.ackActToken = _ackActToken;
module.exports.pendingActAcks = _pendingActAcks;
