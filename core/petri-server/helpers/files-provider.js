'use strict';

/**
 * helpers/files-provider.js — DeepSeek Files API 窄口（BLOCK-454 P4）。
 *
 * 两步文件输入链的第一步：上传文件拿 file_id；第二步=对话内联文件块按协议归一
 * （Chat {type:"file"} / Responses {type:"input_file"} / Messages {type:"document"}，
 * Messages 需 anthropic-beta: files-api-2025-04-14）。
 *
 * 契约（findings §1 + 2026-11-17 官方文档补抓，VERIFIED）：
 *   POST https://api.deepseek.com/files，multipart，**purpose 必填且须在 file 之前**（官方 400 强约束）；
 *   purpose ∈ text_recognition | rich_layout_recognition | user_data；
 *   响应 {id, object:"file", bytes, created_at, filename, purpose}；
 *   ≤100MiB（413）/1000 页；上传 120s（408）/解析 120s（504）；同时上传 ≤15（429）；
 *   每请求引用 ≤20 文档、文档文字合计 ≤8MiB；file_id 可跨请求复用；原始文件不可下载。
 *
 * 诚实边界：
 *  · key 走凭据族（getApiKeyFn 注入，'deepseek' 与对话共用），本层不存取凭据。
 *  · **本层不自动触发**：上传是显式动作（付费=一次性按页解析计费，P5-a）；knowledge
 *    自动摄取不上传云端，只有显式调用（uploadKnowledgeDocumentForChat 等）才发生。
 *  · 错误诚实：413/429/401 都翻译成带指引的 files_http_error，不静默。
 */

const path = require('path');

const FILES_ENDPOINT = 'https://api.deepseek.com/files';
const FILE_PURPOSES = Object.freeze(['text_recognition', 'rich_layout_recognition', 'user_data']);
const PROTOCOLS = Object.freeze(['chat', 'responses', 'messages']);
// Anthropic Messages 协议引用 file_id 所需的 beta 功能头（官方契约逐字）。
const FILES_BETA_HEADER = 'files-api-2025-04-14';
const FILES_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

function extOf(name) {
  const dot = String(name || '').lastIndexOf('.');
  return dot >= 0 ? String(name).slice(dot).toLowerCase() : '';
}

const MIME_BY_EXT = new Map(Object.entries({
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
}));

/** 默认 key 查询：凭据族唯一来源（懒 require，避免轻量测试环境拖起 ai-settings）。 */
function defaultDeepseekKeyLookup() {
  try {
     
    const { getApiKey } = require('./ai-settings');
    return getApiKey('deepseek') || '';
  } catch {
    return '';
  }
}

/**
 * 上传文件拿 file_id（Files API）。
 * @param {{buffer:Buffer, filename:string, purpose:string, config?:{timeoutMs?:number}, fetchImpl?:Function, getApiKeyFn?:Function, maxUploadBytes?:number}} input
 * @returns {Promise<{ok:true, fileId, object, bytes, createdAt, filename, purpose, cost}|{ok:false, code, message, retryable?, status?}>}
 */
async function uploadFile(input = {}) {
  const buffer = input.buffer;
  const filename = String(input.filename || 'document');
  const purpose = String(input.purpose || '');
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, code: 'files_missing_buffer', message: '缺少待上传文件内容（buffer 为空）。' };
  }
  if (!FILE_PURPOSES.includes(purpose)) {
    return {
      ok: false,
      code: 'files_purpose_invalid',
      message: `purpose 必须是 ${FILE_PURPOSES.join(' | ')}，收到：${purpose || '(empty)'}。`,
    };
  }
  const getApiKeyFn = typeof input.getApiKeyFn === 'function' ? input.getApiKeyFn : defaultDeepseekKeyLookup;
  const apiKey = String(getApiKeyFn('deepseek') || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      code: 'files_not_configured',
      message: '未配置 DeepSeek API key。请在 设置 → AI 设置 填入 DeepSeek API Key（Files API 与对话共用同一凭据）。',
    };
  }
  const maxUploadBytes = Number(input.maxUploadBytes) > 0 ? Number(input.maxUploadBytes) : FILES_MAX_UPLOAD_BYTES;
  if (buffer.length > maxUploadBytes) {
    return {
      ok: false,
      code: 'files_too_large',
      message: `文件过大（${buffer.length} 字节，上限 ${maxUploadBytes}）：Files API 单文件 ≤100 MiB（超出返回 413）且 ≤1000 页。`,
    };
  }
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, code: 'files_unavailable', message: '当前运行时没有 fetch，无法上传文件。' };
  }
  const timeoutMs = Math.max(1000, Number(input.config && input.config.timeoutMs) || 120000);

  // 官方 400 强约束：purpose 字段必须放在 file 字段之前（FormData 保序）。
  const form = new FormData();
  form.set('purpose', purpose);
  const blob = new Blob([buffer], { type: MIME_BY_EXT.get(extOf(filename)) || 'application/octet-stream' });
  form.set('file', blob, path.basename(filename));

  let response;
  try {
    response = await fetchImpl(FILES_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (error) {
    const name = error && error.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, code: 'files_timeout', message: `上传超时（>${timeoutMs}ms；官方上传时限 120s）。`, retryable: true };
    }
    return { ok: false, code: 'files_failed', message: `上传请求失败：${error && error.message ? error.message : 'unknown'}`, retryable: true };
  }

  if (!response.ok) {
    const status = response.status;
    const hint = status === 413
      ? '（文件超过 100 MiB 上限）'
      : status === 429
        ? '（同时上传数已达上限 15，稍后重试）'
        : status === 408
          ? '（上传须在 120 秒内完成）'
          : status === 504
            ? '（解析时限 120 秒超时）'
            : status === 401 || status === 403
              ? '（API key 无效或无权限，请检查 设置 → AI 设置）'
              : '';
    return {
      ok: false,
      code: 'files_http_error',
      message: `Files API 返回 HTTP ${status}${hint}。`,
      retryable: status >= 500 && status !== 504,
      status,
    };
  }

  let raw;
  try {
    raw = await response.text();
  } catch (error) {
    return { ok: false, code: 'files_body_failed', message: `读取上传响应失败：${error && error.message ? error.message : 'unknown'}`, retryable: true };
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'files_bad_response', message: 'Files API 返回的不是 JSON。' };
  }
  if (!payload || typeof payload.id !== 'string' || !payload.id) {
    return { ok: false, code: 'files_bad_response', message: `Files API 响应缺少 id 字段（file_id）：${raw.slice(0, 200)}` };
  }
  return {
    ok: true,
    fileId: payload.id,
    object: typeof payload.object === 'string' ? payload.object : undefined,
    bytes: Number.isFinite(Number(payload.bytes)) ? Number(payload.bytes) : buffer.length,
    createdAt: payload.created_at,
    filename: typeof payload.filename === 'string' ? payload.filename : filename,
    purpose: typeof payload.purpose === 'string' ? payload.purpose : purpose,
    cost: { requests: 1, bytes: buffer.length },
  };
}

/**
 * 对话内联文件块按协议归一（官方逐字契约）。
 * @param {string} fileId - Files API 返回的 id（file-api-*）
 * @param {'chat'|'responses'|'messages'} protocol
 */
function fileContentBlockForProtocol(fileId, protocol) {
  const id = String(fileId || '');
  if (!id) throw new Error('file_id_required');
  if (protocol === 'chat') return { type: 'file', file_id: id };
  if (protocol === 'responses') return { type: 'input_file', file_id: id };
  if (protocol === 'messages') return { type: 'document', source: { type: 'file', file_id: id } };
  throw new Error(`unknown_protocol:${protocol}（chat | responses | messages）`);
}

/**
 * 探测 OpenAI 形请求体是否含 file 引用块（Chat 形 {type:"file",file_id}）。
 * 供 anthropic.js 决定是否带 anthropic-beta files header（Messages 协议契约）。
 */
function bodyHasFileReference(body) {
  if (!body || !Array.isArray(body.messages)) return false;
  return body.messages.some((message) => Array.isArray(message && message.content)
    && message.content.some((part) => part && part.type === 'file' && part.file_id));
}

module.exports = {
  FILES_ENDPOINT,
  FILE_PURPOSES,
  PROTOCOLS,
  FILES_BETA_HEADER,
  FILES_MAX_UPLOAD_BYTES,
  uploadFile,
  fileContentBlockForProtocol,
  bodyHasFileReference,
};
