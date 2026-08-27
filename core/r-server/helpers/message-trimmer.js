/**
 * Token-budget-aware message trimming.
 *
 * Strategy: When messages exceed the available budget, preserve information
 * in priority tiers so the model always has the most relevant context.
 *
 * Priority tiers (lower number = higher priority):
 *   1. TOOL_RESULT   — recent tool results (maintain tool_call chain integrity)
 *   2. RECENT_TURN   — recent user/assistant turns (active conversation context)
 *   3. HISTORICAL    — older messages (compressed into summary if many are dropped)
 *
 * DeepSeek-V3 context window: 64K tokens
 * Default budget allocation:
 *   - System prompt: estimated at call time
 *   - Response headroom: 8192 tokens
 *   - Messages: remaining tokens
 */

const { countTokens } = require('./token-estimator');

// Tier constants
const TIER_TOOL_RESULT = 1;
const TIER_RECENT_TURN = 2;
const TIER_HISTORICAL = 3;

// Age cutoffs
const TOOL_RESULT_AGE_CUTOFF = 10;   // keep tool results within last 10 messages
const RECENT_TURN_AGE_CUTOFF = 20;   // keep recent turns within last 20 messages
const SUMMARY_TRIGGER_DROP = 5;       // inject summary note if >N historical messages dropped

/**
 * Score and tier each message by role and age.
 * Older messages get lower priority; tool results get highest priority.
 */
function scoreMessages(msgs) {
  const total = msgs.length;
  return msgs.map((msg, idx) => {
    const age = total - idx; // 1 = most recent
    let tier = TIER_RECENT_TURN;
    if (msg.role === 'tool') {
      tier = TIER_TOOL_RESULT;
    } else if (age > RECENT_TURN_AGE_CUTOFF) {
      tier = TIER_HISTORICAL;
    }
    const tokens = countMessageTokens(msg);
    return { msg, tokens, tier, age };
  });
}

/**
 * Count tokens for a single message, including overhead.
 */
function countMessageTokens(msg) {
  let tokens = countTokens(msg.content || '');
  // Role overhead
  tokens += 4;
  if (msg.name) tokens += 4;
  // Tool call overhead
  if (Array.isArray(msg.tool_calls)) {
    tokens += msg.tool_calls.length * 15;
  }
  return tokens;
}

/**
 * Greedily pick messages within the token budget, tier by tier.
 */
function pickWithinBudget(scored, budget) {
  const kept = [];
  let used = 0;

  // Tier 1: Tool results (most recent)
  const toolResults = scored
    .filter(s => s.tier === TIER_TOOL_RESULT && s.age <= TOOL_RESULT_AGE_CUTOFF)
    .sort((a, b) => a.age - b.age); // oldest first (they're already recent-limited)

  for (const s of toolResults) {
    if (used + s.tokens <= budget) {
      kept.push(s);
      used += s.tokens;
    }
  }

  // Tier 2: Recent turns
  const recentTurns = scored
    .filter(s => s.tier === TIER_RECENT_TURN && s.age <= RECENT_TURN_AGE_CUTOFF)
    .sort((a, b) => a.age - b.age);

  for (const s of recentTurns) {
    if (used + s.tokens <= budget) {
      kept.push(s);
      used += s.tokens;
    }
  }

  // Tier 3: Remaining — fill budget by age (prefer older before newer, since newer already kept)
  const remaining = scored
    .filter(s => !kept.includes(s))
    .sort((a, b) => a.age - b.age); // oldest first for fill

  for (const s of remaining) {
    if (used + s.tokens <= budget) {
      kept.push(s);
      used += s.tokens;
    }
  }

  return { kept, used };
}

/**
 * Main export: trim messages to fit within the token budget.
 * Also returns a categories breakdown for UI display.
 *
 * @param {{
 *   fullMessages: Array,      // includes system message at index 0
 *   contextWindow?: number,   // model context window (default 64000)
 *   headroom?: number,       // tokens reserved for response (default 8192)
 *   systemPromptTokens?: number, // optional pre-counted system prompt tokens
 * }} opts
 * @returns {Array} Trimmed message array, same structure as fullMessages
 */
function trimMessagesToBudget({ fullMessages, contextWindow = 64000, headroom = 8192, systemPromptTokens: preCountedSystemTokens }) {
  if (!Array.isArray(fullMessages) || fullMessages.length === 0) {
    return { messages: fullMessages, stats: null };
  }

  const systemMsg = fullMessages[0];
  if (systemMsg.role !== 'system') {
    return { messages: fullMessages, stats: null }; // unexpected structure, skip trimming
  }

  const systemPromptTokens = preCountedSystemTokens ?? countTokens(systemMsg.content || '');
  const budget = contextWindow - systemPromptTokens - headroom;
  const msgs = fullMessages.slice(1);

  // Compute per-category token counts BEFORE any trimming
  const categories = computeCategories(msgs, systemPromptTokens);

  const currentTokens = msgs.reduce((sum, m) => sum + countMessageTokens(m), 0);

  // No trimming needed — within budget
  if (currentTokens <= budget) {
    return {
      messages: fullMessages,
      stats: {
        contextWindow,
        messagesTokensUsed: currentTokens,
        messagesKept: msgs.length,
        messagesDropped: 0,
        pct: budget > 0 ? Math.round((currentTokens / budget) * 100) : 0,
        trimmed: false,
        categories,
      },
    };
  }

  // Score and greedily pick
  const scored = scoreMessages(msgs);
  const { kept, used } = pickWithinBudget(scored, budget);

  // If nothing was actually trimmed, return as-is
  if (kept.length === msgs.length) {
    return {
      messages: fullMessages,
      stats: {
        contextWindow,
        messagesTokensUsed: currentTokens,
        messagesKept: msgs.length,
        messagesDropped: 0,
        pct: budget > 0 ? Math.round((currentTokens / budget) * 100) : 0,
        trimmed: false,
        categories,
      },
    };
  }

  // Build result: system + kept messages in original order
  const result = [systemMsg];
  for (const s of kept.sort((a, b) => a.age - b.age)) {
    result.push(s.msg);
  }

  // Inject summary note if many historical messages were dropped
  const droppedHistorical = scored.filter(
    s => !kept.includes(s) && s.tier === TIER_HISTORICAL
  );
  if (droppedHistorical.length > SUMMARY_TRIGGER_DROP) {
    result.push({
      role: 'system',
      content: `\n\n[注意: 早期 ${droppedHistorical.length} 条消息因超出上下文窗口已压缩。上面"对话历史摘要"块中包含其要点。继续对话时如需引用早期信息，请明确告知用户。]`,
    });
  }

  const messagesKept = kept.length;
  const messagesDropped = msgs.length - messagesKept;
  const messagesTokensUsed = kept.reduce((sum, s) => sum + s.tokens, 0);

  return {
    messages: result,
    stats: {
      contextWindow,
      messagesTokensUsed,
      messagesKept,
      messagesDropped,
      pct: budget > 0 ? Math.round((messagesTokensUsed / budget) * 100) : 0,
      trimmed: messagesDropped > 0,
      categories,
    },
  };
}

/**
 * Compute token breakdown by category for the given messages (before trimming).
 * @param {Array} msgs - Non-system messages
 * @param {number} systemPromptTokens - System prompt token count
 * @returns {{ systemInstructions: number, messages: number, tools: number, other: number }}
 */
function computeCategories(msgs, systemPromptTokens) {
  let tools = 0;
  let messages = 0;

  for (const msg of msgs) {
    const msgTokens = countMessageTokens(msg);
    if (msg.role === 'tool') {
      tools += msgTokens;
    } else {
      // user / assistant — plain conversation content
      messages += msgTokens;
    }
  }

  // other: whatever is left after system + messages + tools
  // (e.g. injected summary messages, system padding)
  const other = Math.max(0, systemPromptTokens + messages + tools - systemPromptTokens - messages - tools);

  return {
    systemInstructions: systemPromptTokens,
    messages,
    tools,
    other,
  };
}

/**
 * Lightweight version: just return token counts for a message array
 * without modifying anything.
 * @param {Array} messages
 * @returns {{ count: number, breakdown: Array<{role: string, tokens: number, age: number}> }}
 */
function analyzeMessageTokens(messages) {
  const msgs = messages.filter(m => m.role !== 'system');
  const scored = scoreMessages(msgs);
  return {
    count: scored.reduce((sum, s) => sum + s.tokens, 0),
    breakdown: scored.map(s => ({
      role: s.msg.role,
      tokens: s.tokens,
      age: s.age,
      tier: s.tier,
    })),
  };
}

module.exports = {
  trimMessagesToBudget,
  analyzeMessageTokens,
  countMessageTokens,
  // Expose for testing
  TIER_TOOL_RESULT,
  TIER_RECENT_TURN,
  TIER_HISTORICAL,
  TOOL_RESULT_AGE_CUTOFF,
  RECENT_TURN_AGE_CUTOFF,
};
