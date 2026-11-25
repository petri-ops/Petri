/**
 * whisper-model.js — BLOCK-519 阶段二：whisper.cpp 模型管理（与 SenseVoice 路径隔离）。
 *
 * whisper 模型是单 ggml .bin（非 tar.bz2 解包、无 tokens.txt），故独立管理，
 * 不动 local-asr-model.js 的 SenseVoice 假设（model.int8.onnx + tokens.txt）。
 * 官方 HF `ggerganov/whisper.cpp` 的 SHA 为公开值 → 下载时校验，不伪造。
 * 零新依赖（下载/哈希原语复用 capability-provisioning）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  defaultDownload,
  streamingSha256,
} = require('../../shared-backend/capability-provisioning.js');

const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

const WHISPER_MODELS = Object.freeze([
  Object.freeze({
    id: 'whisper-small',
    label: 'Whisper-small（多语 · 488MB）',
    file: 'ggml-small.bin',
    url: `${HF_BASE}/ggml-small.bin`,
    sha256: '55356645c2b361a969dfd0ef2c5a50d530afd8d5',
    language: 'auto',
  }),
  Object.freeze({
    id: 'whisper-large-v3-turbo-q5_0',
    label: 'Whisper-large-v3-turbo（多语 · q5_0 547MB）',
    file: 'ggml-large-v3-turbo-q5_0.bin',
    url: `${HF_BASE}/ggml-large-v3-turbo-q5_0.bin`,
    sha256: 'e050f7970618a659205450ad97eb95a18d69c9ee',
    language: 'auto',
  }),
]);

function descriptorFor(id) {
  return WHISPER_MODELS.find((item) => item.id === String(id || '').trim());
}

function resolveModelsDir(options = {}) {
  if (options.modelsDir) return String(options.modelsDir);
  const root = process.env.PETRI_LOCAL_DATA_DIR || path.join(os.homedir(), 'Documents', 'Petri-Local');
  return path.join(root, 'whisper-models');
}

function modelInstallDir(descriptor, options = {}) {
  return path.join(resolveModelsDir(options), descriptor.id);
}

function readManifest(installDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(installDir, 'manifest.json'), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isReady(descriptor, options = {}) {
  const dir = modelInstallDir(descriptor, options);
  return fs.existsSync(path.join(dir, descriptor.file)) && !!readManifest(dir);
}

function listWhisperModels(options = {}) {
  return WHISPER_MODELS.map((descriptor) => {
    const dir = modelInstallDir(descriptor, options);
    const manifest = readManifest(dir);
    return {
      id: descriptor.id,
      label: descriptor.label,
      language: descriptor.language,
      installed: isReady(descriptor, options),
      path: dir,
      bytes: descriptor.file.includes('q5_0') ? 574 * 1024 * 1024 : 488 * 1024 * 1024,
      sha256: manifest && typeof manifest.sha256 === 'string' ? manifest.sha256 : null,
      downloadedAt: manifest && typeof manifest.downloadedAt === 'string' ? manifest.downloadedAt : null,
    };
  });
}

function resolveWhisperModel(id, options = {}) {
  const descriptor = descriptorFor(id);
  if (!descriptor || !isReady(descriptor, options)) return null;
  const dir = modelInstallDir(descriptor, options);
  return { id: descriptor.id, modelPath: path.join(dir, descriptor.file), language: descriptor.language };
}

async function downloadWhisperModel(id, options = {}) {
  const descriptor = descriptorFor(id);
  if (!descriptor) return { ok: false, code: 'model_not_found', message: `未知 whisper 模型：${id}` };
  const installDir = modelInstallDir(descriptor, options);
  if (isReady(descriptor, options)) {
    const manifest = readManifest(installDir);
    return { ok: true, downloaded: false, installed: true, model: descriptor.id, path: installDir, sha256: manifest.sha256 };
  }
  const modelsDir = resolveModelsDir(options);
  const tmpDir = path.join(modelsDir, '.tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `${descriptor.id}-${process.pid}.bin`);
  const download = typeof options.download === 'function' ? options.download : defaultDownload;
  const hash = typeof options.hash === 'function' ? options.hash : streamingSha256;
  try {
    await download(descriptor.url, tmpFile, options.onProgress);
    const sha256 = await hash(tmpFile);
    if (String(descriptor.sha256).toLowerCase() !== String(sha256).toLowerCase()) {
      const error = new Error('sha256_mismatch');
      error.code = 'sha256_mismatch';
      throw error;
    }
    fs.rmSync(installDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(installDir), { recursive: true });
    fs.renameSync(tmpFile, path.join(installDir, descriptor.file));
    fs.writeFileSync(path.join(installDir, 'manifest.json'), JSON.stringify({
      id: descriptor.id, sha256, downloadedAt: new Date().toISOString(), url: descriptor.url,
    }, null, 2) + '\n', 'utf8');
    return { ok: true, downloaded: true, installed: true, model: descriptor.id, path: installDir, sha256 };
  } catch (error) {
    return { ok: false, code: (error && error.code) || 'download_failed', message: `whisper 模型下载失败：${error && error.message ? error.message : 'unknown'}` };
  } finally {
    try { fs.rmSync(tmpFile, { force: true }); } catch { /* 临时文件清理失败不影响落盘真值判定 */ }
  }
}

function deleteWhisperModel(id, options = {}) {
  const descriptor = descriptorFor(id);
  if (!descriptor) return { ok: false, code: 'model_not_found' };
  try {
    fs.rmSync(modelInstallDir(descriptor, options), { recursive: true, force: true });
    return { ok: true, deleted: true, model: descriptor.id };
  } catch (error) {
    return { ok: false, code: 'delete_failed', message: error.message };
  }
}

module.exports = {
  WHISPER_MODELS,
  descriptorFor,
  resolveModelsDir,
  listWhisperModels,
  resolveWhisperModel,
  downloadWhisperModel,
  deleteWhisperModel,
};
