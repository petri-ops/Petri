// ============================================================
// src/plugin/io.js — file I/O helpers (download / checksum / dir / copy)
//
// Extracted from src/plugin-manager.js by BLOCK-9.2 PHASE 3.
// Original location: lines 322-362 (downloadFile), 363-382 (verifyChecksum),
// 383-400 (streamingSha256), 401-413 (assertArtifactChecksumDeclared),
// 414-433 (dirSize), 1403-1416 (copyDirSync).
//
// All functions here are pure I/O utilities. No module-level state.
// ============================================================

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        try {
          fs.unlinkSync(destPath);
        } catch {}
        return reject(new Error(`下载失败: HTTP ${res.statusCode}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress && total > 0) {
          onProgress(received / total, received, total);
        }
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(destPath));
      });
    });
    req.on('error', (e) => {
      file.close();
      try {
        fs.unlinkSync(destPath);
      } catch {}
      reject(e);
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('下载超时'));
    });
  });
}

// 旧接口（保留）：返回 boolean
function verifyChecksum(filePath, expectedSha256) {
  // 兼容 "sha256:<hex>" 和纯 "<hex>" 两种格式
  const expected = String(expectedSha256)
    .replace(/^sha256:/i, '')
    .trim()
    .toLowerCase();
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => {
      const actual = hash.digest('hex').toLowerCase();
      resolve(actual === expected);
    });
    stream.on('error', () => resolve(false));
  });
}

// Week 2 流式 SHA-256：500MB Runtime 不进内存，按 1MB chunk 增量哈希。
// 返回 lowercase hex 字符串。
function streamingSha256(filePath, onProgress) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    let totalBytes = 0;
    stream.on('data', (chunk) => {
      hash.update(chunk);
      totalBytes += chunk.length;
      if (onProgress) onProgress(totalBytes);
    });
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
    stream.on('error', reject);
  });
}

// 供应链防线（2026-08-06 收口 "Week 4 placeholder"）：
// 远程 artifact 必须声明 sha256，缺声明即拒绝安装（fail-closed），且在下载前 fail-fast，
// 避免先下载几百 MB 再拒绝。内置插件（built-in:// 本地复制）不经过此检查。
function assertArtifactChecksumDeclared(kind, pluginId, platform, artifact) {
  if (artifact && artifact.sha256) return;
  const e = new Error(
    `${kind} ${pluginId}.artifacts.${platform}.sha256 缺失 — ` +
      '拒绝安装未声明校验和的远程 artifact（fail-closed，请先在 manifest 中补齐 sha256）'
  );
  e.code = 'CHECKSUM_MISSING';
  e.pluginId = pluginId;
  e.platform = platform;
  throw e;
}

// Week 2：递归计算目录总大小（best-effort unpacked size 校验用）
function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      try {
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) total += fs.statSync(p).size;
      } catch {}
    }
  };
  walk(dir);
  return total;
}

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

module.exports = {
  downloadFile,
  verifyChecksum,
  streamingSha256,
  assertArtifactChecksumDeclared,
  dirSize,
  copyDirSync,
};
