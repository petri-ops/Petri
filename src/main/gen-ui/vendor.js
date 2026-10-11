/**
 * src/main/gen-ui/vendor.js
 *
 * BLOCK-166 [C 层] vendor 离线映射（规格 §6.4）：
 * resources/gen-ui/vendor/manifest.json（url → file → sha256）加载后，
 * shell 拼装时把三个固定 CDN URL 重写为本实例沙箱路径 petri-genui://gen-<id>/vendor/<file>。
 * P0：存在性校验 + 服务；P1 起 sha256 逐文件强校验（plan §5）。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let _manifestCache = null;

function vendorDir() {
  return path.join(__dirname, '..', '..', '..', 'resources', 'gen-ui', 'vendor');
}

function loadVendorManifest() {
  if (_manifestCache) return _manifestCache;
  const file = path.join(vendorDir(), 'manifest.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byUrl = new Map();
  const byFile = new Map();
  for (const resource of raw.resources || []) {
    if (!resource.url || !resource.file) continue;
    byUrl.set(resource.url, resource);
    byFile.set(resource.file, resource);
  }
  _manifestCache = { raw, byUrl, byFile };
  return _manifestCache;
}

/**
 * P1 强校验（plan §5-P1/坑 1）：bytes 的 sha256 必须与清单一致，
 * 不符即明确失败不回退网络（ZCode 实锤案例：缓存与 manifest 不同步 → 白屏）。
 */
function verifyVendorHash(resource, bytes) {
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual !== resource.sha256) {
    throw Object.assign(
      new Error(`bundled resource hash mismatch: ${resource.file} (manifest ${resource.sha256}, actual ${actual})`),
      { code: 'vendor-hash-mismatch' },
    );
  }
  return true;
}

/** shell 重写：把 fragment 中的白名单 CDN URL 换成沙箱 vendor 路径；未知 URL 原样保留（CSP 决定命运）。 */
function rewriteVendorUrls(html, sandboxOrigin) {
  const manifest = loadVendorManifest();
  let result = html;
  for (const [url, resource] of manifest.byUrl) {
    // 仅替换作为属性值出现的完整 URL（引号/括号边界内），不做子串模糊替换。
    result = result.split(url).join(`${sandboxOrigin}/vendor/${resource.file}`);
  }
  return result;
}

/** 协议侧取 vendor 文件：文件名必须在清单内，读取失败/缺失明确失败（不回退网络）。 */
function readVendorFile(fileName) {
  const manifest = loadVendorManifest();
  const resource = manifest.byFile.get(fileName);
  if (!resource) {
    throw Object.assign(new Error(`vendor file not in manifest: ${fileName}`), { code: 'vendor-not-in-manifest' });
  }
  const target = path.join(vendorDir(), fileName);
  const real = fs.realpathSync(target);
  if (!real.startsWith(path.resolve(vendorDir()) + path.sep)) {
    throw Object.assign(new Error('vendor path escape'), { code: 'vendor-escape' });
  }
  const bytes = fs.readFileSync(real);
  verifyVendorHash(resource, bytes);
  return { resource, bytes };
}

function vendorMimeFor(fileName) {
  if (fileName.endsWith('.css')) return 'text/css; charset=utf-8';
  if (fileName.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (fileName.endsWith('.woff2')) return 'font/woff2';
  return 'application/octet-stream';
}

module.exports = { loadVendorManifest, rewriteVendorUrls, readVendorFile, verifyVendorHash, vendorMimeFor };
