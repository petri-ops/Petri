'use strict';

/**
 * conversation-adapter.js
 *
 * Handles conversation-level operations:
 * - Message append + persistence
 * - Auto-title conversation
 * - Topic shift detection
 * - Conversation metadata sync
 * - Memory vector embedding + fact extraction
 * - Chat summary management
 *
 * Extracted from agent-runner.js (PHASE 3.1 split).
 * Pure functions, no side effects on agent loop state.
 */

const convSync = require('./helpers/conversations');
const {
  getOrCreateActiveConversation,
  appendMessageToConversation,
  _maybeAutoTitleConversation,
  _maybeDetectTopicShift,
} = convSync;
const { logChatAudit } = require('./helpers/memory-privacy');
const {
  dashscopeEmbed,
  saveMemoryVector,
  MAX_CONTENT_LEN,
} = require('./helpers/memory-vectors');
const { buildFactsBlockAsync, backgroundExtractFacts } = require('./helpers/user-facts');
const {
  getChatSummaryAsync,
  summarizeMessages,
} = require('./helpers/chat-summary');
const agentTaskStore = require('./agent-task-store');

/**
 * Append assistant message to conversation with rich metadata.
 *
 * @param {object} opts
 * @param {string} opts.conversationId - Active conversation ID
 * @param {string} opts.assistantAcc - Assistant accumulated text
 * @param {object} opts.context - Page context
 * @param {string} opts.userId - User ID
 * @param {number} opts.turnStartedAt - Turn start timestamp
 * @param {object} opts.assistantProgress - Progress recorder snapshot
 * @param {object} opts.resultEditProgress - Result edit progress recorder snapshot
 * @param {object} opts.assistantToolActivities - Tool activity recorder snapshot
 * @param {object} opts.assistantResultCards - Array of result cards
 * @param {object} opts.loopRunId - Loop run ID (optional)
 * @param {string} opts.loopState - Current loop state
 * @param {boolean} opts.cancellationObserved - Whether user cancelled
 * @param {number} opts.finalizationAttempts - Number of finalization attempts
 * @param {string|null} opts.finalizationFailureReason - Failure reason if any
 * @param {object|null} opts.finalizationRouting - Model routing info
 * @param {object|null} opts.toolCallController - Tool call controller (for anomaly)
 * @param {object} opts.assistantProgress - Progress recorder (live object)
 * @param {object} opts.emitFn - Event emit function
 * @param {string} opts.taskId - Task ID for persistence
 * @returns {{persisted: boolean, shifted: boolean}}
 */
function appendAssistantMessage({
  conversationId,
  assistantAcc,
  context,
  userId,
  turnStartedAt,
  assistantProgress,
  resultEditProgress,
  assistantToolActivities,
  // UI-272 — 按迭代聚合的模型思考段（reasoning_content），随消息落库
  reasoningByIteration,
  assistantResultCards,
  loopRunId,
  loopState,
  cancellationObserved,
  finalizationAttempts,
  finalizationFailureReason,
  finalizationRouting,
  toolCallController,
  taskId,
  emitFn,
}) {
  let persisted = false;
  let shifted = false;

  if (!assistantAcc || typeof assistantAcc.trim !== 'function' || assistantAcc.trim().length === 0) {
    return { persisted, shifted };
  }

  if (!userId || !conversationId) {
    return { persisted, shifted };
  }

  try {
    const assistantMeta = {
      page: context && context.page,
      projectId: context && context.projectId,
      processingDurationMs: Math.max(0, Date.now() - turnStartedAt),
    };

    // Add cancellation info if present
    if (cancellationObserved) {
      assistantMeta.interruption = {
        reason: 'user_cancelled',
        preservedProgressCount: assistantProgress && assistantProgress.snapshot
          ? assistantProgress.snapshot().length
          : 0,
        preservedToolActivityCount: assistantToolActivities && assistantToolActivities.snapshot
          ? assistantToolActivities.snapshot().length
          : 0,
      };
    }

    // Add progress updates
    if (assistantProgress && assistantProgress.snapshot && assistantProgress.snapshot().length > 0) {
      assistantMeta.progressUpdates = assistantProgress.snapshot();
    }

    // Add result edit progress
    if (resultEditProgress && resultEditProgress.snapshot && resultEditProgress.snapshot().length > 0) {
      assistantMeta.resultEditProgress = resultEditProgress.snapshot();
    }

    // Add finalization info
    if (finalizationAttempts > 0) {
      assistantMeta.finalization = {
        attempts: finalizationAttempts,
        recovered: !finalizationFailureReason,
      };
      if (finalizationFailureReason) {
        assistantMeta.finalization.failureReason = finalizationFailureReason;
      }
      if (finalizationRouting) {
        assistantMeta.finalization.routing = finalizationRouting;
      }
    }

    // Add incident info
    const hasIncident = toolCallController && toolCallController.anomaly;
    if (finalizationFailureReason || hasIncident) {
      assistantMeta.incident = {
        code: hasIncident && toolCallController.anomaly.code
          ? toolCallController.anomaly.code
          : finalizationFailureReason || 'agent_failure',
        autoRecoveryAttempts: finalizationAttempts || 0,
      };
      if (hasIncident && toolCallController.anomaly.tool) {
        assistantMeta.incident.tool = toolCallController.anomaly.tool;
      }
    }

    // Add result cards
    if (assistantResultCards && assistantResultCards.length > 0) {
      assistantMeta.resultCards = assistantResultCards;
    }

    // Add tool activities
    if (assistantToolActivities && assistantToolActivities.snapshot && assistantToolActivities.snapshot().length > 0) {
      assistantMeta.toolActivities = assistantToolActivities.snapshot();
    }

    // UI-272 — Add reasoning by iteration
    if (reasoningByIteration && typeof reasoningByIteration === 'object' && Object.keys(reasoningByIteration).length > 0) {
      assistantMeta.reasoningByIteration = reasoningByIteration;
    }

    // Add loop reference
    if (loopRunId) {
      assistantMeta.loopRef = {
        loopRunId,
        phase: loopState || 'running',
      };
    }

    // Persist message
    appendMessageToConversation(conversationId, 'assistant', assistantAcc.trim(), assistantMeta, taskId);
    persisted = true;

    // Auto-title conversation
    try {
      _maybeAutoTitleConversation(conversationId, userId);
    } catch {}

    // Detect topic shift (async, fire-and-forget)
    _maybeDetectTopicShift(conversationId, userId)
      .then((r) => {
        if (r && r.shifted) {
          try {
            emitFn({
              event: 'topic_shift',
              conversationId,
              reason: r.reason,
            });
            shifted = true;
          } catch {}
        }
      })
      .catch(() => {});
  } catch (e) {
    // Best-effort: never break the turn on conversation persistence failure —
    // but BLOCK-102 P1: silent history loss was undiscoverable. Make it LOUD:
    // structured error log + persist-failed event (frontend may surface
    // "本轮未保存"), and persisted stays false for the caller.
    console.error('[conversation-adapter] assistant persist failed:',
      e && e.message ? e.message : e);
    persisted = false;
    try {
      if (typeof emitFn === 'function') {
        emitFn({ event: 'message_persist_failed', conversationId, role: 'assistant' });
      }
    } catch {}
  }

  return { persisted, shifted };
}

/**
 * Persist user message to conversation.
 *
 * @param {object} opts
 * @param {string} opts.conversationId - Active conversation ID
 * @param {string} opts.content - Message content
 * @param {object} opts.context - Page context
 * @param {string} opts.userId - User ID
 * @param {string} opts.taskId - Task ID for persistence
 */
function appendUserMessage({
  conversationId,
  content,
  context,
  userId,
  taskId,
}) {
  if (!userId || !conversationId || !content) return;

  try {
    const meta = {
      page: context && context.page,
      projectId: context && context.projectId,
    };
    appendMessageToConversation(conversationId, 'user', content, meta, taskId);
  } catch (e) {
    // BLOCK-102 P1 — silent user-message loss was undiscoverable
    console.error('[conversation-adapter] user persist failed:',
      e && e.message ? e.message : e);
  }
}

/**
 * Save chat turn to memory vector store.
 *
 * @param {object} opts
 * @param {string} opts.userId - User ID
 * @param {string} opts.conversationId - Conversation ID
 * @param {string} opts.assistantAcc - Assistant text
 * @param {Array} opts.messages - Full message array
 * @param {object} opts.context - Page context
 */
async function saveChatTurnToMemory({
  userId,
  conversationId,
  assistantAcc,
  messages,
  context,
}) {
  if (!userId) return;

  const lastUser = Array.isArray(messages)
    ? [...messages].reverse().find((m) => m && m.role === 'user')
    : null;

  if (!lastUser) return;

  const cleanUser = String(lastUser.content || '').replace(/^\[[^\]]+\]\s*\n?/, '');
  const turnText = '用户: ' + cleanUser + '\n\nAI: ' + (assistantAcc || '').trim();

  try {
    const vecs = await dashscopeEmbed([turnText.slice(0, MAX_CONTENT_LEN)], {
      userId,
      conversationId,
      kind: 'embedding',
    });
    if (vecs && vecs[0]) {
      saveMemoryVector({
        userId,
        projectId: context && context.projectId,
        kind: 'chat_turn',
        refId: null,
        page: context && context.page,
        pageTitle: context && context.pageTitle,
        content: turnText.slice(0, MAX_CONTENT_LEN),
        vec: vecs[0],
        conversationId,
      });
    }
  } catch {}
}

/**
 * Trigger background fact extraction if conversation is long enough.
 *
 * @param {object} opts
 * @param {string} opts.userId - User ID
 * @param {Array} opts.messages - Message array
 * @param {string} opts.assistantAcc - Assistant text
 * @param {string} opts.projectId - Project ID
 */
function triggerBackgroundFactExtraction({
  userId,
  messages,
  assistantAcc,
  projectId,
}) {
  if (!userId) return;

  try {
    const userMsgCount = Array.isArray(messages)
      ? messages.filter((m) => m && m.role === 'user').length
      : 0;

    // Extract facts every 2 user messages (every other message pair)
    if (userMsgCount >= 2 && userMsgCount % 2 === 0) {
      const threadForExtract = Array.isArray(messages)
        ? messages.slice(-12).concat([{ role: 'assistant', content: (assistantAcc || '').trim() }])
        : [];
      backgroundExtractFacts(userId, threadForExtract, projectId).catch(() => {});
    }
  } catch {}
}

/**
 * Trigger chat summary if conversation is long enough.
 *
 * @param {object} opts
 * @param {string} opts.userId - User ID
 * @param {Array} opts.messages - Message array
 * @param {string} opts.assistantAcc - Assistant text
 * @param {string} opts.projectId - Project ID
 */
async function triggerChatSummary({
  userId,
  messages,
  assistantAcc,
  projectId,
}) {
  if (!userId || !Array.isArray(messages)) return;

  try {
    const SUMMARY_TRIGGER_AT = 22;
    const SUMMARY_KEEP_RECENT = 14;

    if (messages.length > SUMMARY_TRIGGER_AT) {
      const oldMsgs = messages.slice(0, messages.length - SUMMARY_KEEP_RECENT);
      if (oldMsgs.length >= 6) {
        const existing = await getChatSummaryAsync(userId, projectId);
        const newSummary = [...messages].reverse().find((m) => m && m.role === 'user')
          ? [...messages].reverse().find((m) => m && m.role === 'user').content
          : null;

        await summarizeMessages(
          userId,
          projectId,
          oldMsgs,
          existing && existing.summary
        ).catch(() => {});
      }
    }
  } catch {}
}

/**
 * Log chat audit entry.
 *
 * @param {string} opts.userId - User ID
 * @param {object} opts.context - Page context
 * @param {Array} opts.messages - Message array
 */
function logAudit({ userId, context, messages }) {
  if (!userId) return;

  try {
    const page = (context && context.page) || null;
    const msgCount = Array.isArray(messages) ? messages.length : 0;
    logChatAudit(userId, page, msgCount);
  } catch {}
}

/**
 * Build conversation metadata from context.
 *
 * @param {object} context - Page context
 * @param {object} _activeConv - Active conversation object
 * @param {boolean} isGuest - Whether user is guest
 * @returns {object} Conversation metadata
 */
function buildConversationMetadata(context, _activeConv, isGuest) {
  return {
    conversationId: _activeConv && _activeConv.id,
    page: context && context.page,
    projectId: context && context.projectId,
    audience: isGuest ? 'guest' : 'user',
  };
}

/**
 * Announce active conversation via event emission.
 *
 * @param {function} emitFn - Event emit function
 * @param {object} _activeConv - Active conversation object
 */
function announceActiveConversation(emitFn, _activeConv) {
  if (!_activeConv) return;
  try {
    emitFn({ event: 'conversation', conversationId: _activeConv.id, title: _activeConv.title });
  } catch {}
}

module.exports = {
  appendAssistantMessage,
  appendUserMessage,
  saveChatTurnToMemory,
  triggerBackgroundFactExtraction,
  triggerChatSummary,
  logAudit,
  buildConversationMetadata,
  announceActiveConversation,
  getOrCreateActiveConversation,
  appendMessageToConversation,
  _maybeAutoTitleConversation,
  _maybeDetectTopicShift,
};
