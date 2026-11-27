'use strict';

/**
 * 生成产物路径单一真值（item 83）：kind 白名单 + 扁平文件名 + 根内校验 + 真实文件。
 * 同时供 core/petri-server 的 HTTP 读面与 Electron 主进程 IPC（src/ipc）使用，
 * 避免两端各写一份校验造成漂移。放在 shared-backend 是 quality:arch 允许的 src→core 边。
 */
const fs = require('node:fs');
const path = require('node:path');
const { resolveDataDir } = require('./data-paths');

const GENERATED_KINDS = new Set(['image', 'video', 'model3d', 'html']);
const FLAT_NAME_RE = /^[^/\\:]+$/;

function buildGeneratedArtifactUrl(kind, filename) {
  if (!GENERATED_KINDS.has(kind) || typeof filename !== 'string' || !filename) return null;
  return `/api/generated/file/${kind}/${encodeURIComponent(filename)}`;
}

function resolveGeneratedArtifactPath(kind, filename, options = {}) {
  if (!GENERATED_KINDS.has(kind)) return null;
  if (typeof filename !== 'string' || !FLAT_NAME_RE.test(filename) || filename.includes('..')) return null;
  const dataDir = options.dataDir || resolveDataDir();
  const root = path.resolve(dataDir, 'generated', `generate-${kind}`);
  const resolved = path.resolve(root, filename);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  try {
    if (!fs.statSync(resolved).isFile()) return null;
  } catch {
    return null;
  }
  return resolved;
}

module.exports = { buildGeneratedArtifactUrl, resolveGeneratedArtifactPath, GENERATED_KINDS };
