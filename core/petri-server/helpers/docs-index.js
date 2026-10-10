/**
 * helpers/docs-index.js — DOCS_INDEX_v1
 *
 * 桌面版优先从本地文件读取 copilot-index.json
 *   （内容同步时下载到 site 目录），fallback 到网络。
 */

const fs = require('fs');
const path = require('path');

let _docsIndexCache = null;
let _docsIndexFetchedAt = 0;
const DOCS_INDEX_TTL = 10 * 60 * 1000;
const DOCS_INDEX_URL_CANDIDATES = [
  'https://petri.com/copilot-index.json',
  'http://172.17.0.1/copilot-index.json',
  'http://localhost/copilot-index.json',
];

// 桌面版本地索引文件候选路径
function _getLocalIndexPaths() {
  const paths = [];
  // 1. PETRI_SITE_DIR 环境变量指定的 site 目录
  if (process.env.PETRI_SITE_DIR) {
    paths.push(path.join(process.env.PETRI_SITE_DIR, 'copilot-index.json'));
  }
  // 2. petri-server 同级 site 目录（Electron 打包时静态站在这里）
  paths.push(path.join(__dirname, '..', '..', 'site', 'copilot-index.json'));
  // 3. Electron resources 目录
  if (process.resourcesPath) {
    paths.push(path.join(process.resourcesPath, 'site', 'copilot-index.json'));
  }
  return paths;
}

function _readLocalIndex() {
  for (const p of _getLocalIndexPaths()) {
    try {
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (data && (Array.isArray(data.docs) || Array.isArray(data.blog) || Array.isArray(data.figcode))) {
          console.log('[docs-index] loaded local from', p);
          return data;
        }
      }
    } catch {}
  }
  return null;
}

function fetchDocsIndex() {
  if (_docsIndexCache && Date.now() - _docsIndexFetchedAt < DOCS_INDEX_TTL) {
    return Promise.resolve(_docsIndexCache);
  }

  // 桌面版：先尝试本地文件，本地没有再 fallback 到网络。
  const localData = _readLocalIndex();
  if (localData) {
    _docsIndexCache = localData;
    _docsIndexFetchedAt = Date.now();
    return Promise.resolve(localData);
  }

  const urls = DOCS_INDEX_URL_CANDIDATES;
  return (async () => {
    for (const url of urls) {
      try {
        const isHttps = url.startsWith('https:');
        const lib = isHttps ? require('https') : require('http');
        const data = await new Promise((resolve) => {
          const req = lib.get(url, { timeout: 5000 }, (res) => {
            if (res.statusCode !== 200) {
              resolve(null);
              return;
            }
            let buf = '';
            res.setEncoding('utf8');
            res.on('data', (c) => (buf += c));
            res.on('end', () => {
              try {
                resolve(JSON.parse(buf));
              } catch {
                resolve(null);
              }
            });
          });
          req.on('error', () => resolve(null));
          req.on('timeout', () => {
            try {
              req.destroy();
            } catch {}
            resolve(null);
          });
        });
        if (
          data &&
          (Array.isArray(data.docs) || Array.isArray(data.blog) || Array.isArray(data.figcode))
        ) {
          _docsIndexCache = data;
          _docsIndexFetchedAt = Date.now();
          console.log('[docs-index] fetched from', url, 'docs=', data.counts && data.counts.docs);
          return data;
        }
      } catch {
        /* try next */
      }
    }
    return _docsIndexCache;
  })();
}

function getCachedDocsIndex() {
  return _docsIndexCache;
}

/** Render a compact docs/blog/figcode catalog for prompt injection. */
function renderDocsIndexForPrompt(idx, maxChars) {
  if (!idx) return '';
  maxChars = maxChars || 2200;
  let out = '\n\n=== Petri 站点内容索引（教程 / 博客 / FigCode 工具） ===\n';
  out +=
    '注：用户问"教程里讲过什么"或"FigCode 有没有 X"时，引用下面真实条目；要打开就 emit navigate action with target=external_link 或对应 url。\n';

  if (Array.isArray(idx.docs) && idx.docs.length > 0) {
    out += '\n[教程]';
    for (const d of idx.docs.slice(0, 80)) {
      let line = '\n- ' + d.title;
      if (d.url) line += ' (' + d.url + ')';
      if (d.summary) line += ' — ' + String(d.summary).slice(0, 80);
      if (out.length + line.length > maxChars - 200) {
        out += '\n... (more)';
        break;
      }
      out += line;
    }
  }

  if (Array.isArray(idx.blog) && idx.blog.length > 0) {
    out += '\n\n[博客]';
    for (const b of idx.blog.slice(0, 30)) {
      let line = '\n- ' + b.title;
      if (b.url) line += ' (' + b.url + ')';
      if (b.date) line += ' [' + b.date + ']';
      if (out.length + line.length > maxChars - 100) {
        out += '\n... (more)';
        break;
      }
      out += line;
    }
  }

  if (Array.isArray(idx.figcode) && idx.figcode.length > 0) {
    out += '\n\n[FigCode 工具]';
    for (const c of idx.figcode.slice(0, 60)) {
      let line = '\n- ' + c.title + (c.subtitle ? ' (' + c.subtitle + ')' : '');
      if (c.category) line += ' [' + c.category + ']';
      if (c.url) line += ' → ' + c.url;
      if (out.length + line.length > maxChars - 50) {
        out += '\n...';
        break;
      }
      out += line;
    }
  }
  return out;
}

module.exports = {
  fetchDocsIndex,
  renderDocsIndexForPrompt,
  getCachedDocsIndex,
};
