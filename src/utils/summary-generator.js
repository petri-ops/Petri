// ============================================================
// Conversation Summary Generator
//
// Phase 4: Extract structured summaries from conversation messages
// for export to Result Studio.
//
// No external AI API calls - uses heuristic extraction.
// ============================================================

/**
 * @typedef {Object} ConversationSummary
 * @property {string} summary - Plain text summary
 * @property {string[]} keyFindings - Extracted code blocks and conclusions
 * @property {string[]} topics - Detected conversation topics
 * @property {number} messageCount - Total message count
 * @property {number} userMessageCount - User message count
 * @property {number} assistantMessageCount - Assistant message count
 */

/**
 * @typedef {Object} ConversationMetrics
 * @property {string[]} topics - Unique topics detected
 * @property {number} messageCount - Total message count
 * @property {number} duration - Conversation duration in ms (0 if < 2 messages)
 */

/**
 * Generate a structured summary from conversation messages.
 *
 * @param {Array<{role: string, content: string, created_at?: number}>} messages - Conversation messages
 * @returns {ConversationSummary} Structured summary
 */
function generateConversationSummary(messages) {
  if (!messages || messages.length === 0) {
    return {
      summary: 'Empty conversation',
      keyFindings: [],
      topics: [],
      messageCount: 0,
      userMessageCount: 0,
      assistantMessageCount: 0,
    };
  }

  const userMessages = messages.filter((m) => m.role === 'user');
  const assistantMessages = messages.filter((m) => m.role === 'assistant');

  // Extract topics from user messages
  const topics = extractTopics(userMessages);

  // Extract key findings (code blocks, conclusions) from assistant messages
  const keyFindings = extractKeyFindings(assistantMessages);

  // Generate summary text
  const summary = generateSummaryText(messages, userMessages, assistantMessages);

  return {
    summary,
    keyFindings,
    topics,
    messageCount: messages.length,
    userMessageCount: userMessages.length,
    assistantMessageCount: assistantMessages.length,
  };
}

/**
 * Extract unique topics from user messages.
 *
 * @param {Array<{content: string}>} userMessages - User messages only
 * @returns {string[]} Unique topic strings
 */
function extractTopics(userMessages) {
  const topicSet = new Set();

  for (const msg of userMessages) {
    const content = msg.content || '';
    // Take first sentence, truncate to 50 chars
    const firstSentence = content.split(/[.!?\n]/)[0] || '';
    const topic = firstSentence.trim().slice(0, 50);
    if (topic && topic.length > 3) {
      topicSet.add(topic);
    }
  }

  return Array.from(topicSet).slice(0, 10); // Cap at 10 topics
}

/**
 * Extract key findings from assistant messages.
 * Finds code blocks and significant output sections.
 *
 * @param {Array<{content: string}>} assistantMessages - Assistant messages only
 * @returns {string[]} Extracted code blocks (max 3 per message, 20 total)
 */
function extractKeyFindings(assistantMessages) {
  const findings = [];

  for (const msg of assistantMessages) {
    const content = msg.content || '';

    // Extract code blocks
    const codeBlocks = content.match(/```[\s\S]*?```/g) || [];
    for (const block of codeBlocks.slice(0, 3)) {
      // Truncate long code blocks for storage efficiency
      const truncated = block.length > 500 ? block.slice(0, 500) + '\n...' : block;
      findings.push(truncated);
    }

    // Stop if we have enough findings
    if (findings.length >= 20) break;
  }

  return findings;
}

/**
 * Generate a human-readable summary text.
 *
 * @param {Array} messages - All messages
 * @param {Array} userMessages - User messages
 * @param {Array} assistantMessages - Assistant messages
 * @returns {string} Summary text
 */
function generateSummaryText(messages, userMessages, assistantMessages) {
  const total = messages.length;
  const userCount = userMessages.length;
  const assistantCount = assistantMessages.length;

  // Calculate duration if we have timestamps
  let durationStr = '';
  if (messages.length >= 2) {
    const first = messages[0].created_at;
    const last = messages[messages.length - 1].created_at;
    if (first && last) {
      const durationMs = last - first;
      const minutes = Math.round(durationMs / 60000);
      if (minutes > 0) {
        durationStr = `, ${minutes} min`;
      }
    }
  }

  // Extract first user question as context
  let context = '';
  if (userMessages.length > 0) {
    const firstQuestion = userMessages[0].content || '';
    const truncated = firstQuestion.slice(0, 80).trim();
    if (truncated.length > 0) {
      context = `: "${truncated}${firstQuestion.length > 80 ? '...' : ''}"`;
    }
  }

  return `对话导出 (${total} 条消息, ${userCount} 用户 / ${assistantCount} 助手${durationStr})${context}`;
}


module.exports = {
  generateConversationSummary,
};
