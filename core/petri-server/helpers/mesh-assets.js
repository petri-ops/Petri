'use strict';

/**
 * helpers/mesh-assets.js — 外部 mesh 资产入链的契约单源（BLOCK-322 P1）。
 *
 * 输入侧「哪些格式可以进 SceneSpec」与「字节上限」只在本文件声明；SceneSpec 校验与
 * 资产预检端点共用这组值。Blender 构建脚本（resources/model3d/blender_scene.py）在
 * 运行时独立执法，两侧逐值由 test/block322-mesh-format-single-source.test.mjs 对账，
 * 前端镜像 frontend/src/lib/meshAssets.ts 同门对账。
 * 输出侧导出格式（glb/stl/obj）是另一个概念，不并入本文件。
 */

const fs = require('node:fs');
const path = require('node:path');
const { sha256File } = require('./artifact-truth');

const MESH_INPUT_FORMATS = Object.freeze(['glb', 'gltf', 'stl', 'obj']);
const MESH_INPUT_EXTENSIONS = Object.freeze(MESH_INPUT_FORMATS.map((format) => `.${format}`));
const MAX_MESH_BYTES = 64 * 1024 * 1024;

/** 工作区相对路径 → 受支持格式；不支持则 null（不抛错，由调用侧决定拒绝语义）。 */
function meshFormatForPath(value) {
  const extension = path.extname(String(value || '').replace(/\\/g, '/')).toLowerCase();
  if (!extension) return null;
  const format = extension.slice(1);
  return MESH_INPUT_FORMATS.includes(format) ? format : null;
}

/**
 * 只读预检：从工作区磁盘真实计算 sha256 与字节，并按本文件白名单拒绝越界资产。
 * 不写文件、不建第二份真相——返回的 sourceSha256 供 add_node 进 SceneSpec，
 * 之后仍由 Blender 在构建时逐字节复验。
 * `maxBytes` 为测试缝（缺省取本文件上限，与 helpers/artifact-truth 的 io 注入同思路）。
 */
async function inspectMeshAsset({ workspaceRoot, relativePath, maxBytes = MAX_MESH_BYTES } = {}) {
  if (!workspaceRoot) return { ok: false, error: 'project_required' };
  const text = String(relativePath || '').trim();
  if (!text) return { ok: false, error: 'mesh_path_required' };
  const format = meshFormatForPath(text);
  if (!format) {
    return { ok: false, error: 'mesh_format_unsupported', extensions: MESH_INPUT_EXTENSIONS };
  }
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
    return { ok: false, error: 'mesh_not_found', path: target.relativePath };
  }
  if (!stat.isFile()) return { ok: false, error: 'mesh_not_found', path: target.relativePath };
  if (stat.size > maxBytes) {
    return { ok: false, error: 'mesh_too_large', path: target.relativePath, bytes: stat.size, maxBytes };
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

module.exports = {
  MESH_INPUT_FORMATS,
  MESH_INPUT_EXTENSIONS,
  MAX_MESH_BYTES,
  meshFormatForPath,
  inspectMeshAsset,
};
