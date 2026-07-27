/**
 * routes/files.js — 桌面版本地文件上传/读取路由。
 *
 * 提供项目工作区文件树浏览、文件读取，以及通过本地存储适配器的上传。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const config = require('../config');
const { safeJoinUnder } = require('../../shared-backend/path-safe');
const { requireTrustedDesktopOrigin } = require('../helpers/local-request-boundary');
const TEMP_DIR = config.tempDir || '/tmp/biof3-tmp';

// 本地存储适配器
let _storage = null;
function getStorage() {
  if (!_storage) {
    const { getActiveStorage } = require('../../shared-backend/storage');
    _storage = getActiveStorage();
  }
  return _storage;
}

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
  }[ext] || 'application/octet-stream';
}

function getProjectWorkspace(projectId) {
  const db = require('../db');
  const project = db.getProject(projectId);
  if (!project || !project.workspace_path) return null;
  try {
    fs.mkdirSync(project.workspace_path, { recursive: true });
  } catch {}
  return project.workspace_path;
}

function resolveInside(root, relativePath) {
  const target = safeJoinUnder(root, String(relativePath || ''));
  if (!target) return null;
  try {
    const realRoot = fs.realpathSync(root);
    const realTarget = fs.realpathSync(target);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) return null;
  } catch (error) {
    if (error.code !== 'ENOENT') return null;
  }
  return target;
}

function isSafeStorageKey(key) {
  if (typeof key !== 'string' || !key || key.includes('\0') || key.includes('%') || path.isAbsolute(key) || /^[/\\]/.test(key)) return false;
  return !key.split(/[\\/]+/).some((segment) => segment === '..' || segment === '.');
}

const upload = multer({
  dest: path.join(TEMP_DIR, 'uploads'),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.csv', '.tsv', '.txt', '.rds', '.rda', '.xlsx', '.h5', '.hdf5', '.gz'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件格式: ${ext}，支持: ${allowed.join(', ')}`));
    }
  },
});

module.exports = function registerFileRoutes(app) {
  // ── 桌面版本地文件服务 ──────────────────────────────────────
  // /api/files/<key> → 从本地 results 目录读取文件并返回
  app.get('/api/workspaces/:projectId/tree', (req, res) => {
      try {
        const root = getProjectWorkspace(req.params.projectId);
        if (!root) return res.status(404).json({ ok: false, error: '项目工作目录不存在' });
        const dir = resolveInside(root, req.query.prefix || '');
        if (!dir) return res.status(400).json({ ok: false, error: '非法路径' });
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.statSync(dir).isDirectory()) {
          return res.status(400).json({ ok: false, error: '不是目录' });
        }
        const entries = fs
          .readdirSync(dir, { withFileTypes: true })
          .filter((entry) => !entry.name.startsWith('.'))
          .map((entry) => {
            const full = path.join(dir, entry.name);
            const stat = fs.statSync(full);
            return {
              name: entry.name,
              type: entry.isDirectory() ? 'dir' : 'file',
              size: entry.isFile() ? stat.size : undefined,
              modifiedAt: stat.mtimeMs,
            };
          })
          .sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        res.json({ ok: true, entries });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    app.get('/api/workspaces/:projectId/file', requireTrustedDesktopOrigin, (req, res) => {
      try {
        const root = getProjectWorkspace(req.params.projectId);
        if (!root) return res.status(404).json({ status: 'error', error: '项目工作目录不存在' });
        const target = resolveInside(root, req.query.path || '');
        if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
          return res.status(404).json({ status: 'error', error: '文件不存在' });
        }
        res.setHeader('Content-Type', contentTypeFor(target));
        res.send(fs.readFileSync(target));
      } catch (e) {
        res.status(500).json({ status: 'error', error: e.message });
      }
    });

    app.get(/^\/api\/files\/(.+)$/, requireTrustedDesktopOrigin, (req, res) => {
      const key = Array.isArray(req.params[0]) ? req.params[0].join('/') : req.params[0];
      try {
        if (!isSafeStorageKey(key)) {
          return res.status(400).json({ status: 'error', error: 'invalid_storage_key' });
        }
        const storage = getStorage();
        if (!storage || !storage.exists(key)) {
          return res.status(404).json({ status: 'error', error: '文件不存在' });
        }
        const buf = storage.read(key);
        // 根据扩展名设置 Content-Type
        res.setHeader('Content-Type', contentTypeFor(key));
        res.send(buf);
      } catch (e) {
        res.status(500).json({ status: 'error', error: e.message });
      }
    });

  app.post('/api/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ status: 'error', error: '未收到文件' });
    }
    const ext = path.extname(req.file.originalname).toLowerCase();
    const newPath = req.file.path + ext;
    fs.renameSync(req.file.path, newPath);

    const ts = Date.now();
    const rand = crypto.randomBytes(4).toString('hex');
    const safeFilename = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `uploads/${ts}-${rand}-${safeFilename}`;
    let fileUrl = null;

    try {
      const storage = getStorage();
      if (storage) fileUrl = await storage.upload(newPath, key);
    } catch {
      // 存储失败时回退到本地临时路径
    }

    res.json({
      status: 'ok',
      filePath: newPath.replace(/\\/g, '/'),
      ossUrl: fileUrl || newPath.replace(/\\/g, '/'),
      originalName: req.file.originalname,
      size: req.file.size,
    });
  });
};

module.exports.isSafeStorageKey = isSafeStorageKey;
