'use strict';

/**
 * asr-provider.js — 语音转写窄口（BLOCK-454 P6）。
 *
 * 契约（findings §2，VERIFIED）：POST https://api.deepseek.com/v1/tools/asr，
 * multipart/form-data + Bearer；file 限 16bit PCM WAV 或 Ogg Opus；≤8MiB/120 秒；
 * 19 种语言自动识别；响应 {text, duration_ms}；50 并发。
 *
 * 诚实边界（与 ocr-provider 同款纪律）：
 *  · 默认关（config.enabled=false → asr_access_disabled；云调用=付费副作用 P5-a）。
 *  · key 走凭据族（getApiKeyFn 注入，'deepseek' 与对话共用），本层不存取凭据。
 *  · 格式守卫按魔数判定（RIFF/WAVE、OggS）——其他格式诚实拒并指路，不猜不转码。
 *  · 成本计量 cost.requests/bytes。WS 流式契约在 findings 在册但本期不接（留接口）。
 */

const ASR_ENDPOINT = 'https://api.deepseek.com/v1/tools/asr';
const ASR_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** 默认 key 查询：凭据族唯一来源（懒 require，避免轻量测试环境拖起 ai-settings）。 */
function defaultDeepseekKeyLookup() {
  try {
     
    const { getApiKey } = require('./ai-settings');
    return getApiKey('deepseek') || '';
  } catch {
    return '';
  }
}

/** 音频魔数判定：16bit PCM WAV（RIFF…WAVE）或 Ogg（OggS）。 */
function detectAudioFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (buffer.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  return null;
}

/**
 * 语音转写（ASR）。
 * @param {{buffer:Buffer, filename:string, config:{enabled:boolean, provider:string, timeoutMs?:number}, fetchImpl?:Function, getApiKeyFn?:Function, maxUploadBytes?:number}} input
 * @returns {Promise<{ok:true, provider, text, durationMs, cost}|{ok:false, code, message, retryable?, status?}>}
 */
async function transcribeAudio(input = {}) {
  const buffer = input.buffer;
  const filename = String(input.filename || 'audio');
  const config = input.config || {};
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, code: 'asr_file_missing', message: '缺少待转写音频内容（buffer 为空）。' };
  }
  if (config.enabled !== true) {
    return {
      ok: false,
      code: 'asr_access_disabled',
      message: '语音转写未开启（默认关，云调用=付费副作用）。请在 speech-config（speech-config.json）置 enabled=true 并选择 provider 后再试。',
    };
  }
  const provider = String(config.provider || 'none');
  if (provider !== 'deepseek') {
    return {
      ok: false,
      code: 'asr_not_configured',
      message: '未选择语音转写渠道（provider=none）。可选：deepseek（云渠道，key 与对话共用）。',
    };
  }
  const getApiKeyFn = typeof input.getApiKeyFn === 'function' ? input.getApiKeyFn : defaultDeepseekKeyLookup;
  const apiKey = String(getApiKeyFn('deepseek') || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      code: 'asr_not_configured',
      message: '已选 DeepSeek 语音转写但未配置 DeepSeek API key。请在 设置 → AI 设置 填入 DeepSeek API Key（与对话共用同一凭据）。',
    };
  }
  const audioFormat = detectAudioFormat(buffer);
  if (!audioFormat) {
    return {
      ok: false,
      code: 'asr_format_unsupported',
      message: '音频格式不受支持：ASR 仅接受 16bit PCM WAV 或 Ogg Opus（按文件魔数判定）。请先转码（如 ffmpeg -i in.mp3 -ar 16000 out.wav）。',
    };
  }
  const maxUploadBytes = Number(input.maxUploadBytes) > 0 ? Number(input.maxUploadBytes) : ASR_MAX_UPLOAD_BYTES;
  if (buffer.length > maxUploadBytes) {
    return {
      ok: false,
      code: 'asr_too_large',
      message: `音频过大（${buffer.length} 字节，上限 ${maxUploadBytes}）：DeepSeek ASR 单文件 ≤8MiB / 120 秒。`,
    };
  }
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, code: 'asr_unavailable', message: '当前运行时没有 fetch，无法调用 ASR。' };
  }
  const timeoutMs = Math.max(1000, Number(config.timeoutMs) || 120000);

  // multipart 组装（findings：file 字段；格式由文件内容判定）。
  const form = new FormData();
  const blob = new Blob([buffer], { type: audioFormat === 'wav' ? 'audio/wav' : 'audio/ogg' });
  form.set('file', blob, path_basename(filename));

  let response;
  try {
    response = await fetchImpl(ASR_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (error) {
    const name = error && error.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, code: 'asr_timeout', message: `转写超时（>${timeoutMs}ms；官方上传时限 120 秒）。`, retryable: true, provider };
    }
    return { ok: false, code: 'asr_failed', message: `转写请求失败：${error && error.message ? error.message : 'unknown'}`, retryable: true, provider };
  }

  if (!response.ok) {
    return {
      ok: false,
      code: 'asr_http_error',
      message: `DeepSeek ASR 返回 HTTP ${response.status}${response.status === 401 || response.status === 403 ? '（API key 无效或无权限，请检查 设置 → AI 设置）' : ''}。`,
      retryable: response.status >= 500 && response.status !== 401 && response.status !== 403,
      provider,
      status: response.status,
    };
  }

  let raw;
  try {
    raw = await response.text();
  } catch (error) {
    return { ok: false, code: 'asr_body_failed', message: `读取转写响应失败：${error && error.message ? error.message : 'unknown'}`, retryable: true, provider };
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'asr_bad_response', message: 'DeepSeek ASR 返回的不是 JSON。', provider };
  }
  if (!payload || typeof payload.text !== 'string') {
    return { ok: false, code: 'asr_bad_response', message: `ASR 响应缺少 text 字段：${raw.slice(0, 200)}`, provider };
  }
  return {
    ok: true,
    provider,
    text: payload.text,
    durationMs: Number.isFinite(Number(payload.duration_ms)) ? Number(payload.duration_ms) : null,
    cost: { requests: 1, bytes: buffer.length },
  };
}

function path_basename(p) {
  const normalized = String(p || '').replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

module.exports = {
  ASR_ENDPOINT,
  ASR_MAX_UPLOAD_BYTES,
  transcribeAudio,
  detectAudioFormat,
};
