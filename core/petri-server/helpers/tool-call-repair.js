'use strict';

// BLOCK-179 — 正文工具块修复提升：候选扫描 + fail-closed 提升决策。
//
// 模型偶发退化：把本应走 function-calling 通道的工具调用写成正文（围栏 JSON /
// 裸 JSON 对象 / <tool_call> 标签）。loop 的现状是 toolCalls===0 时正文直接按
// 最终回答收口——任务静默死亡。本 helper 扫描这类正文并保守地裁决「是否提升」：
//
// 解析形态（三形态同一覆盖）：对正文做字符串感知的顶层平衡扫描，任何可解析的
// 顶层 JSON 对象，凡具备 name|tool + arguments|args|parameters 形态即候选；
// 围栏代码块与标签只是包裹语境，内部 JSON 天然被同一扫描覆盖；嵌套对象不算
// （仅顶层），防止把数据结构里的同名字段误当调用。
//
// 保护规则（防误伤，全部 fail-closed）：
//   a) 任一候选 name 不在可用名单 → 整轮 keep（判定为演示/文档引用）；
//   b) arguments 非对象 → 该块弃（invalid_arguments），其余好块照常提升；
//   c) 候选数 > maxCalls（缺省 5）→ 整轮 keep；
//   d) 扫描全程无异常外抛，空/非字符串输入恒 keep。
//
// keep 决策零行为变化（additive 契约）；reasons 供事件与 console 审计。

const MAX_REPAIR_CALLS_PER_TURN = 5;
const NAME_KEYS = ['name', 'tool'];
const ARGS_KEYS = ['arguments', 'args', 'parameters'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readStringField(obj, keys) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

// 字符串感知的花括号配对：跳过引号内内容（含转义），返回与 start 配对的 '}' 下标。
function matchBrace(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// 顶层平衡扫描：外层对象解析失败也跳过其内部（嵌套同名字段不产生候选）。
function scanTopLevelJsonObjects(text) {
  const spans = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '{') {
      const end = matchBrace(text, i);
      if (end === -1) {
        i += 1;
        continue;
      }
      const raw = text.slice(i, end + 1);
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        value = undefined;
      }
      if (value !== undefined) spans.push({ raw, value });
      i = end + 1;
    } else {
      i += 1;
    }
  }
  return spans;
}

// 单个 JSON 对象 → 调用候选分类：call（可提升）/ broken_call（形态像调用但参数
// 非法，留审计 reason）/ other（非调用形态）。arguments 一律规范化为 JSON 字符串。
function classifyObject(value) {
  if (!isPlainObject(value)) return { kind: 'other' };
  if (Array.isArray(value.tool_calls)) return { kind: 'batch', items: value.tool_calls };
  const name = readStringField(value, NAME_KEYS);
  if (!name) return { kind: 'other' };

  let argsKey = null;
  for (const key of ARGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      argsKey = key;
      break;
    }
  }
  if (!argsKey) return { kind: 'call', name, arguments: '{}' };

  const raw = value[argsKey];
  let argsString;
  if (typeof raw === 'string') argsString = raw;
  else if (isPlainObject(raw)) {
    try {
      argsString = JSON.stringify(raw);
    } catch {
      return { kind: 'broken_call', name };
    }
  } else {
    return { kind: 'broken_call', name };
  }

  let decoded;
  try {
    decoded = argsString.trim() ? JSON.parse(argsString) : {};
  } catch {
    return { kind: 'broken_call', name };
  }
  if (!isPlainObject(decoded)) return { kind: 'broken_call', name };
  return { kind: 'call', name, arguments: JSON.stringify(decoded) };
}

function unique(values) {
  return [...new Set(values)];
}

/**
 * 扫描正文中的可提升工具调用候选并给出保守决策。
 * @param {string} text 模型正文（流式聚合或 message.content）
 * @param {{availableToolNames?: Set<string>|string[], maxCalls?: number}} options
 *   availableToolNames = 本次 run 声明的工具名单（config.tools 收窄后口径）；
 *   名单缺失视为空名单（全 keep）。
 * @returns {{decision: 'repair'|'keep', calls: {name, arguments}[], blocks: number, reasons: object[]}}
 */
function scanPlainTextToolCalls(text, options = {}) {
  const keepEmpty = { decision: 'keep', calls: [], blocks: 0, reasons: [] };
  const content = typeof text === 'string' ? text : '';
  if (!content.trim()) return keepEmpty;

  const available = options.availableToolNames instanceof Set
    ? options.availableToolNames
    : new Set(Array.isArray(options.availableToolNames) ? options.availableToolNames : []);
  const maxCalls = Number.isFinite(options.maxCalls) && options.maxCalls > 0
    ? Math.floor(options.maxCalls)
    : MAX_REPAIR_CALLS_PER_TURN;

  const calls = [];
  const reasons = [];
  for (const span of scanTopLevelJsonObjects(content)) {
    const classified = classifyObject(span.value);
    if (classified.kind === 'call') {
      calls.push({ name: classified.name, arguments: classified.arguments });
    } else if (classified.kind === 'broken_call') {
      reasons.push({ code: 'invalid_arguments', tool: classified.name });
    } else if (classified.kind === 'batch') {
      for (const item of classified.items) {
        const sub = classifyObject(item);
        if (sub.kind === 'call') calls.push({ name: sub.name, arguments: sub.arguments });
        else if (sub.kind === 'broken_call') reasons.push({ code: 'invalid_arguments', tool: sub.name });
      }
    }
  }

  if (calls.length === 0) {
    return { decision: 'keep', calls: [], blocks: reasons.length, reasons };
  }

  const unknown = calls.filter((call) => !available.has(call.name));
  if (unknown.length > 0) {
    return {
      decision: 'keep',
      calls: [],
      blocks: calls.length,
      reasons: [{ code: 'unknown_tool_name', tools: unique(unknown.map((call) => call.name)) }, ...reasons],
    };
  }
  if (calls.length > maxCalls) {
    return {
      decision: 'keep',
      calls: [],
      blocks: calls.length,
      reasons: [{ code: 'too_many_candidates', count: calls.length, maxCalls }, ...reasons],
    };
  }
  return { decision: 'repair', calls, blocks: calls.length, reasons };
}

module.exports = {
  scanPlainTextToolCalls,
};
