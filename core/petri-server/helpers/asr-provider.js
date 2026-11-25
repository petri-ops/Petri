'use strict';

/**
 * asr-provider.js — 语音转写窄口（BLOCK-454 P6；BLOCK-519 provider 链扩展）。
 *
 * 云渠道契约（findings §2，VERIFIED）：POST https://api.deepseek.com/v1/tools/asr，
 * multipart/form-data + Bearer；file 限 16bit PCM WAV 或 Ogg Opus；≤8MiB/120 秒；
 * 响应 {text, duration_ms}；key 走凭据族（'deepseek' 与对话共用）。
 *
 * BLOCK-519 — provider_chain 顺序即回退链：local（SenseVoice/sherpa-onnx）→
 * deepseek 云 → 诚实报错；成功回执带 provider 来源与 fallbacks 轨迹。
 * 单 provider（legacy none|deepseek）行为逐字保留，旧调用方零行为变化。
 *
 * 诚实边界：
 *  · 默认关（config.enabled=false → asr_access_disabled）。
 *  · 格式/体积/超时守卫按魔数与字节判定；WS 流式契约在册但本期不接。
 *  · 本地模型未落盘不冒充可用（local_asr_unavailable，链继续回退云）。
 */
const ASR_ENDPOINT = 'https://api.deepseek.com/v1/tools/asr';
const ASR_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const PROVIDERS = ['local', 'deepseek'];

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

function resolveProviderChain(config) {
  const provider = String((config && config.provider) || 'none');
  if (provider === 'chain') {
    const supplied = Array.isArray(config.provider_chain) ? config.provider_chain : [];
    return [...new Set(supplied.map((p) => String(p).trim()).filter((p) => PROVIDERS.includes(p)))].slice(0, 4);
  }
  return PROVIDERS.includes(provider) ? [provider] : [];
}

async function invokeLocal(input) {
  if (typeof input.localFn === 'function') {
    return input.localFn({ buffer: input.buffer, filename: input.filename, config: input.config });
  }
  try {
    const { resolveLocalAsrModel, DEFAULT_LOCAL_MODEL_ID } = require('./local-asr-model');
    const configuredId = input.config && input.config.local_model && input.config.local_model.modelId;
    let model = resolveLocalAsrModel(configuredId || DEFAULT_LOCAL_MODEL_ID);
    // BLOCK-519 阶段二 — whisper 选项：engine=whisper 时从独立 catalog 解析（单 .bin），
    // 不改变 PROVIDERS 链与默认 SenseVoice 解析（回退链零变化）。
    const localModelCfg = input.config && input.config.local_model;
    // modelId 前缀 `whisper-` 即表达引擎选择（设置面只存 modelId/language，零 schema 改动）
    const whisperSelected = (localModelCfg && localModelCfg.engine === 'whisper')
      || String(configuredId || '').startsWith('whisper-');
    if (whisperSelected) {
      const whisperModel = require('./whisper-model');
      const resolved = whisperModel.resolveWhisperModel(configuredId || 'whisper-small');
      if (resolved) model = { ...resolved, id: resolved.id, language: resolved.language, engine: 'whisper' };
      else model = null;
    }
    if (!model) {
      return {
        ok: false,
        provider: 'local',
        code: 'local_asr_unavailable',
        message: '本地 ASR 模型未落盘：请先在 设置 → 能力渠道 → 语音 下载 SenseVoice-small。',
      };
    }
    const { transcribeWithLocalAsr } = require('./local-asr');
    return transcribeWithLocalAsr({
      buffer: input.buffer,
      filename: input.filename,
      model,
      language: (input.config.local_model && input.config.local_model.language) || 'auto',
    });
  } catch (error) {
    return { ok: false, provider: 'local', code: 'local_asr_unavailable', message: `本地 ASR 不可用：${error && error.message ? error.message : 'unknown'}` };
  }
}

async function transcribeWithDeepseek(input) {
  const buffer = input.buffer;
  const filename = String(input.filename || 'audio');
  const config = input.config || {};
  const provider = 'deepseek';
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

/**
 * 语音转写（ASR）。
 * @param {{buffer:Buffer, filename:string, config:{enabled:boolean, provider:string, provider_chain?:string[], local_model?:object, timeoutMs?:number}, fetchImpl?:Function, getApiKeyFn?:Function, localFn?:Function, maxUploadBytes?:number}} input
 * @returns {Promise<{ok:true, provider, text, durationMs, cost, fallbacks?}|{ok:false, code, message, attempts?}>}
 */
async function transcribeAudio(input = {}) {
  const buffer = input.buffer;
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
  const chain = resolveProviderChain(config);
  if (chain.length === 0) {
    return {
      ok: false,
      code: 'asr_not_configured',
      message: '未选择语音转写渠道（provider=none）。可选：local（本地 SenseVoice，需先下载模型）/ deepseek（云渠道，key 与对话共用）/ chain（本地优先，失败回退云）。',
    };
  }

  const fallbacks = [];
  const attempts = [];
  for (const provider of chain) {
    const result = provider === 'local' ? await invokeLocal(input) : await transcribeWithDeepseek(input);
    if (result && result.ok) {
      return chain.length > 1 ? { ...result, provider, fallbacks } : { ...result, provider };
    }
    // 单 provider（legacy 口径）原样透出 provider 自己的错误信封（status/retryable 等不丢）。
    if (chain.length === 1) return result && result.provider ? result : { ...result, provider };
    attempts.push({ provider, code: result && result.code ? result.code : 'asr_failed', message: result && result.message ? result.message : '转写失败' });
    fallbacks.push(provider);
  }
  const last = attempts[attempts.length - 1];
  return {
    ok: false,
    code: last ? last.code : 'asr_all_providers_failed',
    message: `转写失败（已尝试 ${attempts.map((a) => a.provider).join(' → ')}）：${last ? last.message : '无可用 provider'}`,
    attempts,
    fallbacks,
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
  PROVIDERS,
  resolveProviderChain,
  transcribeAudio,
  detectAudioFormat,
};
