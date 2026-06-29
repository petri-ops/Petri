/**
 * static-server.js — 桌面版本地静态文件服务器
 *
 * 用原生 Node.js http 模块（不依赖 express）托管 Docusaurus build 产物。
 * Docusaurus 的 baseUrl=/BioF3/ 和客户端路由需要 HTTP 协议，
 * loadFile（file://）无法正确解析绝对路径资源。
 *
 * 端口：3002（不与 r-server:3001 / py-server:3004 冲突）
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

let serverInstance = null;

// MIME 类型映射
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
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
};

function getMime(ext) {
  return MIME[ext.toLowerCase()] || 'application/octet-stream';
}

function startStaticServer(buildDir) {
  if (serverInstance) return serverInstance;
  if (!fs.existsSync(buildDir)) {
    console.warn('[static-server] build dir not found:', buildDir);
    return null;
  }

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

    // 桌面版禁用 PWA：拦截 sw.js / manifest.json / workbox 相关请求，
    // 返回 404 让 Service Worker 注册失败，避免 SW 缓存导致的弹窗风暴。
    // （正常 desktop build 不含这些文件，但防止误打包带 PWA 的 build）
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

    // Docusaurus baseUrl=/BioF3/，去掉前缀
    let filePath = urlPath;
    if (filePath.startsWith('/BioF3/')) {
      filePath = filePath.slice('/BioF3'.length);
    }
    if (filePath.startsWith('/BioF3')) {
      filePath = filePath.slice('/BioF3'.length);
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
      // SPA fallback：返回 index.html（Docusaurus 客户端路由）
      const indexPath = path.join(buildDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(indexPath));
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
      return;
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const indexPath = path.join(fullPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(indexPath));
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
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

  const PORT = 3002;
  serverInstance = server.listen(PORT, '127.0.0.1', () => {
    console.log(`[static-server] serving ${buildDir} on http://127.0.0.1:${PORT}`);
  });

  return serverInstance;
}

function stopStaticServer() {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
}

module.exports = { startStaticServer, stopStaticServer };
