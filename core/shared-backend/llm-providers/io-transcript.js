/**
 * llm-providers/io-transcript.js — 模型 I/O 信息流落盘（BLOCK-37 P1）。
 *
 * 覆盖「所有模型调用」的请求与响应完整原文持久化：
 * - 按会话分文件追加 JSONL（<dataDir>/llm-transcripts/<conversationId>.jsonl），
 *   无 conversationId 的调用归 unattributed.jsonl。
 * - 每条记录 = 一次真实模型交互：请求 messages 全量 + 响应聚合全文
 *   （content / reasoning_content / tool_calls / finish_reason / usage）+ delta 帧样本。
 * - 截断纪律（诚实标记）：单条硬上限 8MB——超限先丢 delta 帧（保聚合响应完整），
 *   再折叠 request.messages 中段（保首尾 + messagesTruncated 计数），
 *   仍超限则逐条截断单条 message 内容。
 * - 文件轮转：活跃文件超 64MB 先改名留存再开新文件。
 * - 本模块绝不抛错：写失败静默（调用方 fire-and-forget），不影响模型调用主链路。
 */

const fs = require('fs');
const path = require('path');

const MAX_RECORD_BYTES_DEFAULT = 8 * 1024 * 1024; // 8MB
const MAX_FRAMES_DEFAULT = 2000;
const MAX_FILE_BYTES_DEFAULT = 64 * 1024 * 1024; // 64MB
const UNATTRIBUTED = 'unattributed';
const MESSAGE_KEEP_HEAD = 4;
const MESSAGE_KEEP_TAIL = 16;
const MESSAGE_CONTENT_CLIP = 2000;

function safeStringify(value) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (key, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    });
  } catch {
    return 'null';
  }
}

function safeIdPart(value) {
  const raw = String(value || '');
  // 路径安全：只留字母数字、连字符、下划线；空值归 unattributed
  const cleaned = raw.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || UNATTRIBUTED;
}

function stampId(now = () => new Date()) {
  return `rt_${now().getTime()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 从 provider 聚合结果中提取响应全文（诚实保留 reasoning / tool_calls / usage）。 */
function normalizeResponse(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.error) return null;
  const choice = result.choices && result.choices[0];
  const message = choice && choice.message ? choice.message : {};
  return {
    content: typeof message.content === 'string' ? message.content : '',
    // BLOCK-82: reasoning_content 优先，缺失时兜底 reasoning（sensenova 系字段名）
    reasoningContent: pickReasoningContent(message),
    toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : undefined,
    finishReason: choice ? choice.finish_reason : undefined,
    usage: result.usage && typeof result.usage === 'object' ? result.usage : undefined,
  };
}

// BLOCK-82: reasoning_content 优先（DeepSeek 系）；非字符串时兜底 reasoning（sensenova 系）。
// reasoning_content 为字符串（含空串）时行为与既有契约完全一致。
function pickReasoningContent(message) {
  if (typeof message.reasoning_content === 'string') return message.reasoning_content;
  if (typeof message.reasoning === 'string') return message.reasoning;
  return undefined;
}

function clipMessageForBudget(message) {
  const next = { ...message };
  if (typeof next.content === 'string' && next.content.length > MESSAGE_CONTENT_CLIP) {
    next.content = `${next.content.slice(0, MESSAGE_CONTENT_CLIP)}…[BLOCK-37 截断]`;
  }
  if (Array.isArray(next.content)) {
    // 多模态 content 数组：文本片段逐段截断
    next.content = next.content.map((part) => {
      if (part && typeof part === 'object' && typeof part.text === 'string' && part.text.length > MESSAGE_CONTENT_CLIP) {
        return { ...part, text: `${part.text.slice(0, MESSAGE_CONTENT_CLIP)}…[BLOCK-37 截断]` };
      }
      // BLOCK-155 P2-2：image_url 部件的 data URL 同样逐条截断——chat 内联链每轮
      // 迭代重新内联，不裁则同一张图（≤4MB→≈5.4MB base64）在 N 轮 loop 里落盘 N 次
      if (
        part && typeof part === 'object' && part.type === 'image_url' && part.image_url
        && typeof part.image_url.url === 'string' && part.image_url.url.length > MESSAGE_CONTENT_CLIP
      ) {
        return { ...part, image_url: { ...part.image_url, url: `${part.image_url.url.slice(0, MESSAGE_CONTENT_CLIP)}…[BLOCK-37 截断]` } };
      }
      return part;
    });
  }
  if (typeof next.reasoning_content === 'string' && next.reasoning_content.length > MESSAGE_CONTENT_CLIP) {
    next.reasoning_content = `${next.reasoning_content.slice(0, MESSAGE_CONTENT_CLIP)}…[BLOCK-37 截断]`;
  }
  return next;
}

/** 三级截断（仅在超限时逐级触发）：丢帧 → 折叠 messages 中段 → 逐条截断内容。全部诚实标记。 */
function applyTruncation(record, maxBytes) {
  const size = () => safeStringify(record).length;
  if (size() <= maxBytes) return record;
  record.truncated = true;

  // 第一级：丢 delta 帧（聚合响应保持完整）
  if (record.frames && record.frames.length > 0) {
    record.frames = [];
    record.framesTruncated = true;
  }
  if (size() <= maxBytes) return record;

  // 第二级：折叠 request.messages 中段（保首尾）
  const messages = Array.isArray(record.request && record.request.messages)
    ? record.request.messages
    : null;
  if (messages && messages.length > MESSAGE_KEEP_HEAD + MESSAGE_KEEP_TAIL) {
    const head = messages.slice(0, MESSAGE_KEEP_HEAD);
    const tail = messages.slice(-MESSAGE_KEEP_TAIL);
    const dropped = messages.length - MESSAGE_KEEP_HEAD - MESSAGE_KEEP_TAIL;
    record.request.messages = [
      ...head,
      { role: 'system', content: `[BLOCK-37 截断：中段 ${dropped} 条消息未存盘]` },
      ...tail,
    ];
    record.messagesTruncated = dropped;
  }
  if (size() <= maxBytes) return record;

  // 第三级：逐条截断 message 内容（含已保留的首尾与响应聚合）
  if (messages) {
    record.request.messages = record.request.messages.map(clipMessageForBudget);
  }
  if (record.response) {
    if (typeof record.response.content === 'string' && record.response.content.length > MESSAGE_CONTENT_CLIP) {
      record.response.content = `${record.response.content.slice(0, MESSAGE_CONTENT_CLIP)}…[BLOCK-37 截断]`;
    }
    if (typeof record.response.reasoningContent === 'string' && record.response.reasoningContent.length > MESSAGE_CONTENT_CLIP) {
      record.response.reasoningContent = `${record.response.reasoningContent.slice(0, MESSAGE_CONTENT_CLIP)}…[BLOCK-37 截断]`;
    }
  }
  return record;
}

/**
 * 创建落盘 sink。
 * @param {object} options
 * @param {string} options.dataDir 本地数据根目录（BIOF3_LOCAL_DATA_DIR 同源解析）
 * @param {number} [options.maxRecordBytes] 单条记录上限（默认 8MB）
 * @param {number} [options.maxFrames] 单条记录保留的 delta 帧上限（默认 2000）
 * @param {number} [options.maxFileBytes] 单文件轮转阈值（默认 64MB）
 * @param {object} [options.fs] 可注入 fs（测试用）
 * @param {() => Date} [options.now] 可注入时钟（测试用）
 */
function createIoTranscriptSink(options = {}) {
  const dataDir = String(options.dataDir || '');
  if (!dataDir) throw new Error('createIoTranscriptSink requires dataDir');
  const dir = path.join(dataDir, 'llm-transcripts');
  const maxRecordBytes = Number.isFinite(options.maxRecordBytes) ? options.maxRecordBytes : MAX_RECORD_BYTES_DEFAULT;
  const maxFileBytes = Number.isFinite(options.maxFileBytes) ? options.maxFileBytes : MAX_FILE_BYTES_DEFAULT;
  const fsMod = options.fs || fs;
  const now = options.now || (() => new Date());

  function ensureDir() {
    try {
      fsMod.mkdirSync(dir, { recursive: true });
    } catch {
      // 已存在或不可创建——后续 appendFileSync 自会失败并被吞掉
    }
  }

  function targetFile(conversationId) {
    return path.join(dir, `${safeIdPart(conversationId)}.jsonl`);
  }

  /** 活跃文件超阈值时轮转留存（重命名后开新文件）。 */
  function rotateIfNeeded(file) {
    try {
      const stat = fsMod.statSync(file);
      if (stat && stat.size >= maxFileBytes) {
        fsMod.renameSync(file, `${file.slice(0, -6)}.${now().getTime()}.jsonl`);
      }
    } catch {
      // 文件不存在等情况直接忽略
    }
  }

  /**
   * 记录一次模型交互。fire-and-forget：同步段吞错，不向调用方抛任何异常。
   * @param {object} entry
   * @param {object} [entry.telemetry] {userId?, conversationId?, kind?, traceId?}
   * @param {object} [entry.requestBody] OpenAI 兼容请求体（messages 全量）
   * @param {object} [entry.result] provider 聚合结果（成功或 {error}）
   * @param {Array} [entry.frames] 流式 delta 帧样本（已按 maxFrames 截取）
   * @param {boolean} [entry.framesTruncated] 帧是否超上限被截
   * @param {string} [entry.provider] provider 名
   * @param {string} [entry.profileId] 模型配置 id
   * @param {string} [entry.role] gateway 角色（chat/agent/vision…）
   * @param {number} [entry.attemptIndex] fallback 尝试序号（0 = 首选）
   * @param {number} [entry.durationMs] 调用耗时
   */
  function record(entry) {
    try {
      const src = entry || {};
      const telemetry = src.telemetry && typeof src.telemetry === 'object' ? src.telemetry : {};
      const response = normalizeResponse(src.result);
      const record_ = {
        id: stampId(now),
        ts: now().toISOString(),
        conversationId: telemetry.conversationId || null,
        kind: telemetry.kind || 'chat',
        traceId: telemetry.traceId || undefined,
        userId: telemetry.userId || undefined,
        role: src.role || 'chat',
        provider: src.provider || undefined,
        profileId: src.profileId || undefined,
        attemptIndex: Number.isFinite(src.attemptIndex) ? src.attemptIndex : 0,
        model: src.model || undefined,
        durationMs: Number.isFinite(src.durationMs) ? src.durationMs : undefined,
        request: {
          messages: Array.isArray(src.requestBody && src.requestBody.messages) ? src.requestBody.messages : [],
          params: safeStringify({ ...(src.requestBody || {}), messages: undefined }),
        },
        response,
        error: src.result && src.result.error
          ? (typeof src.result.error === 'string' ? src.result.error : String(src.result.error.code || src.result.error.type || 'api_error'))
          : null,
        frames: Array.isArray(src.frames) ? src.frames : undefined,
        framesCount: Number.isFinite(src.framesCount) ? src.framesCount : (Array.isArray(src.frames) ? src.frames.length : 0),
        framesTruncated: src.framesTruncated === true,
        truncated: false,
        messagesTruncated: 0,
      };

      const sized = applyTruncation(record_, maxRecordBytes);
      const line = safeStringify(sized);
      if (!line || line === 'null') return;

      ensureDir();
      const file = targetFile(sized.conversationId);
      rotateIfNeeded(file);
      fsMod.appendFileSync(file, `${line}\n`);
    } catch {
      // 落盘永不影响主链路
    }
  }

  return { record, dir };
}

/**
 * BLOCK-38 P1 — 取证读取：会话信息流末条（中断续跑前的「中断前最后状态」摘要来源）。
 * 只读；活跃文件为空/不存在时回退最近的轮转留存文件（<id>.<ts>.jsonl 按名字取最新）。
 * 任何失败返回 null（诚实空态），绝不抛错。
 */
function readLastRecord(conversationId, options = {}) {
  try {
    const dataDir = String(options.dataDir || '');
    if (!dataDir) return null;
    const fsMod = options.fs || fs;
    const dir = path.join(dataDir, 'llm-transcripts');
    const stem = safeIdPart(conversationId);
    const active = path.join(dir, `${stem}.jsonl`);

    let lines = [];
    try {
      lines = fsMod.readFileSync(active, 'utf8').split('\n').filter((line) => line.trim());
    } catch {}
    if (lines.length === 0) {
      // 回退轮转留存文件：按文件名取时间戳后缀最大的
      try {
        const archived = fsMod
          .readdirSync(dir)
          .filter((name) => name.startsWith(`${stem}.`) && name.endsWith('.jsonl'))
          .sort();
        for (let i = archived.length - 1; i >= 0 && lines.length === 0; i--) {
          try {
            lines = fsMod
              .readFileSync(path.join(dir, archived[i]), 'utf8')
              .split('\n')
              .filter((line) => line.trim());
          } catch {}
        }
      } catch {}
    }
    if (lines.length === 0) return null;
    const parsed = JSON.parse(lines[lines.length - 1]);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

module.exports = {
  createIoTranscriptSink,
  normalizeResponse,
  applyTruncation,
  readLastRecord,
  safeIdPart,
  UNATTRIBUTED,
  MAX_RECORD_BYTES_DEFAULT,
  MAX_FRAMES_DEFAULT,
};
