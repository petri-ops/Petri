'use strict';

/**
 * BLOCK-511 S3.2 — 工作区审阅文件读取的 realpath 包含校验（单源）。
 * 绝对路径 / .. 逃逸 / 指向工作区外的符号链接一律拒绝；
 * 已删除/消失文件（realpath 失败）返回解析后的工作区内绝对路径，由调用方走 deleted/missing 兜底。
 */
const fs = require('fs');
const path = require('path');
const { resolveCore } = require('../../main/core-utils');
const { GitAdapterError } = require(resolveCore('shared-backend/git-adapter'));

function resolveReviewFilePath(workTree, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath ||
      path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
    throw new GitAdapterError('path_outside_workspace', 'File path must be relative to the workspace.');
  }
  const realRoot = fs.realpathSync(workTree);
  const abs = path.resolve(realRoot, relativePath);
  let realTarget = abs;
  try { realTarget = fs.realpathSync(abs); } catch { /* 已删除/消失文件走调用方兜底 */ }
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
    throw new GitAdapterError('path_outside_workspace', 'Resolved file is outside the project workspace.');
  }
  return abs;
}

module.exports = { resolveReviewFilePath };
