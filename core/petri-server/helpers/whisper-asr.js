/**
 * whisper-asr.js — BLOCK-519 阶段二：whisper.cpp 本地转写 wrapper（native addon 唯一边界）。
 *
 * @fugood/whisper.node 是 native addon（darwin-arm64 Metal 预编译）：与阶段一 sherpa
 * 同构——每次转写 spawn 一个短生命周期 worker，native 加载只在 worker 内发生，
 * 不污染 owner dev 进程、不要求主进程重启。worker 输出 JSON 信封，失败诚实返回。
 *
 * 零新识别逻辑：只做「wav 路径 + 模型 → worker → 文本」薄封装。
 * @fugood/whisper.node 的 transcribeFile 接受 16kHz mono WAV（与 P6 录音链同形）。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const WORKER_PATH = path.join(__dirname, 'whisper-asr-worker.js');
const DEFAULT_MODEL_ID = 'whisper-small';

function resolveWhisperModelPath(model, options = {}) {
  if (model && model.modelPath && fs.existsSync(model.modelPath)) return String(model.modelPath);
  const whisperModel = options.whisperModel || require('./whisper-model');
  const id = (model && model.id) || DEFAULT_MODEL_ID;
  const resolved = whisperModel.resolveWhisperModel(id, options);
  return resolved ? resolved.modelPath : null;
}

function transcribeWithWhisper(input = {}) {
  const modelPath = input.modelPath || resolveWhisperModelPath(input.model, input);
  if (!modelPath || !fs.existsSync(modelPath)) {
    return Promise.resolve({ ok: false, provider: 'whisper', code: 'whisper_model_unavailable', message: 'whisper 模型未落盘：请先在设置页下载' });
  }
  const wavPath = String(input.wavPath || '');
  if (!wavPath || !fs.existsSync(wavPath)) {
    return Promise.resolve({ ok: false, provider: 'whisper', code: 'whisper_wav_missing', message: '待转写音频文件不存在' });
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WORKER_PATH, '--model', modelPath, '--wav', wavPath, '--language', String(input.language || 'auto')], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    const finish = (result) => { child.kill && child.killed === false && child.kill(); resolve(result); };
    child.on('error', (error) => finish({ ok: false, provider: 'whisper', code: 'whisper_worker_error', message: error.message }));
    child.on('close', () => {
      try {
        const parsed = JSON.parse(out.trim().split('\n').slice(-1)[0] || '{}');
        if (parsed.ok) {
          resolve({ ok: true, provider: 'whisper', text: String(parsed.text || ''), durationMs: parsed.durationMs, engine: 'whisper' });
        } else {
          resolve({ ok: false, provider: 'whisper', code: parsed.code || 'whisper_failed', message: parsed.message || err.slice(0, 300) || 'whisper 转写失败' });
        }
      } catch {
        resolve({ ok: false, provider: 'whisper', code: 'whisper_bad_response', message: err.slice(0, 300) || 'whisper worker 无有效输出' });
      }
    });
  });
}

module.exports = { WORKER_PATH, DEFAULT_MODEL_ID, resolveWhisperModelPath, transcribeWithWhisper };
