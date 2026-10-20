'use strict';

/**
 * BLOCK-216 Q5 — pack 资产路径安全判定（shared 层单源）。
 *
 * 后端贡献投影与 Electron `petri-pack://` 协议 handler 共用这一份判定：
 * 只允许包内真实存在的相对文件；绝对路径/盘符/协议/`..`/符号链接逃逸一律拒绝。
 * 任何一端另写一份 = 第二套安全判定，禁止。
 */

const fs = require('node:fs');
const path = require('node:path');

const MIME_BY_EXT = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
});

/**
 * 归一化 pack 相对 entry；不安全返回 null。
 * 这里只做词法判定；真实文件/符号链接逃逸由 resolvePackAssetPath 处理。
 */
function normalizePackEntry(entry) {
  if (typeof entry !== 'string' || !entry) return null;
  if (entry.includes('\0')) return null;
  const normalized = entry.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(normalized)) return null;
  if (normalized.startsWith('/') || normalized.startsWith('//')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return null;
  const segments = normalized.split('/');
  if (segments.length === 0 || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return null;
  }
  return segments.join('/');
}

/**
 * 解析 packRoot 内相对 entry 为真实文件路径；越界/不存在/非文件均返回 null。
 * @returns {{ filePath: string, size: number } | null}
 */
function resolvePackAssetPath(packRoot, entry) {
  if (typeof packRoot !== 'string' || !packRoot) return null;
  const normalized = normalizePackEntry(entry);
  if (!normalized) return null;

  let realRoot;
  try {
    realRoot = fs.realpathSync(packRoot);
  } catch {
    return null;
  }
  const candidate = path.resolve(realRoot, ...normalized.split('/'));
  if (candidate !== realRoot && !candidate.startsWith(realRoot + path.sep)) return null;

  let realCandidate;
  try {
    realCandidate = fs.realpathSync(candidate);
  } catch {
    return null;
  }
  if (realCandidate !== realRoot && !realCandidate.startsWith(realRoot + path.sep)) return null;

  try {
    const stat = fs.statSync(realCandidate);
    if (!stat.isFile()) return null;
    return { filePath: realCandidate, size: stat.size };
  } catch {
    return null;
  }
}

function mimeForPackAsset(filePath) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

module.exports = {
  MIME_BY_EXT,
  normalizePackEntry,
  resolvePackAssetPath,
  mimeForPackAsset,
};
