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
const workspaceGateway = require('../helpers/workspace-gateway');
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

// BLOCK-67：ssh 项目走 Workspace Gateway（远程唯一真值）；local 项目沿用上方现路径（零回归）。
function getProjectRecord(projectId) {
  const db = require('../db');
  return db.getProject(projectId);
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
  app.get('/api/workspaces/:projectId/tree', requireTrustedDesktopOrigin, async (req, res) => {
      try {
        // BLOCK-67：ssh 项目树 = Gateway fs_list（条目契约与本地同构：name/type/size/mtimeMs）。
        const project = getProjectRecord(req.params.projectId);
        if (project && project.workspace_kind === 'ssh') {
          const { backend, root, error } = workspaceGateway.resolveWorkspaceBackend(project) || {};
          if (error) return res.status(404).json({ ok: false, error: '项目工作目录不存在' });
          const abs = workspaceGateway.safeRemoteJoin(root, String(req.query.prefix || ''));
          if (!abs) return res.status(400).json({ ok: false, error: '非法路径' });
          try {
            // BLOCK-96 F2 — ?limit=N 分页（不传 = 全量，响应形状逐字节兼容）；
            // truncated 显式标记而非静默截断。前端游标加载按 offset 续拉。
            const limit = Number(req.query.limit || 0);
            const offset = Number(req.query.offset || 0);
            const mapEntry = (e) => ({
              name: e.name,
              type: e.type,
              size: e.type === 'file' ? e.size : undefined,
              modifiedAt: e.mtimeMs,
            });
            if (limit > 0) {
              const page = await backend.listPage(abs, { limit, offset });
              return res.json({ ok: true, entries: page.entries.map(mapEntry), total: page.total, truncated: page.truncated });
            }
            const rawEntries = await backend.list(abs);
            return res.json({ ok: true, entries: rawEntries.map(mapEntry) });
          } catch (e) {
            if (e.remoteError === 'not_found') return res.status(404).json({ ok: false, error: '目录不存在' });
            if (e.classified) return res.status(502).json({ ok: false, error: `远程连接失败: ${e.classified.kind}`, retryable: e.classified.retryable === true });
            return res.status(500).json({ ok: false, error: e.message });
          }
        }
        const root = getProjectWorkspace(req.params.projectId);
        if (!root) return res.status(404).json({ ok: false, error: '项目工作目录不存在' });
        const dir = resolveInside(root, req.query.prefix || '');
        if (!dir) return res.status(400).json({ ok: false, error: '非法路径' });
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.statSync(dir).isDirectory()) {
          return res.status(400).json({ ok: false, error: '不是目录' });
        }
        // BLOCK-73：?showHidden=1 时不过滤点开头条目（前端「显示隐藏文件」开关；默认关维持现状体感）
        const showHiddenEntries = req.query.showHidden === '1';
        const entries = fs
          .readdirSync(dir, { withFileTypes: true })
          .filter((entry) => showHiddenEntries || !entry.name.startsWith('.'))
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
        // BLOCK-96 F2 — 与 ssh 分支同契约的分页切片（不传 limit = 全量）。
        const limit = Number(req.query.limit || 0);
        const offset = Number(req.query.offset || 0);
        if (limit > 0) {
          const page = workspaceGateway.paginateEntries(entries, { limit, offset });
          return res.json({ ok: true, entries: page.entries, total: page.total, truncated: page.truncated });
        }
        res.json({ ok: true, entries });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    app.get('/api/workspaces/:projectId/file', requireTrustedDesktopOrigin, async (req, res) => {
      try {
        // BLOCK-67：ssh 项目预览 = Gateway fs_read（二进制 base64 往返，Content-Type 按扩展名同构）。
        const project = getProjectRecord(req.params.projectId);
        if (project && project.workspace_kind === 'ssh') {
          const { backend, root, error } = workspaceGateway.resolveWorkspaceBackend(project) || {};
          if (error) return res.status(404).json({ status: 'error', error: '项目工作目录不存在' });
          const abs = workspaceGateway.safeRemoteJoin(root, String(req.query.path || ''));
          if (!abs) return res.status(400).json({ status: 'error', error: '非法路径' });
          try {
            // D2 体感预算：省一次 stat 往返（fs_read 对目录/缺失路径会以
            // not_found / 空载诚实回退，无需先 stat 验型）。
            const MAX_PREVIEW_BYTES = 16 * 1024 * 1024;
            const data = await backend.read(abs, { length: MAX_PREVIEW_BYTES });
            res.setHeader('Content-Type', contentTypeFor(abs));
            return res.send(data);
          } catch (e) {
            if (e.remoteError === 'not_found') return res.status(404).json({ status: 'error', error: '文件不存在' });
            if (e.classified) return res.status(502).json({ status: 'error', error: `远程连接失败: ${e.classified.kind}` });
            return res.status(500).json({ status: 'error', error: e.message });
          }
        }
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

    // UI-397 — SSH 连接探活（呼吸灯数据源）：轻量 fs_stat 走 mux 长连接，
    // {ok:true, ms} = 绿；失败/超时 = 红。前端心跳 30s 轮询 + 手动重试共用。
    app.get('/api/workspaces/:projectId/ssh-ping', requireTrustedDesktopOrigin, async (req, res) => {
      const project = getProjectRecord(req.params.projectId);
      if (!project || project.workspace_kind !== 'ssh') {
        return res.status(400).json({ ok: false, error: '仅 SSH 远程项目提供探活' });
      }
      const { backend, root, error } = workspaceGateway.resolveWorkspaceBackend(project) || {};
      if (error) return res.status(404).json({ ok: false, error: '项目工作目录不存在' });
      const startedAt = Date.now();
      try {
        await backend.stat(root, { timeoutMs: 8000 });
        return res.json({ ok: true, ms: Date.now() - startedAt });
      } catch (e) {
        return res.json({ ok: false, ms: Date.now() - startedAt, error: String(e.message || e).slice(0, 120) });
      }
    });

    // BLOCK-67：ssh 项目编辑保存（write-through 直写远程；本地项目沿用既有 IPC 通道，此端点不接）。
    app.put('/api/workspaces/:projectId/file', requireTrustedDesktopOrigin, async (req, res) => {
      const project = getProjectRecord(req.params.projectId);
      if (!project || project.workspace_kind !== 'ssh') {
        return res.status(400).json({ ok: false, error: '仅 SSH 远程项目走 REST 写通道' });
      }
      const { backend, root, error } = workspaceGateway.resolveWorkspaceBackend(project) || {};
      if (error) return res.status(404).json({ ok: false, error: '项目工作目录不存在' });
      const rel = String(req.query.path || req.body?.path || '');
      const abs = workspaceGateway.safeRemoteJoin(root, rel);
      if (!abs) return res.status(400).json({ ok: false, error: '非法路径' });
      const content = typeof req.body?.content === 'string' ? req.body.content : null;
      if (content === null) return res.status(400).json({ ok: false, error: '缺少 content' });
      try {
        const info = await backend.write(abs, content, {
          expectedMtimeMs: typeof req.body?.expectedMtimeMs === 'number' ? req.body.expectedMtimeMs : undefined,
        });
        return res.json({ ok: true, stat: info });
      } catch (e) {
        if (e.code === 'remote_file_changed' || /remote_file_changed/.test(e.message || '')) {
          return res.status(409).json({ ok: false, error: '文件已被其他端修改，请重新加载后再保存', code: 'remote_file_changed' });
        }
        if (e.code === 'fs_write_too_large') return res.status(413).json({ ok: false, error: '文件超过 1MB 写入上限' });
        if (e.classified) return res.status(502).json({ ok: false, error: `远程连接失败: ${e.classified.kind}` });
        return res.status(500).json({ ok: false, error: e.message });
      }
    });

    // ── BLOCK-89：工作区文件操作（move/copy/delete/mkdir）──────────────
    // 本地/ssh 双后端同构（workspaceGateway 透传），前端零感知 workspaceKind。
    // 路径边界：local=resolveInside（safeJoinUnder+realpath）/ ssh=safeRemoteJoin。
    // 冲突语义单一：目标已存在 → 409 target_already_exists（D4）。
    function requireFsContext(req, res) {
      const project = getProjectRecord(req.params.projectId);
      if (!project) {
        res.status(404).json({ ok: false, error: '项目工作目录不存在' });
        return null;
      }
      const { backend, root, error } = workspaceGateway.resolveWorkspaceBackend(project) || {};
      if (error || !backend || !root) {
        res.status(404).json({ ok: false, error: '项目工作目录不存在' });
        return null;
      }
      const resolve = (rel) => (project.workspace_kind === 'ssh'
        ? workspaceGateway.safeRemoteJoin(root, rel)
        : resolveInside(root, rel));
      return { project, backend, resolve };
    }

    function fsEntryOr404(ctx, res, rel) {
      const target = ctx.resolve(rel);
      if (!target) {
        res.status(400).json({ ok: false, error: '非法路径' });
        return null;
      }
      return target;
    }

    async function fsPathExists(backend, target) {
      try {
        await backend.stat(target);
        return true;
      } catch (e) {
        // not_found 才算「不存在」；classified/连接错误如实上抛（否则 ssh 断线会被误报成 404）
        if (e && (e.remoteError === 'not_found' || e.code === 'ENOENT')) return false;
        throw e;
      }
    }

    function fsOpError(e) {
      if (e && (e.remoteError === 'not_found' || e.code === 'ENOENT')) {
        return { status: 404, body: { ok: false, error: '路径不存在' } };
      }
      if (e && e.code === 'EEXIST') {
        return { status: 409, body: { ok: false, error: '目标已存在', code: 'target_already_exists' } };
      }
      if (e && e.classified) {
        return { status: 502, body: { ok: false, error: `远程连接失败: ${e.classified.kind}`, retryable: e.classified.retryable === true } };
      }
      return null;
    }

    /** move/copy 共用主体：源存在校验 → 目标冲突 409 → 后端 op。 */
    async function handleFsTransfer(req, res, op) {
      const ctx = requireFsContext(req, res);
      if (!ctx) return;
      const fromPath = String(req.body?.fromPath || '');
      const toPath = String(req.body?.toPath || '');
      if (!fromPath || !toPath) {
        return res.status(400).json({ ok: false, error: '缺少 fromPath/toPath' });
      }
      const src = fsEntryOr404(ctx, res, fromPath);
      if (!src) return;
      const dst = fsEntryOr404(ctx, res, toPath);
      if (!dst) return;
      const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
      if (norm(dst) === norm(src) || norm(dst).startsWith(`${norm(src)}/`)) {
        return res.status(400).json({ ok: false, error: '目标不能与源相同或位于源内部' });
      }
      try {
        if (!(await fsPathExists(ctx.backend, src))) {
          return res.status(404).json({ ok: false, error: '源路径不存在' });
        }
        if (await fsPathExists(ctx.backend, dst)) {
          return res.status(409).json({ ok: false, error: '目标已存在', code: 'target_already_exists' });
        }
        const entry = await ctx.backend[op](src, dst);
        return res.json({ ok: true, entry });
      } catch (e) {
        const mapped = fsOpError(e);
        if (mapped) return res.status(mapped.status).json(mapped.body);
        return res.status(500).json({ ok: false, error: e.message });
      }
    }

    app.post('/api/workspaces/:projectId/fs/move', requireTrustedDesktopOrigin, async (req, res) => {
      await handleFsTransfer(req, res, 'mv');
    });

    app.post('/api/workspaces/:projectId/fs/copy', requireTrustedDesktopOrigin, async (req, res) => {
      await handleFsTransfer(req, res, 'cp');
    });

    app.post('/api/workspaces/:projectId/fs/delete', requireTrustedDesktopOrigin, async (req, res) => {
      const ctx = requireFsContext(req, res);
      if (!ctx) return;
      const paths = Array.isArray(req.body?.paths) ? req.body.paths.map((p) => String(p || '')) : [];
      if (paths.length === 0 || paths.length > 50) {
        return res.status(400).json({ ok: false, error: '请提供 1 到 50 个相对路径' });
      }
      const targets = [];
      for (const rel of paths) {
        const target = fsEntryOr404(ctx, res, rel);
        if (!target) return;
        targets.push(target);
      }
      try {
        for (const target of targets) {
          if (!(await fsPathExists(ctx.backend, target))) {
            return res.status(404).json({ ok: false, error: '路径不存在', path: target });
          }
        }
        for (const target of targets) {
          await ctx.backend.rm(target);
        }
        return res.json({ ok: true, removed: targets.length });
      } catch (e) {
        const mapped = fsOpError(e);
        if (mapped) return res.status(mapped.status).json(mapped.body);
        return res.status(500).json({ ok: false, error: e.message });
      }
    });

    app.post('/api/workspaces/:projectId/fs/mkdir', requireTrustedDesktopOrigin, async (req, res) => {
      const ctx = requireFsContext(req, res);
      if (!ctx) return;
      const rel = String(req.body?.path || '');
      if (!rel) {
        return res.status(400).json({ ok: false, error: '缺少 path' });
      }
      const target = fsEntryOr404(ctx, res, rel);
      if (!target) return;
      try {
        if (await fsPathExists(ctx.backend, target)) {
          return res.status(409).json({ ok: false, error: '目标已存在', code: 'target_already_exists' });
        }
        const entry = await ctx.backend.mkdir(target);
        return res.json({ ok: true, entry });
      } catch (e) {
        const mapped = fsOpError(e);
        if (mapped) return res.status(mapped.status).json(mapped.body);
        return res.status(500).json({ ok: false, error: e.message });
      }
    });

    // ── BLOCK-90：OS 拖入导入（upload 分片 / import-from 本地路径拷贝）──────
    // fs/upload：renderer 把桌面文件分片（64KB 二进制/片，b64 后 <128KB argv 上限）
    // 串行上传，local/ssh 双后端同构。offset 完整性：0 时目标须不存在（409
    // target_already_exists），>0 时当前 size 必须===offset（409 offset_mismatch）。
    app.post('/api/workspaces/:projectId/fs/upload', requireTrustedDesktopOrigin, async (req, res) => {
      const ctx = requireFsContext(req, res);
      if (!ctx) return;
      const toPath = String(req.body?.toPath || '');
      const dataB64 = String(req.body?.dataB64 || '');
      const offset = Number(req.body?.offset);
      if (!toPath || !Number.isInteger(offset) || offset < 0) {
        return res.status(400).json({ ok: false, error: '缺少 toPath/offset' });
      }
      if (!/^[A-Za-z0-9+/=]*$/.test(dataB64)) {
        return res.status(400).json({ ok: false, error: 'dataB64 非法' });
      }
      const chunk = Buffer.from(dataB64, 'base64');
      if (chunk.length > 96 * 1024) {
        return res.status(400).json({ ok: false, error: '分片超过 96KB 上限' });
      }
      const target = fsEntryOr404(ctx, res, toPath);
      if (!target) return;
      try {
        if (offset === 0 && (await fsPathExists(ctx.backend, target))) {
          return res.status(409).json({ ok: false, error: '目标已存在', code: 'target_already_exists' });
        }
        const entry = await ctx.backend.append(target, ctx.project.workspace_kind === 'ssh' ? dataB64 : chunk, offset);
        return res.json({ ok: true, entry });
      } catch (e) {
        if (e && e.remoteError === 'offset_mismatch') {
          return res.status(409).json({ ok: false, error: '分片偏移与当前文件大小不一致', code: 'offset_mismatch' });
        }
        const mapped = fsOpError(e);
        if (mapped) return res.status(mapped.status).json(mapped.body);
        return res.status(500).json({ ok: false, error: e.message });
      }
    });

    // fs/import-from：本地项目专属——服务端从桌面绝对路径拷入工作区（文件/目录
    // 递归，无 1MB 上限）。ssh 项目源文件在桌面机、工作区在远端，走 fs/upload，
    // 此处显式拒绝（诚实边界，plan D2）。
    app.post('/api/workspaces/:projectId/fs/import-from', requireTrustedDesktopOrigin, async (req, res) => {
      const ctx = requireFsContext(req, res);
      if (!ctx) return;
      if (ctx.project.workspace_kind === 'ssh') {
        return res.status(400).json({ ok: false, error: '远程项目暂不支持外部路径导入，请使用分片上传', code: 'import_requires_local' });
      }
      const sourceAbsolutePath = String(req.body?.sourceAbsolutePath || '');
      const toPath = String(req.body?.toPath || '');
      if (!path.isAbsolute(sourceAbsolutePath) || !toPath) {
        return res.status(400).json({ ok: false, error: '缺少 sourceAbsolutePath/toPath' });
      }
      const target = fsEntryOr404(ctx, res, toPath);
      if (!target) return;
      try {
        await fs.promises.stat(sourceAbsolutePath);
        if (await fsPathExists(ctx.backend, target)) {
          return res.status(409).json({ ok: false, error: '目标已存在', code: 'target_already_exists' });
        }
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.cp(sourceAbsolutePath, target, { recursive: true, force: false, errorOnExist: true });
        return res.json({ ok: true, entry: await ctx.backend.stat(target) });
      } catch (e) {
        if (e && e.code === 'ENOENT') {
          return res.status(404).json({ ok: false, error: '源路径不存在' });
        }
        if (e && e.code === 'EEXIST') {
          return res.status(409).json({ ok: false, error: '目标已存在', code: 'target_already_exists' });
        }
        return res.status(500).json({ ok: false, error: e.message });
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
