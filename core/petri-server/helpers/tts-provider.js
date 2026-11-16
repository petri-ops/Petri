'use strict';

/**
 * tts-provider.js — 语音合成窄口（BLOCK-454 P6）。
 *
 * 契约（findings §2，VERIFIED）：POST https://api.deepseek.com/v1/tools/tts（整段），
 * Bearer；JSON {text ≤10000 计费字符, voice_id: stella 女|tide 男, format: wav|pcm,
 * filter_markdown}；10 种语言自动识别；响应=音频二进制。
 * wss://api.deepseek.com/v1/tools/tts 流式 WS 契约在 findings 在册但本期不接（留接口，
 * 不实现不冒充）。
 *
 * 诚实边界（与 asr-provider 同款）：默认关（P5-a）· key 走凭据族 · voice/format
 * 白名单外诚实拒 · 成本计量 cost.requests/chars/bytes。
 */

const TTS_ENDPOINT = 'https://api.deepseek.com/v1/tools/tts';
const TTS_VOICES = Object.freeze(['stella', 'tide']);
const TTS_FORMATS = Object.freeze(['wav', 'pcm']);
const TTS_MAX_TEXT_CHARS = 10000;

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
 * 语音合成（TTS，整段非流式）。
 * @param {{text:string, voiceId?:string, format?:string, config:{enabled:boolean, provider:string, filterMarkdown?:boolean, timeoutMs?:number}, fetchImpl?:Function, getApiKeyFn?:Function}} input
 * @returns {Promise<{ok:true, provider, audio:Buffer, format, voiceId, cost}|{ok:false, code, message, retryable?, status?}>}
 */
async function synthesizeSpeech(input = {}) {
  const text = String(input.text == null ? '' : input.text).trim();
  const config = input.config || {};
  if (config.enabled !== true) {
    return {
      ok: false,
      code: 'speech_access_disabled',
      message: '语音合成未开启（默认关，云调用=付费副作用）。请在 speech-config（speech-config.json）置 enabled=true 并选择 provider 后再试。',
    };
  }
  const provider = String(config.provider || 'none');
  if (provider !== 'deepseek') {
    return {
      ok: false,
      code: 'tts_not_configured',
      message: '未选择语音合成渠道（provider=none）。可选：deepseek（云渠道，key 与对话共用）。',
    };
  }
  const getApiKeyFn = typeof input.getApiKeyFn === 'function' ? input.getApiKeyFn : defaultDeepseekKeyLookup;
  const apiKey = String(getApiKeyFn('deepseek') || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      code: 'tts_not_configured',
      message: '已选 DeepSeek 语音合成但未配置 DeepSeek API key。请在 设置 → AI 设置 填入 DeepSeek API Key（与对话共用同一凭据）。',
    };
  }
  if (!text) {
    return { ok: false, code: 'tts_text_missing', message: '缺少待合成文本（text 为空）。' };
  }
  if (text.length > TTS_MAX_TEXT_CHARS) {
    return {
      ok: false,
      code: 'tts_text_too_long',
      message: `文本过长（${text.length} 计费字符，上限 ${TTS_MAX_TEXT_CHARS}）：请分段合成。`,
    };
  }
  const voiceId = String(input.voiceId || config.ttsVoice || 'stella');
  if (!TTS_VOICES.includes(voiceId)) {
    return {
      ok: false,
      code: 'tts_voice_invalid',
      message: `voice_id 必须是 ${TTS_VOICES.join(' | ')}（官方白名单），收到：${voiceId}。`,
    };
  }
  const format = String(input.format || config.ttsFormat || 'wav');
  if (!TTS_FORMATS.includes(format)) {
    return {
      ok: false,
      code: 'tts_format_invalid',
      message: `format 必须是 ${TTS_FORMATS.join(' | ')}（官方白名单；opus 仅流式 WS 支持，本期未接），收到：${format}。`,
    };
  }
  const filterMarkdown = config.filterMarkdown !== false;
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, code: 'tts_unavailable', message: '当前运行时没有 fetch，无法调用 TTS。' };
  }
  const timeoutMs = Math.max(1000, Number(config.timeoutMs) || 120000);

  let response;
  try {
    response = await fetchImpl(TTS_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'content-type': 'application/json',
        accept: 'audio/wav, application/octet-stream',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ text, voice_id: voiceId, format, filter_markdown: filterMarkdown }),
    });
  } catch (error) {
    const name = error && error.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, code: 'tts_timeout', message: `合成超时（>${timeoutMs}ms）。`, retryable: true, provider };
    }
    return { ok: false, code: 'tts_failed', message: `合成请求失败：${error && error.message ? error.message : 'unknown'}`, retryable: true, provider };
  }

  if (!response.ok) {
    return {
      ok: false,
      code: 'tts_http_error',
      message: `DeepSeek TTS 返回 HTTP ${response.status}${response.status === 401 || response.status === 403 ? '（API key 无效或无权限，请检查 设置 → AI 设置）' : ''}。`,
      retryable: response.status >= 500 && response.status !== 401 && response.status !== 403,
      provider,
      status: response.status,
    };
  }

  let audio;
  try {
    const arrayBuffer = await response.arrayBuffer();
    audio = Buffer.from(arrayBuffer);
  } catch (error) {
    return { ok: false, code: 'tts_body_failed', message: `读取合成音频失败：${error && error.message ? error.message : 'unknown'}`, retryable: true, provider };
  }
  if (!audio || audio.length === 0) {
    return { ok: false, code: 'tts_bad_response', message: 'TTS 返回空音频（0 字节）。', provider };
  }
  return {
    ok: true,
    provider,
    audio,
    format,
    voiceId,
    cost: { requests: 1, chars: text.length, bytes: audio.length },
  };
}

module.exports = {
  TTS_ENDPOINT,
  TTS_VOICES,
  TTS_FORMATS,
  TTS_MAX_TEXT_CHARS,
  synthesizeSpeech,
};
