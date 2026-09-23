'use strict';

/**
 * helpers/agent-resilience.js — BLOCK-98 Agent 长任务韧性（M1 microcompact 起步）。
 *
 * agent-runner 行数门（1250）零触碰：全部新逻辑下沉本文件，runner 只留接线。
 * 开关（D6）：BIOF3_AGENT_RESILIENCE——2026-09-18 用户裁决翻默认开（feature-flags 单一真相，
 * 设置页可切换）；环境变量 =1/true 强制开、=0/false 强制关（kill-switch）。
 *
 * M1 microcompact（三层压缩第 0 层，本地零模型成本）：LLM 请求视图中旧工具结果
 * 按组折叠为占位符。触发=估算 token ≥ min(窗口×0.9, 窗口−2000)；只折叠连续
 * ≥5 条的工具结果组，保留最近 5 组；占位符带标记防重复折叠。
 * 红线：只作用于当次请求的投影副本（body.messages 换新数组），loop 运行时
 * messages 与 copilot_messages 原文永不触碰（BLOCK-95 §4 原则 1 延续）。
 */

const os = require('os');
const path = require('path');
const RESILIENCE_ENV = 'BIOF3_AGENT_RESILIENCE';
const MICROCOMPACT_PLACEHOLDER = '[已折叠：旧工具结果已按上下文管理清理]';
// 组内工具结果条数下限：ZCode 原文「连续 ≥5 条」按其存储格式（工具结果连排）
// 转录；本仓运行时格式为 assistant(tool_calls)+tool 交替，语义等价适配为
// 「同一块内 ≥2 条工具结果才成组，零散单条不折」（P0 结论，回写 plan §4）。
const MIN_GROUP_TOOLS = 2;
const KEEP_RECENT_GROUPS = 5;

function isResilienceEnabled(env) {
  // BLOCK-98 灰度收编：解析权在 feature-flags（env 强制 > 设置页持久化 > 默认开）
  const { resolveFlag } = require('./feature-flags');
  return resolveFlag('agent_resilience', env);
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
  // opts.force=true：reactive 裁剪路径强制折叠（不看触发阈值，keepRecentGroups 可为 0）
  if (!opts.force && estimate < threshold) return { ...empty, triggered: false };

  const groups = toolGroups(messages);
  if (groups.length === 0) return { ...empty, triggered: true };
  // 保留最近 KEEP_RECENT_GROUPS 组（组按出现顺序，取尾部）；reactive 可覆盖为全量折叠
  const keepCount = Number(opts.keepRecentGroups != null ? opts.keepRecentGroups : KEEP_RECENT_GROUPS);
  const foldTargets = groups.slice(0, Math.max(0, groups.length - keepCount));
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

// ── M2：auto-compact 升级（阈值公式化 + 9 章节摘要模板 + 转写路径）──────────

const MAX_OUTPUT_RESERVE_CAP = 21000;
const BUFFER_ABS = 13000;
const BUFFER_RATIO = 0.08;

/**
 * D3 阈值公式：有效窗口 = 窗口 − min(maxOutput, 21K)；压缩阈值 = 有效窗口 −
 * min(13K, 8%×有效窗口)（小窗口模型 buffer 缩放，ZCode 200K 常数不硬抄）。
 * @returns {{effectiveWindow:number, buffer:number, threshold:number}|null}
 */
function planThreshold(contextWindow, maxOutput) {
  const window = Number(contextWindow) || 0;
  if (window <= 0) return null;
  const effectiveWindow = Math.max(0, window - Math.min(Number(maxOutput) || 0, MAX_OUTPUT_RESERVE_CAP));
  const buffer = Math.min(BUFFER_ABS, Math.round(effectiveWindow * BUFFER_RATIO));
  return { effectiveWindow, buffer, threshold: Math.max(0, effectiveWindow - buffer) };
}

/** 转写文件路径（BLOCK-37 llm-transcripts 家族；id 白名单同源校验）。 */
function transcriptPathFor(conversationId, dataDir) {
  const id = String(conversationId || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  const dir = dataDir
    || process.env.BIOF3_LOCAL_DATA_DIR
    || path.join(os.homedir(), 'Documents', 'BioF3-Local');
  return path.join(dir, `${id}.jsonl`);
}

/** M2 摘要系统提示词：9 章节结构化 + 安全指令逐字保留 + 禁工具（D2）。 */
const SUMMARY_NINE_SECTION_PROMPT = [
  '你是会话上下文压缩助手。把较早的对话折叠成结构化中文摘要，供后续对话作为唯一背景继续任务。要求：',
  '1. 先输出 <analysis> 段做简短分析（不超过 150 字），再输出 <summary> 正文。',
  '2. <summary> 必须包含以下 9 个编号章节（无内容的章节写「无」）：',
  '①用户原始请求与意图；②关键技术概念与实体（文件/参数/数据集/模型名）；③文件与代码段（关键路径与片段原样保留）；④错误与修复（尤其用户纠正过的行为，逐字引用用户纠正）；⑤问题求解过程；⑥全部用户消息清单（逐条列出）；⑦待办任务（未完成项）；⑧压缩前一刻正在做什么；⑨下一步（必须与用户最近的请求直接对齐，防止任务漂移）。',
  '3. 安全相关指令（如有）必须逐字保留，不得改写或省略。',
  '4. 只输出文本，禁止调用任何工具。全文不超过 1200 字。',
].join('\n');

/** 续接纪律 + 转写指针（压缩后首条摘要消息的追加行，D2）。 */
function continuationLines(transcriptPath) {
  const lines = [];
  if (transcriptPath) lines.push(`全文模型 I/O 转写（用户与审计可回查）：${transcriptPath}`);
  lines.push('续接纪律：请从中断处直接继续当前任务——不要复述或确认本摘要，像对话从未中断一样继续。');
  return lines.join('\n');
}


// ── M3：防呆状态机 + reactive 原地重试 + M5 遥测（纯函数优先，runner 只接线）──

const CIRCUIT_FAILURE_LIMIT = 3;
const CIRCUIT_COOLDOWN_MS = 10 * 60 * 1000;
const REACTIVE_USE_LIMIT = 3;

/** 单次 agent 运行的韧性状态（runner 创建、随 run 生命周期）。 */
function createResilienceState() {
  return {
    compactionFailures: 0,
    circuitOpenUntil: 0,
    reactiveUses: 0,
    contextExceededCount: 0,
  };
}

/** 连续压缩失败 ≥3 → 熔断 10 分钟（防「压缩失败→重试」死循环）。 */
function recordCompactionFailure(state, now = Date.now()) {
  state.compactionFailures = (state.compactionFailures || 0) + 1;
  if (state.compactionFailures >= CIRCUIT_FAILURE_LIMIT) {
    state.circuitOpenUntil = now + CIRCUIT_COOLDOWN_MS;
    state.compactionFailures = 0;
  }
  return state;
}

function compactionAllowed(state, now = Date.now()) {
  return !state || (state.circuitOpenUntil || 0) <= now;
}

/** reactive（超限原地重试）单 run 最多 3 次（防「重试→再超限」循环）。 */
function recordReactiveUse(state) {
  state.reactiveUses = (state.reactiveUses || 0) + 1;
  return state;
}

function reactiveAllowed(state) {
  return !state || (state.reactiveUses || 0) < REACTIVE_USE_LIMIT;
}

/**
 * context-exceeded 错误分类：对 provider 抛错（message/Body/body 字符串）
 * 做多族模式匹配（OpenAI/Anthropic/常见网关措辞）。
 */
function classifyContextExceeded(err) {
  const text = String((err && (err.message || err.body)) || err || '');
  if (!text) return false;
  const patterns = [
    /context[_ ]length[_ ]exceeded/i,
    /maximum context length/i,
    /context window/i,
    /too many tokens/i,
    /prompt is too long/i,
    /input length and `max_tokens` exceed context limit/i,
    /request too large/i,
    /exceed[s]? (the )?(maximum|context)/i,
    /content length limit/i,
  ];
  return patterns.some((re) => re.test(text));
}

/**
 * reactive 原地裁剪：两段降载——(1) 全量折叠工具组（不看最近保留窗）；
 * (2) 仍超则从最老消息起整块丢弃（切点必须落在 user / assistant 载体上，
 * 绝不产生孤儿 tool 结果），直到 ≤ target 或只剩保底尾部。
 * @returns {{messages: Array, dropped: number, foldedAll: boolean}|null} null=无法再裁
 */
function reactiveTrim(messages, opts = {}) {
  if (!Array.isArray(messages) || messages.length < 3) return null;
  const window = Number(opts.contextWindow) || 0;
  const { countMessages, countTokens } = require('./token-estimator');
  const target = Math.max(1000, Math.floor((window || 64000) * 0.6));

  // 第 1 段：全量折叠——reactive 是兜底，不受 M1 成组约束，所有未折叠工具
  // 结果直接折叠为占位符（保留 tool_call_id/name 协议字段）。
  let foldedCount = 0;
  let current = messages.map((m) => {
    if (m && m.role === 'tool' && !isFolded(m.content)) {
      foldedCount += 1;
      const len = typeof m.content === 'string' ? m.content.length : 0;
      return { ...m, content: `${MICROCOMPACT_PLACEHOLDER}（工具 ${m.name || (m.tool_call_id || 'unknown')}，原 ${len} 字符）` };
    }
    return m;
  });
  if (foldedCount > 0 && countMessages(current) <= target) {
    return { messages: current, dropped: 0, foldedAll: true };
  }

  // 第 2 段：整块丢弃（保底至少保留 system + 最后 2 条）
  const tokens = messages.map((m) => countTokens(String(m.content || '')) + 4);
  const total = tokens.reduce((a, b) => a + b, 0);
  if (total <= target) return { messages: current, dropped: 0, foldedAll: foldedCount > 0 };
  let acc = 0;
  let cut = 1; // 跳过 system
  const minKeep = Math.min(messages.length - 1, 2);
  const limit = messages.length - minKeep;
  for (let i = 1; i <= limit; i++) {
    acc += tokens[i];
    cut = i + 1;
    if (total - acc <= target) break;
  }
  // 切点推进到合法边界（user 或 assistant 载体；不可落在 tool 结果中间）
  while (cut < messages.length && messages[cut] && messages[cut].role === 'tool') cut++;
  if (cut >= messages.length) return null;
  // system 头必须保留（切点从其后算起）；dropped 与长度差一致（system 不计入）
  return { messages: [messages[0], ...current.slice(cut)], dropped: cut - 1, foldedAll: foldedCount > 0 };
}

/** M5 遥测：reactive 重试事件落 ai_usage（additive 列）。 */
function recordRetryUsage({ userId, conversationId, model, attempt, contextExceeded, error }) {
  try {
    const { recordAiUsage } = require('./ai-usage');
    recordAiUsage({
      userId: userId || null,
      kind: 'llm_retry',
      model: model || null,
      conversationId: conversationId || null,
      errorCode: contextExceeded ? 'context_exceeded' : String(error || 'unknown').slice(0, 120),
      attempt: Number(attempt) || 0,
      retryable: 1,
      contextExceeded: contextExceeded ? 1 : 0,
    });
  } catch { /* 遥测失败不阻塞主链 */ }
}



// ── M4：输入插队队列（进程内；与 ZCode session_input 的 admitted→promoted 同型）──
// 任务运行中用户消息不拒绝而是入队，下一次模型请求边界 drain 注入。
// 队列生命周期=单次运行（任务终态由调用方清空；进程重启队列消失=诚实降级为留言）。
// 子智能体实时 steering（2026-09-23）：send_message/queueUserMessage 复用同一
// 队列，条目扩展为 {text, meta}；meta.parentMessageSeq 供送达回执（delivered
// refs）与 followup 去重，meta.preformatted 表示 text 已带来源前缀。
const pendingInputQueues = new Map();

function enqueueUserInput(taskId, text, meta = null) {
  const id = String(taskId || '');
  const t = String(text || '').trim();
  if (!id || !t) return { ok: false, error: 'invalid_arguments' };
  let q = pendingInputQueues.get(id);
  if (!q) { q = []; pendingInputQueues.set(id, q); }
  if (q.length >= 20) return { ok: false, error: 'queue_full', message: '排队消息过多（>20），请稍候再发' };
  q.push({ text: t.slice(0, 8000), meta: meta && typeof meta === 'object' ? meta : null });
  return { ok: true, queued: true, depth: q.length };
}

function drainUserInput(taskId) {
  const id = String(taskId || '');
  const q = pendingInputQueues.get(id);
  if (!q || q.length === 0) return [];
  pendingInputQueues.delete(id);
  return q;
}

function pendingInputCount(taskId) {
  const q = pendingInputQueues.get(String(taskId || ''));
  return q ? q.length : 0;
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
  planThreshold,
  transcriptPathFor,
  SUMMARY_NINE_SECTION_PROMPT,
  continuationLines,

  // ── M3+M5：防呆状态机 / context-exceeded 分类 / reactive 原地重试 ─────────

  createResilienceState,
  recordCompactionFailure,
  compactionAllowed,
  recordReactiveUse,
  reactiveAllowed,
  classifyContextExceeded,
  reactiveTrim,
  recordRetryUsage,

  // ── M4：输入插队队列（steering；运行中用户消息下一轮请求注入）────────────

  enqueueUserInput,
  drainUserInput,
  pendingInputCount,
};
