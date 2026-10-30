'use strict';

/**
 * helpers/mesh-assets.js — 外部资产入链的契约单源（BLOCK-322 P1 / P2-03）。
 *
 * 输入侧「哪些格式可以进 SceneSpec」与「字节上限」只在本文件声明；SceneSpec 校验与
 * 资产预检端点共用这组值。Blender 构建脚本（resources/model3d/blender_scene.py）在
 * 运行时独立执法，两侧逐值由 test/block322-mesh-format-single-source.test.mjs 对账，
 * 前端镜像 frontend/src/lib/meshAssets.ts 同门对账。
 * 输出侧导出格式（glb/stl/obj）是另一个概念，不并入本文件。
 * P2-03 起同文件承载**贴图**资产（png/jpg/jpeg + 独立上限）：两类资产走同一个预检内核，
 * 避免第二份「路径解析 + 大小 + sha256」实现彼此漂移。
 */

const fs = require('node:fs');
const path = require('node:path');
const { sha256File } = require('./artifact-truth');

const MESH_INPUT_FORMATS = Object.freeze(['glb', 'gltf', 'stl', 'obj']);
const MESH_INPUT_EXTENSIONS = Object.freeze(MESH_INPUT_FORMATS.map((format) => `.${format}`));
const MAX_MESH_BYTES = 64 * 1024 * 1024;

// BLOCK-322 P2-03 — 基础色贴图：只收工作区内的位图，svg/tiff 等不进（Blender 与 Three 两侧
// 都要能直接消费，且 SVG 需要光栅化器=新依赖）。
const TEXTURE_INPUT_FORMATS = Object.freeze(['png', 'jpg', 'jpeg']);
const TEXTURE_INPUT_EXTENSIONS = Object.freeze(TEXTURE_INPUT_FORMATS.map((format) => `.${format}`));
const MAX_TEXTURE_BYTES = 16 * 1024 * 1024;

function formatForPath(value, formats) {
  const extension = path.extname(String(value || '').replace(/\\/g, '/')).toLowerCase();
  if (!extension) return null;
  const format = extension.slice(1);
  return formats.includes(format) ? format : null;
}

/** 工作区相对路径 → 受支持格式；不支持则 null（不抛错，由调用侧决定拒绝语义）。 */
function meshFormatForPath(value) {
  return formatForPath(value, MESH_INPUT_FORMATS);
}

/** 工作区相对路径 → 受支持的贴图格式；不支持则 null。 */
function textureFormatForPath(value) {
  return formatForPath(value, TEXTURE_INPUT_FORMATS);
}

/**
 * 只读预检内核：从工作区磁盘真实计算 sha256 与字节，并按白名单拒绝越界资产。
 * 不写文件、不建第二份真相——返回的 sourceSha256 供 add_node/material 进 SceneSpec，
 * 之后仍由 Blender 在构建时逐字节复验。
 * `maxBytes` 为测试缝（缺省取本文件上限，与 helpers/artifact-truth 的 io 注入同思路）。
 * 错误码按资产种类给（codes.*），消费侧因此能区分「mesh 不存在」与「贴图不存在」。
 */
async function inspectAssetFile({ workspaceRoot, relativePath, formats, extensions, maxBytes, codes }) {
  if (!workspaceRoot) return { ok: false, error: 'project_required' };
  const text = String(relativePath || '').trim();
  if (!text) return { ok: false, error: codes.pathRequired };
  const format = formatForPath(text, formats);
  if (!format) return { ok: false, error: codes.formatUnsupported, extensions };
  // 懒 require：本文件被纯函数层 scene3d.js 依赖，路径解析器仅在预检时载入。
  const { resolveWorkspaceTarget } = require('../agent-tools/workspace-tools/internals');
  let target;
  try {
    target = await resolveWorkspaceTarget(workspaceRoot, text, { createRoot: false });
  } catch (error) {
    return { ok: false, error: error.code || 'path_rejected', message: error.message };
  }
  let stat;
  try {
    stat = fs.statSync(target.target);
  } catch {
    return { ok: false, error: codes.notFound, path: target.relativePath };
  }
  if (!stat.isFile()) return { ok: false, error: codes.notFound, path: target.relativePath };
  if (stat.size > maxBytes) {
    return { ok: false, error: codes.tooLarge, path: target.relativePath, bytes: stat.size, maxBytes };
  }
  return {
    ok: true,
    path: target.relativePath,
    format,
    bytes: stat.size,
    sourceSha256: sha256File(target.target),
    maxBytes,
  };
}

async function inspectMeshAsset({ workspaceRoot, relativePath, maxBytes = MAX_MESH_BYTES } = {}) {
  return inspectAssetFile({
    workspaceRoot,
    relativePath,
    formats: MESH_INPUT_FORMATS,
    extensions: MESH_INPUT_EXTENSIONS,
    maxBytes,
    codes: {
      pathRequired: 'mesh_path_required',
      formatUnsupported: 'mesh_format_unsupported',
      notFound: 'mesh_not_found',
      tooLarge: 'mesh_too_large',
    },
  });
}

/** BLOCK-322 P2-03 — 贴图预检：同一内核，不同的格式白名单、上限与错误码前缀。 */
async function inspectTextureAsset({ workspaceRoot, relativePath, maxBytes = MAX_TEXTURE_BYTES } = {}) {
  return inspectAssetFile({
    workspaceRoot,
    relativePath,
    formats: TEXTURE_INPUT_FORMATS,
    extensions: TEXTURE_INPUT_EXTENSIONS,
    maxBytes,
    codes: {
      pathRequired: 'texture_path_required',
      formatUnsupported: 'texture_format_unsupported',
      notFound: 'texture_not_found',
      tooLarge: 'texture_too_large',
    },
  });
}

module.exports = {
  MESH_INPUT_FORMATS,
  MESH_INPUT_EXTENSIONS,
  MAX_MESH_BYTES,
  TEXTURE_INPUT_FORMATS,
  TEXTURE_INPUT_EXTENSIONS,
  MAX_TEXTURE_BYTES,
  meshFormatForPath,
  textureFormatForPath,
  inspectMeshAsset,
  inspectTextureAsset,
};
