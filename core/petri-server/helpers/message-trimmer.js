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
    // BLOCK-355 C-45 — 保留原始下标：输出顺序必须精确还原，不能用 age 排序
    // （age = total - idx，升序会把新消息排到前面，导致 tool 出现在 tool_calls 之前）。
    return { msg, tokens, tier, age, idx };
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
 * BLOCK-355 C-45 — 把 tool 调用链作为**原子单元**参与裁剪。
 *
 * 历史缺陷：三档独立贪心先把 `role: 'tool'` 结果按 TIER_TOOL_RESULT 挑走、
 * 占满预算后 `assistant(tool_calls)` 被丢弃 → 输出里出现悬空 tool 消息，
 * provider 收到后整体 400，长任务中断（BLOCK-348 T7 实锤）。
 *
 * 单元规则：`assistant(tool_calls)` 与其后紧随的、tool_call_id 属于该调用的
 * `tool` 消息合并为一个不可拆单元；同留同裁。其余消息各自成单元。
 */
function groupToolChains(scored) {
  const units = [];
  let i = 0;
  const makeUnit = (items) => ({
    items,
    tokens: items.reduce((n, s) => n + s.tokens, 0),
    tier: Math.min(...items.map((s) => s.tier)),
    age: Math.max(...items.map((s) => s.age)),
  });

  while (i < scored.length) {
    const s = scored[i];
    const msg = s.msg;
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const ids = new Set(msg.tool_calls.map((tc) => tc && tc.id).filter(Boolean));
      const items = [s];
      let j = i + 1;
      while (j < scored.length && scored[j].msg.role === 'tool'
        && (!scored[j].msg.tool_call_id || ids.has(scored[j].msg.tool_call_id))) {
        items.push(scored[j]);
        j += 1;
      }
      units.push(makeUnit(items));
      i = j;
    } else {
      units.push(makeUnit([s]));
      i += 1;
    }
  }
  return units;
}

/**
 * Greedily pick messages within the token budget, tier by tier.
 * 以 tool 链原子单元为最小粒度，保证裁剪后不产生悬空 tool 消息。
 */
function pickWithinBudget(scored, budget) {
  const units = groupToolChains(scored);
  const keptUnits = [];
  let used = 0;

  const take = (unit) => {
    if (used + unit.tokens <= budget) {
      keptUnits.push(unit);
      used += unit.tokens;
    }
  };

  // Tier 1: tool 结果（整链，含其 assistant(tool_calls)）
  units
    .filter(u => u.tier === TIER_TOOL_RESULT && u.age <= TOOL_RESULT_AGE_CUTOFF)
    .sort((a, b) => a.age - b.age)
    .forEach(take);

  // Tier 2: 近期对话轮
  units
    .filter(u => u.tier === TIER_RECENT_TURN && u.age <= RECENT_TURN_AGE_CUTOFF)
    .sort((a, b) => a.age - b.age)
    .forEach(take);

  // Tier 3: 其余按 age 填充
  units
    .filter(u => !keptUnits.includes(u))
    .sort((a, b) => a.age - b.age)
    .forEach(take);

  // BLOCK-365（W1-F15）当前活动轮兜底：最后一条 user/assistant 无论如何保留——
  // 丢了它模型就失去本轮任务本身。
  const lastTurn = [...units]
    .filter(u => u.items.some(it => it.msg.role === 'user' || it.msg.role === 'assistant'))
    .sort((a, b) => a.age - b.age)[0];
  if (lastTurn && !keptUnits.includes(lastTurn)) {
    keptUnits.push(lastTurn);
    used += lastTurn.tokens;
  }

  // 展开回 scored 项，保持原始顺序（按 idx，不按 age）
  const kept = keptUnits
    .flatMap(u => u.items)
    .sort((a, b) => a.idx - b.idx);
  return { kept, used };
}

/**
 * BLOCK-355 C-45 — 防御层：丢弃没有对应 tool_calls 声明的 tool 消息。
 * 即使输入本身已带孤立 tool（历史遗留/上游裁剪），也不让它进入 provider 请求。
 */
function dropOrphanToolMessages(messages) {
  const declared = new Set();
  const out = [];
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) if (tc && tc.id) declared.add(tc.id);
      out.push(msg);
    } else if (msg.role === 'tool') {
      if (!msg.tool_call_id || declared.has(msg.tool_call_id)) out.push(msg);
    } else {
      out.push(msg);
    }
  }
  return out;
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
  const { kept } = pickWithinBudget(scored, budget);

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

  // BLOCK-355 C-45 — output 必须保持原始顺序（kept 已按 idx 排好），
  // 且任何没有 tool_calls 声明的 tool 消息都不得进入 provider 请求。
  const retainedMsgs = dropOrphanToolMessages(kept.map((s) => s.msg));
  const retainedSet = new Set(retainedMsgs);
  const retainedScored = kept.filter((s) => retainedSet.has(s.msg));
  const result = [systemMsg, ...retainedMsgs];

  // BLOCK-365（W1-F15）真实被丢集合 + 不注入不实摘要声明。
  // 旧形态无条件写「上面"对话历史摘要"块中包含其要点」——上层摘要失败时这是对模型的不实
  // 声明（BLOCK-355 评审同源教训：断言锚内容会变成自我欺骗）。诚实声明由上层按摘要是否
  // 真实生成注入；trimmer 只报告事实。
  const droppedHistorical = scored.filter(
    s => !retainedSet.has(s.msg) && s.tier === TIER_HISTORICAL
  );
  const dropped = msgs.filter(m => !retainedSet.has(m));

  const messagesKept = retainedScored.length;
  const messagesDropped = msgs.length - messagesKept;
  const messagesTokensUsed = retainedScored.reduce((sum, s) => sum + s.tokens, 0);

  return {
    messages: result,
    // BLOCK-365（W1-F15）真实被丢集合（原始对象引用，供上层做增量摘要源）
    dropped,
    droppedHistoricalCount: droppedHistorical.length,
    summaryEligible: droppedHistorical.length > SUMMARY_TRIGGER_DROP,
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
