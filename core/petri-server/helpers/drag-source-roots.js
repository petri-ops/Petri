'use strict';

/**
 * helpers/drag-source-roots.js — BLOCK-437 拖入/导入源允许根与组合判据。
 *
 * 为什么单独成模块：routes/files.js 受 code-size 只减不增棘轮约束（净减才合规），
 * 且该策略需要单测与文档化，放在路由里既超体积又难测。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { adjudicateDragSource } = require('../agent-tools/security-boundaries');

/**
 * 默认允许根 = 家目录 + os.tmpdir() + /tmp + /Volumes（+ 项目工作区）。
 *
 * 为什么 /tmp 要单列：macOS 上 `/tmp → /private/tmp`，而 `os.tmpdir()` 是
 * `/var/folders/…/T`，是**两棵树**；只放 os.tmpdir() 会把从 /tmp 拖入当越界（实测踩到）。
 * `PETRI_DRAG_SOURCE_ROOTS` 可覆盖（逗号分隔，`*` 表示不限制）。
 */
function dragSourceAllowedRoots(projectWorkspacePath, env = process.env) {
  const configured = String(env.PETRI_DRAG_SOURCE_ROOTS || '')
    .split(',').map((v) => v.trim()).filter(Boolean);
  const roots = configured.length > 0
    ? configured
    : [os.homedir(), os.tmpdir(), '/tmp', '/Volumes'].concat(
      projectWorkspacePath && path.isAbsolute(String(projectWorkspacePath))
        ? [String(projectWorkspacePath)]
        : [],
    );
  // 判定用 realpath，根也必须 realpath 归一（否则 /tmp 类符号链接会误拒合法源）。
  return roots.map((root) => {
    if (root === '*') return root;
    try {
      return fs.realpathSync(root);
    } catch {
      return root;
    }
  });
}

/** 组合判据：路由只需一次调用（源范围 + realpath 归一 + 允许根）。 */
function adjudicateImportSource({ sourceAbsolutePath = '', realpath = '', workspacePath = '', env = process.env } = {}) {
  return adjudicateDragSource({
    localPath: sourceAbsolutePath,
    realpath,
    allowedRoots: dragSourceAllowedRoots(workspacePath, env),
    exists: true,
  });
}

module.exports = { dragSourceAllowedRoots, adjudicateImportSource };
