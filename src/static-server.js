/**
 * static-server.js — 桌面版本地静态文件服务器
 *
 * 用原生 Node.js http 模块（不依赖 express）托管前端 build 产物。
 *
 * 阶段 3（desktop-spa）起支持双服务器：
 *   - Vite SPA build → :3002（主窗口，base '/'，无 baseUrl 前缀）
 *   - Docusaurus build → :3003（docs/blog iframe 过渡，baseUrl=/Gewu/）
 *
 * loadFile（file://）无法正确解析绝对路径资源，故仍需 HTTP 协议。
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

// 活跃服务器实例（按端口索引）
const servers = {};

// MIME 类型映射
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.txt': 'text/plain',
  '.rds': 'application/octet-stream',
  '.map': 'application/json',
};

function getMime(ext) {
  return MIME[ext.toLowerCase()] || 'application/octet-stream';
}

/**
 * 启动静态文件服务器
 * @param {string} buildDir - 要托管的目录
 * @param {object} opts
 * @param {number} opts.port - 端口（默认 3002）
 * @param {string} opts.baseUrl - 路径前缀，如 '/Gewu/'（Docusaurus）；Vite SPA 用 '/'
 * @param {string} opts.label - 日志标签
 * @param {boolean} opts.spaFallback - 未命中的路径是否回退 index.html（SPA 路由）
 * @param {boolean} opts.fallbackToRandomPort - 端口占用时是否回退到系统分配端口
 * @returns {Promise<object|null>} server 实例
 */
async function startStaticServer(buildDir, opts = {}) {
  const port = opts.port || 3002;
  const baseUrl = opts.baseUrl || '/';
  const label = opts.label || 'static-server';
  const spaFallback = opts.spaFallback !== false;
  const fallbackToRandomPort = opts.fallbackToRandomPort === true;

  if (servers[port]) return servers[port];
  if (!fs.existsSync(buildDir)) {
    console.warn(`[${label}] build dir not found:`, buildDir);
    return null;
  }

  // 归一化 baseUrl：确保以 / 开头、以 / 结尾
  const prefix = baseUrl.startsWith('/') ? baseUrl : '/' + baseUrl;
  const stripPrefix = prefix === '/' ? null : prefix.replace(/\/$/, ''); // 去尾斜杠，如 '/Gewu'

  const server = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 解析 URL，去掉 query string
    const urlPath = req.url.split('?')[0];

    // 桌面版禁用 PWA：拦截 sw.js / manifest.json / workbox 相关请求
    if (
      urlPath.endsWith('/sw.js') ||
      urlPath === '/sw.js' ||
      urlPath.endsWith('/manifest.json') ||
      urlPath.startsWith('/workbox-')
    ) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found (PWA disabled in desktop)');
      return;
    }

    // 去掉 baseUrl 前缀（如有）
    let filePath = urlPath;
    if (stripPrefix && filePath.startsWith(stripPrefix)) {
      filePath = filePath.slice(stripPrefix.length);
    }
    if (!filePath || filePath === '/') {
      filePath = '/index.html';
    }

    const fullPath = path.join(buildDir, filePath);

    // 安全检查：不能访问 buildDir 之外的文件
    if (!fullPath.startsWith(buildDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    // 检查文件是否存在
    if (!fs.existsSync(fullPath)) {
      if (spaFallback) {
        const indexPath = path.join(buildDir, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(fs.readFileSync(indexPath));
          return;
        }
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const indexPath = path.join(fullPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(indexPath));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    // 读取并返回文件
    const ext = path.extname(fullPath);
    const mime = getMime(ext);
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    fs.createReadStream(fullPath).pipe(res);
  });

  const listen = (listenPort) =>
    new Promise((resolve, reject) => {
      const onError = (err) => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(listenPort, '127.0.0.1');
    });

  try {
    await listen(port);
  } catch (err) {
    if (!fallbackToRandomPort || err?.code !== 'EADDRINUSE') {
      console.error(`[${label}] server failed:`, err);
      return null;
    }
    console.warn(`[${label}] port ${port} is occupied; selecting an available port`);
    try {
      await listen(0);
    } catch (fallbackError) {
      console.error(`[${label}] fallback server failed:`, fallbackError);
      return null;
    }
  }

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  servers[actualPort] = server;
  server.on('error', (err) => {
    console.error(`[${label}] server error:`, err);
  });
  console.log(`[${label}] serving ${buildDir} on http://127.0.0.1:${actualPort}`);
  return server;
}


module.exports = { startStaticServer };
