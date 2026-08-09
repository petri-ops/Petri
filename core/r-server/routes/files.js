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
const { profileData } = require('../../shared-backend/data-profiler');
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

const projectDataImport = multer({
  dest: path.join(TEMP_DIR, 'imports'),
  limits: { fileSize: 500 * 1024 * 1024, files: 12 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(['.csv', '.tsv', '.txt'].includes(ext)
      ? null
      : new Error(`不支持的文件格式: ${ext || '无扩展名'}，支持: .csv, .tsv, .txt`),
      ['.csv', '.tsv', '.txt'].includes(ext));
  },
}).array('files', 12);

function safeImportedFilename(originalName) {
  const basename = path.basename(String(originalName || '').normalize('NFKC'));
  const ext = path.extname(basename).toLowerCase();
  const stem = path.basename(basename, path.extname(basename))
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return `${stem || 'data'}${ext}`;
}

async function copyImportWithoutOverwrite(sourcePath, destinationDir, originalName) {
  const safeName = safeImportedFilename(originalName);
  const ext = path.extname(safeName);
  const stem = path.basename(safeName, ext);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
    const candidate = path.join(destinationDir, `${stem}${suffix}${ext}`);
    try {
      await fs.promises.copyFile(sourcePath, candidate, fs.constants.COPYFILE_EXCL);
      return candidate;
    } catch (error) {
      if (error && error.code === 'EEXIST') continue;
      throw error;
    }
  }
  throw new Error(`无法为导入文件分配唯一名称: ${safeName}`);
}

async function removeUploadedFiles(files) {
  await Promise.all((files || []).map(async (file) => {
    try {
      await fs.promises.rm(file.path, { force: true });
    } catch {}
  }));
}

module.exports = function registerFileRoutes(app) {
  // ── 桌面版本地文件服务 ──────────────────────────────────────
  // /api/files/<key> → 从本地 results 目录读取文件并返回
  app.get('/api/workspaces/:projectId/tree', requireTrustedDesktopOrigin, (req, res) => {
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

    app.post('/api/workspaces/:projectId/profile', requireTrustedDesktopOrigin, async (req, res) => {
      const root = getProjectWorkspace(req.params.projectId);
      if (!root) return res.status(404).json({ ok: false, error: '项目工作目录不存在' });
      const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
      if (paths.length === 0 || paths.length > 12) {
        return res.status(400).json({ ok: false, error: '请提供 1 到 12 个项目相对路径' });
      }
      try {
        const profiles = [];
        for (const relativePath of paths) {
          const normalizedPath = String(relativePath || '').replace(/\\/g, '/');
          const target = resolveInside(root, normalizedPath);
          if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
            return res.status(404).json({ ok: false, error: '文件不存在', relativePath: normalizedPath });
          }
          profiles.push(await profileData({
            projectId: req.params.projectId,
            relativePath: normalizedPath,
            absolutePath: target,
          }));
        }
        return res.json({ ok: true, profiles });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message || '数据画像失败' });
      }
    });

    app.post('/api/workspaces/:projectId/import', requireTrustedDesktopOrigin, (req, res) => {
      projectDataImport(req, res, async (uploadError) => {
        const files = Array.isArray(req.files) ? req.files : [];
        if (uploadError) {
          await removeUploadedFiles(files);
          return res.status(400).json({ ok: false, error: uploadError.message || '导入失败' });
        }
        if (files.length === 0) {
          return res.status(400).json({ ok: false, error: '请选择至少一个 CSV、TSV 或 TXT 文件' });
        }

        const root = getProjectWorkspace(req.params.projectId);
        if (!root) {
          await removeUploadedFiles(files);
          return res.status(404).json({ ok: false, error: '项目工作目录不存在' });
        }

        const dataDir = path.join(root, 'data');
        const copied = [];
        try {
          await fs.promises.mkdir(dataDir, { recursive: true });
          const dataDirStat = await fs.promises.lstat(dataDir);
          if (dataDirStat.isSymbolicLink() || !resolveInside(root, 'data')) {
            throw new Error('项目 data 目录不能是工作区外部链接');
          }
          const imported = [];
          for (const file of files) {
            const destination = await copyImportWithoutOverwrite(file.path, dataDir, file.originalname);
            copied.push(destination);
            const relativePath = path.relative(root, destination).split(path.sep).join('/');
            const profile = await profileData({
              projectId: req.params.projectId,
              relativePath,
              absolutePath: destination,
            });
            imported.push({
              name: path.basename(destination),
              relativePath,
              size: file.size,
              profile,
            });
          }
          await removeUploadedFiles(files);
          return res.status(201).json({ ok: true, imported });
        } catch (error) {
          await removeUploadedFiles(files);
          await Promise.all(copied.map(async (target) => {
            try {
              await fs.promises.rm(target, { force: true });
            } catch {}
          }));
          return res.status(500).json({ ok: false, error: error.message || '导入失败' });
        }
      });
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

  // origin 校验必须先于 multer 解析 body，拒绝不可信来源的上传
  app.post('/api/upload', requireTrustedDesktopOrigin, upload.single('file'), async (req, res) => {
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
module.exports.safeImportedFilename = safeImportedFilename;
module.exports.copyImportWithoutOverwrite = copyImportWithoutOverwrite;
