/**
 * routes/ai-agent.js — POST /api/ai/agent (multi-turn tool-calling agent)
 *
 * Migrated from server.js. AGENT_TOOLS_v1.
 *
 * PHASE 2.2b: thin facade — delegates to ai-agent/index subdomains.
 * Original 1222-line module.exports body下沉到 5 个子域：
 *   chat.js     — POST /api/ai/agent (task 模式 + legacy SSE handler)
 *   context.js  — POST /api/ai/agent/task/:taskId/cancel
 *   events.js   — GET  /api/ai/agent/task/:taskId (SSE 订阅)
 *   tools.js    — 占位（无独立端点）
 *   index.js    — facade 注册中心
 */

const express = require('express');

// Helpers
const { buildSystemPrompt, localizeToolResult } = require('../helpers/system-prompt');
const { appendDesktopAgentInstructions } = require('../helpers/desktop-agent-prompt');
const { renderPluginDemoPathsForPrompt } = require('../helpers/plugin-demo-prompt');
const { callChatProvider } = require('../helpers/llm-client');
const { buildSiteSnapshotAsync, renderSiteSnapshotForPrompt } = require('../helpers/site-snapshot');
const { buildFactsBlockAsync, backgroundExtractFacts } = require('../helpers/user-facts');
const {
  _getChatSummary,
  getChatSummaryAsync,
  summarizeMessages,
} = require('../helpers/chat-summary');
const { getActivePlanForUserAsync, renderActivePlanForPrompt } = require('../helpers/plans');
const dbMod = require('../db');
const convSync = require('../helpers/conversations');
const {
  getOrCreateActiveConversation,
  appendMessageToConversation,
  _maybeAutoTitleConversation,
  _maybeDetectTopicShift,
} = convSync;
const { logChatAudit } = require('../helpers/memory-privacy');
const {
  dashscopeEmbed,
  saveMemoryVector,
  cosineSim,
  MAX_CONTENT_LEN,
} = require('../helpers/memory-vectors');
const {
  aiConcurrencyAcquire,
  aiConcurrencyRelease,
} = require('../helpers/runtime');

// Agent tools
const {
  getToolDefs,
  createCallId,
  createTraceId,
  createModelResultState,
  createRejectedToolResult,
  executeToolCall,
  replaceToolResultData,
  serializeToolResultForModel,
  buildToolCallEvent,
  buildToolResultEvent,
  createToolActivityRecorder,
  MAX_AGENT_ITERS,
  MAX_AGENT_TOOL_CALLS,
  MAX_FINALIZATION_ATTEMPTS,
  shouldFinalizeAgentIteration,
  assessFinalizationResult,
  buildFinalizationRetryRequest,
  buildFinalizationFallbackMessage,
  finalizationFallbackReason,
  createAgentProgressRecorder,
  createResultEditCompletionGuard,
  createAgentToolCallController,
  runAgentToolCallBatch,
} = require('../agent-tools');
const {
  createResultEditProgressRecorder,
  finalizeResultEditProgress,
  projectResultStudioToolContext,
} = require('../agent-tools/result-context-binding');
const { inferExecutionPolicy } = require('../helpers/agent-execution-policy');
const {
  _gatherAnalysisContextForMethods,
  _renderMethodsParagraph,
} = require('../helpers/methods-export');
const { runAgentLoop } = require('../agent-runner');
const { aiTaskConcurrencyAcquire, aiTaskConcurrencyRelease } = require('../helpers/runtime');
const agentTaskStore = require('../agent-task-store');

// AGENT_TASK_MODE_v1：默认 task 模式（loop 后台跑 + 订阅重连），legacy 回退到直连 SSE
const USE_AGENT_TASK_MODE = (process.env.BIOF3_AGENT_TASK_MODE || 'task') !== 'legacy';

function _buildResultCardFromRunTool(result, context) {
  if (!result || typeof result !== 'object' || !result.toolJobId || result.needApproval) return null;
  const toolId = String(result.toolId || 'analysis');
  const payload = result.result && typeof result.result === 'object' ? result.result : {};
  const artifacts = Array.isArray(payload.artifacts)
    ? payload.artifacts.slice(0, 50).map((item) => {
        if (!item || typeof item !== 'object') return { name: String(item), type: 'file' };
        return {
          id: item.id ? String(item.id) : undefined,
          name: item.name ? String(item.name) : item.filename ? String(item.filename) : undefined,
          filename: item.filename ? String(item.filename) : item.name ? String(item.name) : undefined,
          type: item.type ? String(item.type) : 'file',
          label: item.label ? String(item.label) : item.title ? String(item.title) : undefined,
          title: item.title ? String(item.title) : item.label ? String(item.label) : undefined,
        };
      })
    : [];
  const files = Array.isArray(payload.files)
    ? payload.files.slice(0, 50).map((f) => {
        if (typeof f === 'string') return f;
        if (f && typeof f === 'object') return String(f.name || f.filename || '');
        return String(f);
      }).filter(Boolean)
    : [];
  const outputs = Array.isArray(payload.outputs)
    ? payload.outputs.slice(0, 50).map((item) => {
        if (!item || typeof item !== 'object') return { name: String(item) };
        return {
          id: item.id ? String(item.id) : undefined,
          name: item.name ? String(item.name) : undefined,
          filename: item.filename ? String(item.filename) : undefined,
          type: item.type ? String(item.type) : undefined,
          label: item.label ? String(item.label) : undefined,
        };
      })
    : [];
  return {
    jobId: String(result.toolJobId),
    toolId,
    title: `${toolId} 分析结果`,
    status: result.error || result.ok === false ? 'failed' : 'done',
    projectId: context && context.projectId ? String(context.projectId) : null,
    error: result.error || result.message ? String(result.message || result.error).slice(0, 1200) : undefined,
    artifacts,
    files,
    outputs,
  };
}

function _pushUniqueResultCard(cards, card) {
  if (!card || !card.jobId) return;
  if (cards.some((item) => item.jobId === card.jobId)) return;
  cards.push(card);
}

// PHASE 2.2b: thin facade — delegates to ai-agent/index subdomains
const _aiAgent = require('./ai-agent/index');

module.exports = function registerAiAgentRoute(app) {
  _aiAgent.register(app);
};
