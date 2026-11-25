'use strict';

/**
 * local-asr.js — BLOCK-519：SenseVoice 本地转写 wrapper（native 依赖唯一边界）。
 *
 * `sherpa-onnx-node` 是 native addon：macOS 需要 DYLD_LIBRARY_PATH 指向包内 lib，
 * 运行中的后端进程已启动，改 env 不会影响 dlopen 搜索路径。故每次转写 spawn 一个
 * 短生命周期 worker 子进程，在 spawn 时注入 env——不污染 owner dev 进程，也不要求
 * 主进程重启。worker 的输出是 JSON 信封，失败诚实返回，不冒充可用。
 *
 * SenseVoice 原生多语（中/英/日/韩/粤），language:auto 仅作配置/回执元数据透传，
 * 不写入 native recognizer 配置（该 API 无 language 字段）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const WORKER_PATH = path.join(__dirname, 'local-asr-worker.js');
const MODEL_FILE = 'model.int8.onnx';
const TOKENS_FILE = 'tokens.txt';

function buildLocalRecognizeConfig(input = {}) {
  const modelDir = String(input.modelDir || '');
  return {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      senseVoice: {
        model: path.join(modelDir, MODEL_FILE),
        useInverseTextNormalization: 1,
      },
      tokens: path.join(modelDir, TOKENS_FILE),
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    },
  };
}

const SHERPA_PLATFORM_PACKAGES = Object.freeze([
  'sherpa-onnx-darwin-arm64',
  'sherpa-onnx-darwin-x64',
  'sherpa-onnx-linux-arm64',
  'sherpa-onnx-linux-x64',
  'sherpa-onnx-win-x64',
  'sherpa-onnx-win-ia32',
  'sherpa-onnx-win-arm64',
]);

function sherpaLibDir() {
  // 逐一探测 optional dep（仅当前宿主平台的包能 resolve），不散落宿主分支。
  for (const pkg of SHERPA_PLATFORM_PACKAGES) {
    try {
      return path.dirname(require.resolve(pkg));
    } catch { /* 该平台包未安装：继续探测下一个候选，native 不可用时由 worker 诚实报错 */ }
  }
  try {
    return path.join(path.dirname(require.resolve('sherpa-onnx-node')), 'lib');
  } catch {
    return '';
  }
}

function defaultSpawn(command, args, options) {
  const result = spawnSync(command, args, { ...options, encoding: 'utf8', timeout: 120000 });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error };
}

/**
 * @param {{buffer:Buffer, filename?:string, model:{modelId:string, modelDir:string}, language?:string,
 *   spawnFn?:Function, env?:object, tmpDir?:string}} input
 */
async function transcribeWithLocalAsr(input = {}) {
  const buffer = input.buffer;
  const model = input.model || {};
  const language = String(input.language || 'auto');
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, code: 'asr_file_missing', message: '缺少待转写音频内容', provider: 'local' };
  }
  const modelDir = String(model.modelDir || '');
  if (!modelDir || !fs.existsSync(path.join(modelDir, MODEL_FILE)) || !fs.existsSync(path.join(modelDir, TOKENS_FILE))) {
    return {
      ok: false,
      code: 'local_asr_unavailable',
      message: '本地模型未落盘（请在 设置 → 能力渠道 → 语音 下载 SenseVoice-small 后再用本地转写）。',
      provider: 'local',
    };
  }

  const tmpDir = input.tmpDir || os.tmpdir();
  fs.mkdirSync(path.join(tmpDir, 'petri-local-asr'), { recursive: true });
  const wavPath = path.join(tmpDir, 'petri-local-asr', `asr-${process.pid}-${Date.now()}.wav`);
  fs.writeFileSync(wavPath, buffer);
  try {
    const libDir = sherpaLibDir();
    const baseEnv = { ...process.env, ...(input.env || {}) };
    if (libDir) {
      baseEnv.DYLD_LIBRARY_PATH = `${libDir}${baseEnv.DYLD_LIBRARY_PATH ? `:${baseEnv.DYLD_LIBRARY_PATH}` : ''}`;
    }
    const spawn = typeof input.spawnFn === 'function' ? input.spawnFn : defaultSpawn;
    const result = spawn(process.execPath, [WORKER_PATH, '--model', modelDir, '--wav', wavPath, '--language', language], { env: baseEnv });
    if (result.error || result.status !== 0) {
      return {
        ok: false,
        code: 'local_asr_failed',
        message: `本地转写失败：${result.error ? result.error.message : (result.stderr || `worker exit ${result.status}`)}`,
        provider: 'local',
        modelId: model.modelId,
      };
    }
    let payload;
    try {
      payload = JSON.parse(String(result.stdout || '').trim());
    } catch {
      return { ok: false, code: 'local_asr_bad_response', message: '本地转写 worker 输出不是 JSON', provider: 'local' };
    }
    if (!payload || !payload.ok || typeof payload.text !== 'string') {
      return { ok: false, code: (payload && payload.code) || 'local_asr_failed', message: (payload && payload.message) || '本地转写无结果', provider: 'local' };
    }
    return {
      ok: true,
      provider: 'local',
      text: payload.text,
      durationMs: Number.isFinite(Number(payload.durationMs)) ? Number(payload.durationMs) : null,
      modelId: model.modelId,
      language,
      cost: { requests: 0, bytes: buffer.length },
    };
  } finally {
    try { fs.rmSync(wavPath, { force: true }); } catch { /* 临时 wav 清理失败不影响转写结果回报 */ }
  }
}

module.exports = {
  WORKER_PATH,
  buildLocalRecognizeConfig,
  transcribeWithLocalAsr,
};
