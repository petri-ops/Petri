'use strict';

/**
 * 生成产物受控读面（item 83）。
 *
 * generate.* 产物落在 <dataDir>/generated/generate-<kind>，既不在 workspace 也不在
 * tool job dir，既有两条读面取不到。这里给出单一 URL 真值与 fail-closed 文件读面：
 * kind 白名单 + 扁平文件名 + 根内校验 + 真实文件，越界一律 400/404。
 */
const fs = require('node:fs');
const path = require('node:path');
const { resolveDataDir } = require('../../shared-backend/data-paths');
const { contentTypeFor } = require('../helpers/content-type');

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

function registerGeneratedFileRoutes(app) {
  app.get('/api/generated/file/:kind/:filename', (req, res) => {
    const filePath = resolveGeneratedArtifactPath(req.params.kind, req.params.filename);
    if (!filePath) return res.status(404).json({ error: 'generated_file_not_found' });
    res.setHeader('Content-Type', contentTypeFor(filePath));
    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(filePath);
  });
}

module.exports = {
  buildGeneratedArtifactUrl,
  resolveGeneratedArtifactPath,
  registerGeneratedFileRoutes,
};
