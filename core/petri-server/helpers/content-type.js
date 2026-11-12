'use strict';

/**
 * helpers/content-type.js — BLOCK-437 从 routes/files.js 抽出（行为零变化）。
 * 抽因：routes/files.js 触发 code-size 只减不增棘轮，抽出纯映射函数净减行数。
 */
const path = require('path');

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.csv': 'text/csv',
    '.tsv': 'text/tab-separated-values',
    '.json': 'application/json',
    '.log': 'text/plain',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
    '.r': 'text/plain',
    '.py': 'text/plain',
    '.sh': 'text/plain',
    '.bash': 'text/plain',
    '.zsh': 'text/plain',
    '.js': 'text/javascript',
    '.jsx': 'text/javascript',
    '.mjs': 'text/javascript',
    '.cjs': 'text/javascript',
    '.ts': 'text/plain',
    '.tsx': 'text/plain',
    '.css': 'text/css',
    '.scss': 'text/plain',
    '.html': 'text/html',
    '.xml': 'application/xml',
    '.toml': 'text/plain',
    '.txt': 'text/plain',
    '.yaml': 'text/plain',
    '.yml': 'text/plain',
    '.rds': 'application/octet-stream',
    '.rda': 'application/octet-stream',
    '.h5': 'application/octet-stream',
    '.hdf5': 'application/octet-stream',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    // BLOCK-322 P1b：外部 mesh 资产从工作区文件路由直供 3D 预览。
    // 格式集合以 helpers/mesh-assets 为唯一来源（逐值对账见 block322-mesh-format-single-source）。
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.stl': 'model/stl',
    '.obj': 'model/obj',
    // BLOCK-322 P2-05：转盘视频要在结果面 <video> 里播。Content-Type 属媒体契约的一部分——
    // 缺这两行时文件字节完好、路径也对，Chromium 仍会拒绝解码（表现为「播放器黑屏」的静默失真）。
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
  }[ext] || 'application/octet-stream';
}

module.exports = { contentTypeFor };
