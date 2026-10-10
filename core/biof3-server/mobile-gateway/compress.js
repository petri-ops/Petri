'use strict';

/**
 * BLOCK-159 P0-1 — mobile-gateway 生产路径 gzip 压缩（零新依赖，node:zlib）。
 *
 * 诊断（plan §1）：压缩此前只存在于 dev Vite 代理路径（index.js:444-449），
 * 生产 dist 静态资产与全部 API JSON 响应均裸传——首屏 ~1.5-2MB 过隧道是「慢」
 * 的最大单项。两个接线面（buildMobileGateway 内）：
 *  1. createGzipResponseMiddleware() — buffered 响应（res.send，Express 5 的
 *     res.json 亦委托到它）按 accept-encoding 压缩；SSE / 已编码 / 小于阈值 /
 *     HEAD 跳过。流式面（res.write 的三处 SSE）天然不经过本中间件。
 *  2. mountGzipStaticAssets(app, distDir, opts) — /assets/** 请求时 gzip +
 *     有界字节缓存（mtime 失效重建）；非 gzip 客户端 next() 落回 express.static，
 *     行为与压缩前完全一致。
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const DEFAULT_MIN_BYTES = 1024;
const DEFAULT_CACHE_MAX_BYTES = 32 * 1024 * 1024;
// 只压文本族资产；图片/字体本身已压缩，gzip 无益且白耗 CPU。
const COMPRESSIBLE_ASSET_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.svg', '.html', '.json', '.map', '.txt']);

const ASSET_CONTENT_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function acceptsGzip(req) {
  return String(req.headers['accept-encoding'] || '').toLowerCase().includes('gzip');
}

/** 纯函数（契约测试锚点）：buffered 响应是否应压缩。 */
function shouldCompressBuffer({ contentType, byteLength, accepts, contentEncoding, method, minBytes = DEFAULT_MIN_BYTES }) {
  if (method === 'HEAD') return false;
  if (!accepts) return false;
  if (contentEncoding) return false;
  const ct = String(contentType || '');
  // SSE 显式排除（text/ 前缀规则会误命中 text/event-stream）
  if (ct.includes('text/event-stream')) return false;
  if (!/text\/|application\/(javascript|json|xml|wasm)/.test(ct)) return false;
  return byteLength >= minBytes;
}

function createGzipResponseMiddleware({ minBytes = DEFAULT_MIN_BYTES } = {}) {
  return function gzipResponse(req, res, next) {
    if (!acceptsGzip(req)) return next();
    const originalSend = res.send.bind(res);
    res.send = function gzipPatchedSend(body) {
      try {
        if (res.headersSent) return originalSend(body);
        const contentType = String(res.getHeader('Content-Type') || '');
        if (!shouldCompressBuffer({
          contentType,
          byteLength: typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : Buffer.isBuffer(body) ? body.length : 0,
          accepts: true,
          contentEncoding: res.getHeader('Content-Encoding'),
          method: req.method,
          minBytes,
        })) return originalSend(body);
        const raw = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
        const gz = zlib.gzipSync(raw);
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        return originalSend(gz);
      } catch {
        // 压缩失败绝不吞响应：原样回退（fail-open 仅限压缩面）。
        return originalSend(body);
      }
    };
    next();
  };
}

/**
 * /assets/** 请求时 gzip（有界缓存，mtime 失效）：dist 哈希资产内容寻址，
 * 首访压一次后续走缓存；缓存超上限按插入序淘汰最旧（Map 迭代序）。
 */
function createGzipAssetHandler(distDir, { cacheMaxBytes = DEFAULT_CACHE_MAX_BYTES } = {}) {
  const assetsRoot = path.join(distDir, 'assets');
  const cache = new Map(); // rel -> { gz, size, mtimeMs }
  let cacheBytes = 0;
  return function gzipAsset(req, res, next) {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !acceptsGzip(req)) return next();
    const rel = String(req.path || '').replace(/^\/+/, '');
    if (!rel || rel.includes('..') || rel.includes('\\')) return next();
    const ext = path.extname(rel).toLowerCase();
    if (!COMPRESSIBLE_ASSET_EXTENSIONS.has(ext)) return next();
    const filePath = path.join(assetsRoot, rel);
    if (!filePath.startsWith(assetsRoot + path.sep)) return next();
    let st;
    try { st = fs.statSync(filePath); } catch { return next(); }
    if (!st.isFile()) return next();
    let entry = cache.get(rel);
    if (!entry || entry.mtimeMs !== st.mtimeMs) {
      if (entry) { cacheBytes -= entry.size; cache.delete(rel); }
      let gz;
      try { gz = zlib.gzipSync(fs.readFileSync(filePath)); } catch { return next(); }
      entry = { gz, size: gz.length, mtimeMs: st.mtimeMs };
      cache.set(rel, entry);
      cacheBytes += entry.size;
      while (cacheBytes > cacheMaxBytes && cache.size > 1) {
        const oldest = cache.keys().next().value;
        cacheBytes -= cache.get(oldest).size;
        cache.delete(oldest);
      }
    }
    res.setHeader('Content-Type', ASSET_CONTENT_TYPES[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    if (req.method === 'HEAD') {
      res.setHeader('Content-Length', String(entry.size));
      res.end();
      return;
    }
    res.end(entry.gz);
  };
}

/** buildMobileGateway 接线：/assets gzip 处理器须挂在 express.static(dist) 之前。 */
function mountGzipStaticAssets(app, distDir, opts = {}) {
  app.use('/assets', createGzipAssetHandler(distDir, opts));
}

module.exports = {
  DEFAULT_MIN_BYTES,
  DEFAULT_CACHE_MAX_BYTES,
  COMPRESSIBLE_ASSET_EXTENSIONS,
  acceptsGzip,
  shouldCompressBuffer,
  createGzipResponseMiddleware,
  createGzipAssetHandler,
  mountGzipStaticAssets,
};
