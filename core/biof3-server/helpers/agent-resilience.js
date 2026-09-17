'use strict';

/**
 * helpers/agent-resilience.js — BLOCK-98 Agent 长任务韧性（M1 microcompact 起步）。
 *
 * agent-runner 行数门（1250）零触碰：全部新逻辑下沉本文件，runner 只留接线。
 * 开关（D6）：BIOF3_AGENT_RESILIENCE=1/true（默认关，收口时用户裁决翻默认）。
 *
 * M1 microcompact（三层压缩第 0 层，本地零模型成本）：LLM 请求视图中旧工具结果
 * 按组折叠为占位符。触发=估算 token ≥ min(窗口×0.9, 窗口−2000)；只折叠连续
 * ≥5 条的工具结果组，保留最近 5 组；占位符带标记防重复折叠。
 * 红线：只作用于当次请求的投影副本（body.messages 换新数组），loop 运行时
 * messages 与 copilot_messages 原文永不触碰（BLOCK-95 §4 原则 1 延续）。
 */

const RESILIENCE_ENV = 'BIOF3_AGENT_RESILIENCE';
const MICROCOMPACT_PLACEHOLDER = '[已折叠：旧工具结果已按上下文管理清理]';
// 组内工具结果条数下限：ZCode 原文「连续 ≥5 条」按其存储格式（工具结果连排）
// 转录；本仓运行时格式为 assistant(tool_calls)+tool 交替，语义等价适配为
// 「同一块内 ≥2 条工具结果才成组，零散单条不折」（P0 结论，回写 plan §4）。
const MIN_GROUP_TOOLS = 2;
const KEEP_RECENT_GROUPS = 5;

function isResilienceEnabled(env) {
  const raw = (env && env[RESILIENCE_ENV]) || '';
  return raw === '1' || raw === 'true';
}

function isFolded(content) {
  return typeof content === 'string' && content.startsWith(MICROCOMPACT_PLACEHOLDER);
}

function isAssistantToolCarrier(m) {
  // assistant(tool_calls) 且无正文——它只是工具结果的协议载体，与结果同组
  return Boolean(
    m && m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0 &&
    (m.content == null || m.content === '' || m.content === null)
  );
}

/**
 * 把消息流按「工具调用块」分组（assistant(tool_calls)+其后 tool 结果为一块；
 * 已折叠的 tool 不计入组）。块内工具结果 ≥MIN_GROUP_TOOLS 条才算可折叠组。
 * @returns {Array<{toolIndexes: number[]}>} 可折叠组的 tool 消息下标列表
 */
function toolGroups(messages) {
  const groups = [];
  let current = [];
  const flush = () => {
    if (current.length >= MIN_GROUP_TOOLS) groups.push({ toolIndexes: current.slice() });
    current = [];
  };
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m && m.role === 'tool') {
      if (!isFolded(m.content)) current.push(i);
      continue;
    }
    if (isAssistantToolCarrier(m)) { flush(); continue; } // 新一批调用=新组
    flush();
  }
  flush();
  return groups;
}

/**
 * microcompact 纯函数：返回折叠后的新数组与统计（不改动输入数组）。
 * @param {Array<{role,content,name?,tool_call_id?}>} messages
 * @param {{contextWindow: number}} opts
 */
function microcompactMessages(messages, opts = {}) {
  const empty = { messages, folded: 0, clearedChars: 0, groups: 0, triggered: false };
  if (!Array.isArray(messages) || messages.length === 0) return empty;
  const window = Number(opts.contextWindow) || 0;
  const { countMessages } = require('./token-estimator');
  const estimate = countMessages(messages);
  const threshold = window > 0 ? Math.min(window * 0.9, window - 2000) : Infinity;
  if (estimate < threshold) return { ...empty, triggered: false };

  const groups = toolGroups(messages);
  if (groups.length === 0) return { ...empty, triggered: true };
  // 保留最近 KEEP_RECENT_GROUPS 组（组按出现顺序，取尾部）
  const foldTargets = groups.slice(0, Math.max(0, groups.length - KEEP_RECENT_GROUPS));
  if (foldTargets.length === 0) return { ...empty, triggered: true, groups: groups.length };

  const foldSet = new Set();
  let clearedChars = 0;
  for (const g of foldTargets) {
    for (const i of g.toolIndexes) {
      foldSet.add(i);
      const content = messages[i].content;
      if (typeof content === 'string') clearedChars += content.length;
    }
  }
  const next = messages.map((m, i) => {
    if (!foldSet.has(i)) return m;
    const len = typeof m.content === 'string' ? m.content.length : 0;
    return {
      ...m,
      content: `${MICROCOMPACT_PLACEHOLDER}（工具 ${m.name || (m.tool_call_id || 'unknown')}，原 ${len} 字符）`,
    };
  });
  return {
    messages: next,
    folded: foldSet.size,
    clearedChars,
    groups: foldTargets.length,
    triggered: true,
  };
}

/**
 * 请求体接线（agent-runner callChatProvider 包裹点）：
 * 开关关/窗口未知/未达阈值时原样返回；折叠命中时返回带新 messages 的浅拷贝，
 * 并打 _microcompacted 标记防同请求重复折叠。
 */
function maybeMicrocompactBody(body, ctx = {}) {
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) return body;
  if (body._microcompacted) return body;
  if (!isResilienceEnabled(process.env)) return body;
  const window = Number(ctx.contextWindow) || 0;
  if (!window) return body;
  const result = microcompactMessages(body.messages, { contextWindow: window });
  if (!result.folded) return body;
  try {
    console.log(
      `[block98-microcompact] folded=${result.folded} groups=${result.groups} ` +
      `clearedChars=${result.clearedChars} window=${window}`
    );
  } catch {}
  return {
    ...body,
    messages: result.messages,
    _microcompacted: true,
    _microcompactStats: { folded: result.folded, groups: result.groups, clearedChars: result.clearedChars },
  };
}

module.exports = {
  RESILIENCE_ENV,
  MICROCOMPACT_PLACEHOLDER,
  MIN_GROUP_TOOLS,
  KEEP_RECENT_GROUPS,
  isResilienceEnabled,
  isFolded,
  toolGroups,
  microcompactMessages,
  maybeMicrocompactBody,
};
