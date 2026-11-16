'use strict';

/**
 * helpers/ocr-provider.js — OCR 后端抽象（BLOCK-454 P3）。
 *
 * **工具语义的窄口**（刻意不进 registerProvider 的 chat/embedding/both capabilities——
 * OCR 是文档识别工具，不是模型能力槽位）。第一个 adapter 是 DeepSeek OCR
 * （POST /v1/tools/ocr，multipart file+purpose）；本地 OCR 槽位（'local'）按 D1 预置
 * 裁决**留接口不引依赖**——选择即诚实报 ocr_provider_not_implemented。
 *
 * 诚实边界：
 *  · **默认关**：config.enabled=false → ocr_access_disabled（云调用=付费副作用，P5-a）。
 *  · **未配置 ≠ 空产物**：无 key → `ocr_not_configured`（带配置指引），绝不返回空文本。
 *  · **产物明细保留**：pages[].text 逐页保留 + 版面标记探针（layoutMarkers），不只有拼接文本。
 *  · **有界**：上传体 ≤100MiB（findings 契约）；响应字节上限 32MB（1000 页文本量级）。
 *  · **成本可报**：`cost.requests`（文件级请求数）/ `cost.pages`（识别页数——按页审计口径）/ `cost.bytes`。
 *  · **key 不在本层存取**：由 getApiKeyFn 注入（凭据族唯一来源，与对话共用 'deepseek' 凭据）。
 */

const path = require('path');

const OCR_PROVIDERS = Object.freeze(['deepseek', 'local']);
const OCR_PURPOSES = Object.freeze(['text_recognition', 'rich_layout_recognition']);
// findings §2 契约：单文件 ≤100MiB / 1000 页；响应上限按 1000 页文本量级放宽到 32MB。
const OCR_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const OCR_BODY_LIMIT = 32 * 1024 * 1024;
// DeepSeek OCR 端点（findings §2 VERIFIED）。
const OCR_ENDPOINT = 'https://api.deepseek.com/v1/tools/ocr';

const MIME_BY_EXT = Object.freeze({
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
});

function extOf(name) {
  const dot = String(name || '').lastIndexOf('.');
  return dot >= 0 ? String(name).slice(dot).toLowerCase() : '';
}

/** 版面标记探针：DeepSeek 版面识别产物含 <｜ref｜>/<｜box｜> 标记（坐标 0-1000）。 */
function hasLayoutMarkers(text) {
  return typeof text === 'string' && /<｜(ref|box)｜>/.test(text);
}

/** 默认 key 查询：凭据族唯一来源（懒 require，避免轻量测试环境拖起 ai-settings）。 */
function defaultDeepseekKeyLookup() {
  try {
    // eslint-disable-next-line global-require
    const { getApiKey } = require('./ai-settings');
    return getApiKey('deepseek') || '';
  } catch {
    return '';
  }
}

/**
 * 执行 OCR。
 * @param {{buffer:Buffer, filename:string, config:object, fetchImpl?:Function, getApiKeyFn?:Function, maxUploadBytes?:number}} input
 * @returns {Promise<{ok:true, provider, purpose, pages:Array, text:string, layoutMarkers:boolean, cost:object}|{ok:false, code, message, retryable?, status?}>}
 */
async function ocrDocument(input = {}) {
  const buffer = input.buffer;
  const filename = String(input.filename || 'document');
  const config = input.config || {};
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, code: 'ocr_file_missing', message: '缺少待识别文件内容（buffer 为空）。' };
  }
  if (config.enabled !== true) {
    return {
      ok: false,
      code: 'ocr_access_disabled',
      message: 'OCR 能力未开启（默认关，云调用=付费副作用）。请在 ocr-config（ocr.json）置 enabled=true 并选择 provider 后再试。',
    };
  }
  const provider = String(config.provider || 'none');
  if (provider === 'local') {
    // D1 预置裁决：本地 OCR 引擎留接口不引依赖；诚实报，不静默空转、不 fallback 到云。
    return {
      ok: false,
      code: 'ocr_provider_not_implemented',
      message: '本地 OCR 引擎未引入（新依赖默认 no）。当前可选云渠道 provider=deepseek（需 DeepSeek API key）。',
    };
  }
  if (!OCR_PROVIDERS.includes(provider)) {
    return {
      ok: false,
      code: 'ocr_not_configured',
      message: '未选择 OCR 渠道（provider=none）。可选：deepseek（云渠道，key 与对话共用）。',
    };
  }
  const purpose = String(config.purpose || 'rich_layout_recognition');
  if (!OCR_PURPOSES.includes(purpose)) {
    return {
      ok: false,
      code: 'ocr_purpose_invalid',
      message: `purpose 必须是 ${OCR_PURPOSES.join(' | ')}，收到：${purpose}。`,
    };
  }
  const getApiKeyFn = typeof input.getApiKeyFn === 'function' ? input.getApiKeyFn : defaultDeepseekKeyLookup;
  const apiKey = String(getApiKeyFn('deepseek') || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      code: 'ocr_not_configured',
      message: '已选 DeepSeek OCR 但未配置 DeepSeek API key。请在 设置 → AI 设置 填入 DeepSeek API Key（与对话共用同一凭据）。',
    };
  }
  const maxUploadBytes = Number(input.maxUploadBytes) > 0 ? Number(input.maxUploadBytes) : OCR_MAX_UPLOAD_BYTES;
  if (buffer.length > maxUploadBytes) {
    return {
      ok: false,
      code: 'ocr_too_large',
      message: `文件过大（${buffer.length} 字节，上限 ${maxUploadBytes}）：DeepSeek OCR 单文件 ≤100MiB / 1000 页。`,
    };
  }
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, code: 'ocr_unavailable', message: '当前运行时没有 fetch，无法调用 OCR。' };
  }
  const timeoutMs = Math.max(1000, Number(config.timeoutMs) || 60000);

  // multipart 组装：purpose 必填 + file（blob 类型按扩展名提示）。
  const form = new FormData();
  form.set('purpose', purpose);
  const blob = new Blob([buffer], { type: MIME_BY_EXT[extOf(filename)] || 'application/octet-stream' });
  form.set('file', blob, path.basename(filename));

  let response;
  try {
    response = await fetchImpl(OCR_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (error) {
    const name = error && error.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, code: 'ocr_timeout', message: `OCR 超时（>${timeoutMs}ms）。`, retryable: true, provider };
    }
    return { ok: false, code: 'ocr_failed', message: `OCR 请求失败：${error && error.message ? error.message : 'unknown'}`, retryable: true, provider };
  }

  if (!response.ok) {
    return {
      ok: false,
      code: 'ocr_http_error',
      message: `DeepSeek OCR 返回 HTTP ${response.status}${response.status === 401 || response.status === 403 ? '（API key 无效或无权限，请检查 设置 → AI 设置）' : ''}。`,
      retryable: response.status >= 500,
      provider,
      status: response.status,
    };
  }

  let raw;
  try {
    raw = await response.text();
  } catch (error) {
    return { ok: false, code: 'ocr_body_failed', message: `读取 OCR 响应失败：${error && error.message ? error.message : 'unknown'}`, retryable: true, provider };
  }
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes > OCR_BODY_LIMIT) {
    return { ok: false, code: 'ocr_response_too_large', message: `OCR 响应过大（${bytes} 字节，上限 ${OCR_BODY_LIMIT}）。`, provider };
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'ocr_bad_response', message: 'DeepSeek OCR 返回的不是 JSON。', provider };
  }

  const rows = Array.isArray(payload && payload.pages) ? payload.pages : [];
  const pages = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const text = row && typeof row.text === 'string' ? row.text : '';
    pages.push({ index: i + 1, text });
  }
  const text = pages.map((p) => p.text.trim()).filter(Boolean).join('\n\n');
  return {
    ok: true,
    provider,
    purpose,
    pages,
    text,
    layoutMarkers: hasLayoutMarkers(text),
    cost: { requests: 1, bytes, pages: pages.length },
    ...(pages.length === 0 ? { note: 'OCR 返回 0 页：文件可能为空或格式不受支持。' } : {}),
  };
}

module.exports = {
  OCR_PROVIDERS,
  OCR_PURPOSES,
  OCR_MAX_UPLOAD_BYTES,
  OCR_BODY_LIMIT,
  OCR_ENDPOINT,
  ocrDocument,
  hasLayoutMarkers,
};
