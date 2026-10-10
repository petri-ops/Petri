'use strict';

const path = require('path');

// BLOCK-92 Wave C-6 — R server / shared-backend 路径解析外迁（原 294-318，
// 纯搬运零行为变化）。

function resolveRSserver() {
  // dev 模式：petri-server/mcp/registry/ → petri-server 根（目录加深一层，路径同步上调）
  const devPath = path.resolve(__dirname, '..', '..');
  try {
    require('fs').accessSync(path.join(devPath, 'plugin-loader.js'));
    return devPath;
  } catch {
    // 打包模式：petri-server 在 resources/petri-server 下
    return path.join(process.resourcesPath || '', 'petri-server');
  }
}

function resolveSharedBackend() {
  // dev 模式：petri-server/mcp/registry/ → 仓库根/shared-backend（同步上调）
  const devPath = path.resolve(__dirname, '..', '..', '..', 'shared-backend');
  try {
    require('fs').accessSync(devPath);
    return devPath;
  } catch {
    return path.join(process.resourcesPath || '', 'shared-backend');
  }
}

const R_SERVER = resolveRSserver();
const SHARED_BACKEND = resolveSharedBackend();

module.exports = { R_SERVER, SHARED_BACKEND };
