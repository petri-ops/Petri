/**
 * agent-tools/speech-tools.js — BLOCK-454 P6：agent 语音工具（消费 helpers/asr|tts-provider）。
 *
 * 两个消费面（plan P6 需求场景，用户裁决 2026-11-17 启动）：
 *  · tool_transcribe_audio：工作区音频（wav/ogg）→ ASR → 文本（语音输入场景：
 *    用户把录音放进工作区，agent 调本工具转写后据此作答）。
 *  · tool_speak_text：文本 → TTS → 音频落 `<workspace>/.petri/audio/<sha256>.<format>`
 *    （朗读场景：同文本同声音幂等同一路径，X3）。产物只写 .petri/ 影子目录，
 *    不改工作区源文件（对齐 video-frames 惯例）。
 *
 * 诚实边界：窄口自带的默认关/白名单/成本计量全部透传；deps 注入 {asrFn, ttsFn} 供测试。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dbMod = require('../db');
require('../config');

function resolveWorkspaceAudioPath(ctx, filePath) {
  const projectId = ctx && ctx.projectId;
  if (!projectId) return { error: { ok: false, code: 'project_required', message: '语音工具需要有效项目工作区' } };
  const project = dbMod.getProject(String(projectId));
  if (!project || !project.workspace_path) {
    return { error: { ok: false, code: 'workspace_required', message: '语音工具需要本地工作区项目' } };
  }
  const workspaceRoot = path.resolve(project.workspace_path);
  const target = path.resolve(workspaceRoot, String(filePath).trim().replace(/^\.\//, ''));
  if (target !== workspaceRoot && !target.startsWith(workspaceRoot + path.sep)) {
    return { error: { ok: false, code: 'workspace_path_invalid', message: '音频路径越出工作区（拒绝路径穿越）' } };
  }
  return { workspaceRoot, target };
}

/**
 * tool_transcribe_audio — 工作区音频 → ASR 转写文本。
 * @param {{filePath:string}} args
 * @param {object} ctx - { projectId, ... }
 * @param {{asrFn?:Function, speechConfig?:object}} deps - 测试注入
 */
async function tool_transcribe_audio(args, ctx, deps = {}) {
  const filePath = args && args.filePath;
  if (!filePath) return { ok: false, code: 'missing_filePath', message: '需要 filePath（工作区相对路径，wav/ogg）' };
  const resolved = resolveWorkspaceAudioPath(ctx, filePath);
  if (resolved.error) return resolved.error;
  const target = resolved.target;
  if (!fs.existsSync(target)) {
    return { ok: false, code: 'file_not_found', message: `工作区里没有这个音频文件：${filePath}` };
  }
  const buffer = fs.readFileSync(target);
  const speechConfig = deps.speechConfig
    || (() => {
      try {
        const { getEffectiveConfig } = require('../helpers/speech-config');
        return getEffectiveConfig();
      } catch {
        return { enabled: false, provider: 'none', timeoutMs: 60000 };
      }
    })();
  const invoke = deps.asrFn || require('../helpers/asr-provider').transcribeAudio;
  const result = await invoke({ buffer, filename: path.basename(target), config: speechConfig });
  if (!result || !result.ok) {
    return {
      ok: false,
      error: result && result.code ? result.code : 'asr_failed',
      message: result && result.message ? result.message : '语音转写失败',
      fileName: path.basename(target),
    };
  }
  return {
    ok: true,
    fileName: path.basename(target),
    text: result.text,
    durationMs: result.durationMs,
    usage: result.cost,
    _note: '音频已用当前语音渠道转写，上方 text 是转写文本，可直接据此回答用户。',
  };
}

/**
 * tool_speak_text — 文本 → TTS 音频产物（落 .petri/audio/，幂等）。
 * @param {{text:string, voiceId?:string, format?:string}} args
 * @param {object} ctx - { projectId, ... }
 * @param {{ttsFn?:Function, speechConfig?:object}} deps - 测试注入
 */
async function tool_speak_text(args, ctx, deps = {}) {
  const text = String((args && args.text) == null ? '' : args.text);
  if (!text.trim()) return { ok: false, code: 'missing_text', message: '需要 text（要朗读的文本）' };
  const resolved = resolveWorkspaceAudioPath(ctx, '.');
  if (resolved.error) return resolved.error;
  const workspaceRoot = resolved.workspaceRoot;
  const speechConfig = deps.speechConfig
    || (() => {
      try {
        const { getEffectiveConfig } = require('../helpers/speech-config');
        return getEffectiveConfig();
      } catch {
        return { enabled: false, provider: 'none', ttsVoice: 'stella', ttsFormat: 'wav', filterMarkdown: true, timeoutMs: 60000 };
      }
    })();
  const invoke = deps.ttsFn || require('../helpers/tts-provider').synthesizeSpeech;
  const result = await invoke({
    text,
    voiceId: args && args.voiceId,
    format: args && args.format,
    config: speechConfig,
  });
  if (!result || !result.ok) {
    return {
      ok: false,
      error: result && result.code ? result.code : 'tts_failed',
      message: result && result.message ? result.message : '语音合成失败',
    };
  }
  // 幂等产物路径：同文本同声音同格式 → 同 sha256（X3），重复朗读不重复调云。
  const sha = crypto.createHash('sha256')
    .update(text)
    .update(String(result.voiceId))
    .update(String(result.format))
    .digest('hex');
  const audioDir = path.join(workspaceRoot, '.petri', 'audio');
  fs.mkdirSync(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, `${sha}.${result.format}`);
  if (!fs.existsSync(audioPath)) {
    fs.writeFileSync(audioPath, result.audio);
  }
  return {
    ok: true,
    filePath: path.relative(workspaceRoot, audioPath),
    bytes: result.audio.length,
    voiceId: result.voiceId,
    format: result.format,
    usage: result.cost,
    _note: '音频已落工作区 .petri/audio/（同文本同声音幂等复用同一文件），可经工作区文件面播放或下载。',
  };
}

module.exports = {
  tool_transcribe_audio,
  tool_speak_text,
};
