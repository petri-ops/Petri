'use strict';

/**
 * local-asr-model.js — BLOCK-519：本地 ASR 模型管理（SenseVoice-small / sherpa-onnx）。
 *
 * 不挂 capability-provisioning ledger：只借用其已导出的下载与流式 SHA-256 原语
 *（defaultDownload / streamingSha256），原子移动在本模块实现。所有「已下载/使用中」
 * 状态一律以真实落盘文件为准（manifest 只是审计副产物，缺模型文件即未安装）。
 * 官方 SenseVoice 模型发布页未公布 SHA256 → 下载后记录实测值供审计，不伪造校验基线。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');
const {
  defaultDownload,
  streamingSha256,
} = require('../../shared-backend/capability-provisioning.js');

const DEFAULT_LOCAL_MODEL_ID = 'sensevoice-small-int8-2024-07-17';

const LOCAL_ASR_MODELS = Object.freeze([
  Object.freeze({
    id: DEFAULT_LOCAL_MODEL_ID,
    label: 'SenseVoice-small（中/英/日/韩/粤 · int8）',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2',
    dirName: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17',
    modelFile: 'model.int8.onnx',
    tokensFile: 'tokens.txt',
    language: 'auto',
    sha256: null,
  }),
]);

function descriptorFor(id) {
  return LOCAL_ASR_MODELS.find((item) => item.id === String(id || '').trim());
}

function resolveModelsDir(options = {}) {
  if (options.modelsDir) return String(options.modelsDir);
  const root = process.env.PETRI_LOCAL_DATA_DIR || path.join(os.homedir(), 'Documents', 'Petri-Local');
  return path.join(root, 'local-asr-models');
}

function modelInstallDir(descriptor, options = {}) {
  return path.join(resolveModelsDir(options), descriptor.dirName);
}

function readManifest(installDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(installDir, 'manifest.json'), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function modelPaths(descriptor, options = {}) {
  const modelDir = modelInstallDir(descriptor, options);
  return {
    modelDir,
    modelPath: path.join(modelDir, descriptor.modelFile),
    tokensPath: path.join(modelDir, descriptor.tokensFile),
  };
}

function isReady(descriptor, options = {}) {
  const paths = modelPaths(descriptor, options);
  return fs.existsSync(paths.modelPath) && fs.existsSync(paths.tokensPath) && !!readManifest(paths.modelDir);
}

function listLocalAsrModels(options = {}) {
  return LOCAL_ASR_MODELS.map((descriptor) => {
    const paths = modelPaths(descriptor, options);
    const manifest = readManifest(paths.modelDir);
    return {
      id: descriptor.id,
      label: descriptor.label,
      language: descriptor.language,
      installed: isReady(descriptor, options),
      path: paths.modelDir,
      sha256: manifest && typeof manifest.sha256 === 'string' ? manifest.sha256 : null,
      downloadedAt: manifest && typeof manifest.downloadedAt === 'string' ? manifest.downloadedAt : null,
    };
  });
}

function resolveLocalAsrModel(id, options = {}) {
  const descriptor = descriptorFor(id);
  if (!descriptor || !isReady(descriptor, options)) return null;
  const paths = modelPaths(descriptor, options);
  return { ...paths, id: descriptor.id, language: descriptor.language };
}

/**
 * GitHub release 资源会 302 到带签名的对象存储 URL；capability-provisioning 的
 * defaultDownload 只接受 200（不跟随跳转）→ 这里先解析最终 URL，再复用下载原语。
 */
function resolveFinalUrl(url, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('too many redirects'));
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'HEAD', timeout: 30000 }, (res) => {
      const status = Number(res.statusCode || 0);
      const location = res.headers && res.headers.location;
      res.resume();
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        resolve(resolveFinalUrl(new URL(location, url).href, redirects + 1));
        return;
      }
      resolve(url);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('redirect resolve timeout')); });
    req.end();
  });
}

function defaultExtract(tmpFile, stageDir) {
  const result = spawnSync('tar', ['-xjf', tmpFile, '-C', stageDir], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    const error = new Error(result.error ? result.error.message : (result.stderr || 'tar extract failed'));
    error.code = 'extract_failed';
    throw error;
  }
}

async function downloadLocalAsrModel(id, options = {}) {
  const descriptor = descriptorFor(id);
  if (!descriptor) return { ok: false, code: 'model_not_found', message: `未知本地模型：${id}` };
  const modelsDir = resolveModelsDir(options);
  const installDir = modelInstallDir(descriptor, options);
  if (isReady(descriptor, options)) {
    const manifest = readManifest(installDir);
    return { ok: true, downloaded: false, installed: true, model: descriptor.id, path: installDir, sha256: manifest.sha256 };
  }

  fs.mkdirSync(path.join(modelsDir, '.tmp'), { recursive: true });
  const tmpFile = path.join(modelsDir, '.tmp', `${descriptor.id}-${process.pid}.tar.bz2`);
  const stageDir = path.join(modelsDir, '.tmp', `${descriptor.id}-${process.pid}-stage`);
  const usingDefaultDownload = typeof options.download !== 'function';
  const download = usingDefaultDownload ? defaultDownload : options.download;
  const hash = typeof options.hash === 'function' ? options.hash : streamingSha256;
  const extract = typeof options.extract === 'function' ? options.extract : defaultExtract;
  try {
    const sourceUrl = usingDefaultDownload ? await resolveFinalUrl(descriptor.url) : descriptor.url;
    await download(sourceUrl, tmpFile, options.onProgress);
    const sha256 = await hash(tmpFile);
    if (descriptor.sha256 && String(descriptor.sha256).replace(/^sha256:/i, '').toLowerCase() !== String(sha256).toLowerCase()) {
      const error = new Error('sha256_mismatch');
      error.code = 'sha256_mismatch';
      throw error;
    }
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.mkdirSync(stageDir, { recursive: true });
    await extract(tmpFile, stageDir);
    const staged = path.join(stageDir, descriptor.dirName);
    const source = fs.existsSync(staged) ? staged : stageDir;
    const required = [descriptor.modelFile, descriptor.tokensFile].map((file) => path.join(source, file));
    if (required.some((file) => !fs.existsSync(file))) {
      const error = new Error('model_files_missing');
      error.code = 'model_files_missing';
      throw error;
    }
    // 原子移动：同一文件系统 rename；落 manifest 在 rename 之后，缺 manifest 即不冒充可用。
    fs.rmSync(installDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(installDir), { recursive: true });
    fs.renameSync(source, installDir);
    fs.writeFileSync(path.join(installDir, 'manifest.json'), JSON.stringify({
      id: descriptor.id, sha256, downloadedAt: new Date().toISOString(), url: descriptor.url,
    }, null, 2) + '\n', 'utf8');
    return { ok: true, downloaded: true, installed: true, model: descriptor.id, path: installDir, sha256 };
  } catch (error) {
    return {
      ok: false,
      code: (error && error.code) || 'download_failed',
      message: `本地模型下载失败：${error && error.message ? error.message : 'unknown'}`,
    };
  } finally {
    try { fs.rmSync(tmpFile, { force: true }); } catch { /* 临时文件清理失败不影响下载结果回报（落盘真值另行判定） */ }
    try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* 暂存目录清理失败不影响已原子移动的模型目录 */ }
  }
}

function deleteLocalAsrModel(id, options = {}) {
  const descriptor = descriptorFor(id);
  if (!descriptor) return { ok: false, code: 'model_not_found' };
  const installDir = modelInstallDir(descriptor, options);
  if (!fs.existsSync(installDir)) return { ok: false, code: 'not_installed' };
  fs.rmSync(installDir, { recursive: true, force: true });
  return { ok: true, removed: true };
}

module.exports = {
  DEFAULT_LOCAL_MODEL_ID,
  LOCAL_ASR_MODELS,
  descriptorFor,
  resolveModelsDir,
  listLocalAsrModels,
  resolveLocalAsrModel,
  downloadLocalAsrModel,
  deleteLocalAsrModel,
};
