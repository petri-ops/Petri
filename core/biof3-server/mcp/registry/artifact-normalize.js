'use strict';

// BLOCK-92 Wave C-6 — 工件类型推断/归一化与暂存输入路径解析外迁
// （原 mcp/registry.js 596-651 行，纯搬运零行为变化）。

const path = require('path');
const { isSafeFlatFilename, isInternalArtifactName } = require('../../helpers/artifact-truth');

function _inferArtifactType(item, filename) {
  const explicit = item && (item.type || item.kind);
  if (explicit === 'plot' || explicit === 'image') return 'plot';
  if (explicit === 'table' || explicit === 'dataframe') return 'table';
  if (explicit === 'text' || explicit === 'log') return 'text';
  if (explicit === 'json') return 'json';
  const lower = String(filename || '').toLowerCase();
  if (/\.(png|jpg|jpeg|svg|webp|pdf)$/.test(lower)) return 'plot';
  if (/\.(csv|tsv|xlsx?)$/.test(lower)) return 'table';
  if (/\.json$/.test(lower)) return 'json';
  if (/\.(txt|log|md)$/.test(lower)) return 'text';
  return 'file';
}

function _normalizeArtifact(item, resultDir, index, canonicalizePath = null) {
  const filename = item && (item.filename || item.name || item.path);
  if (!filename) return null;
  const name = path.basename(String(filename));
  const type = _inferArtifactType(item, name);
  const label =
    (item && (item.label || item.title || item.description)) ||
    name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  const artifact = {
    id: item && item.id ? String(item.id) : `artifact_${index + 1}`,
    name,
    filename: name,
    type,
    title: String(label),
    label: String(label),
    path: path.join(resultDir, name),
    preview: ['plot', 'table', 'text', 'json'].includes(type),
    download: true,
  };
  if (typeof canonicalizePath === 'function')
    artifact.canonicalPath = canonicalizePath(artifact.path);
  if (item && item.role) artifact.role = String(item.role);
  if (item && item.mime) artifact.mime = String(item.mime);
  return artifact;
}

function _normalizeArtifacts({ manifestItems, outFiles, resultDir, canonicalizePath = null }) {
  const sourceItems = [];
  for (const item of manifestItems || []) sourceItems.push(item);
  const knownNames = new Set(
    sourceItems
      .map((item) => path.basename(String(item && (item.filename || item.name || item.path || ''))))
      .filter(Boolean)
  );
  for (const file of outFiles || []) {
    if (!knownNames.has(file)) sourceItems.push({ name: file });
  }
  return sourceItems
    .map((item, index) => _normalizeArtifact(item, resultDir, index, canonicalizePath))
    .filter(Boolean);
}


function _resolveStagedInputPath(jobDir, inputId, sourcePath) {
  const id = typeof inputId === 'string' ? inputId.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || !isSafeFlatFilename(id)) {
    return { ok: false, error: 'plugin_input_id_unsafe' };
  }
  const extension = typeof sourcePath === 'string' ? path.extname(sourcePath) : '';
  const name = `${id}${extension}`;
  if (!isSafeFlatFilename(name) || isInternalArtifactName(name)) {
    return { ok: false, error: 'plugin_input_name_reserved' };
  }
  const root = path.resolve(jobDir);
  const stagedPath = path.resolve(root, name);
  if (path.dirname(stagedPath) !== root) {
    return { ok: false, error: 'plugin_input_path_escaped' };
  }
  return { ok: true, name, stagedPath };
}

/**
 * 执行插件 R 脚本（local 模式）。
 * 复刻 biof3-server/helpers/tools-executor.js:384-407 的执行约定：
 *   - R 工具脚本约定 commandArgs(trailingOnly=TRUE)[1] = job_dir
 *   - 不用 buildSpawnCommand（那是 figcode 的 --args params.json 约定）
 *   - 调用方写 jobDir/params.json，脚本 setwd(jobDir) 后 fromJSON 读
 *   - 插件包注入 R_LIBS_USER（pluginDir/packages/r 优先）
 *   - 结果读 jobDir/manifest.json（脚本写）+ 列 jobDir 下输出文件
 */

module.exports = {
  _inferArtifactType,
  _normalizeArtifact,
  _normalizeArtifacts,
  _resolveStagedInputPath,
};
