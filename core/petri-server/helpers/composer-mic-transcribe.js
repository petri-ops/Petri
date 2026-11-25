/**
 * composer-mic-transcribe.js — BLOCK-519 阶段二：麦克风音频 → 文本（输入通道）。
 *
 * 薄封装：复用 asr-provider 的既有 provider 链（local → deepseek，或单 provider），
 * 零新识别逻辑、零新依赖。本模块只做「音频 buffer → asr-provider → 文本」的窄口，
 * 让 composer 麦克风入口不必直接碰 provider 细节。
 *
 * 诚实边界：默认关闭不发请求（付费知情）；未落盘本地模型不冒充可用（由
 * asr-provider 的 local 分支诚实回退/报错）；失败返回结构化原因，不伪造文本。
 */
const { transcribeAudio } = require('./asr-provider');

async function transcribeMicAudio(input = {}) {
  const config = input.config && typeof input.config === 'object' ? input.config : { enabled: false, provider: 'none' };
  const result = await transcribeAudio({
    buffer: input.buffer,
    filename: String(input.filename || 'mic.wav'),
    config,
    ...(input.localFn ? { localFn: input.localFn } : {}),
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.getApiKeyFn ? { getApiKeyFn: input.getApiKeyFn } : {}),
  });
  if (!result || !result.ok) {
    return {
      ok: false,
      code: result && result.code ? result.code : 'mic_transcribe_failed',
      message: result && result.message ? result.message : '麦克风转写失败',
      ...(result && result.attempts ? { attempts: result.attempts } : {}),
    };
  }
  return {
    ok: true,
    text: String(result.text || ''),
    provider: result.provider,
    durationMs: result.durationMs,
    ...(result.cost ? { cost: result.cost } : {}),
    ...(result.fallbacks ? { fallbacks: result.fallbacks } : {}),
  };
}

module.exports = { transcribeMicAudio };
