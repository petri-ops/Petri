/**
 * BioF3 Python Execution Server
 *
 * Parallel to r-server, handles Python-native bioinformatics workflows.
 * Runs on a separate port (default 3004) with independent process pool.
 *
 * API:
 *   POST /api/run          — Execute Python code (fast, pooled)
 *   GET  /api/health       — Health check
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
let multer = null;
try {
  multer = require('multer');
} catch (e) {
  console.warn('[py-server] multer unavailable, file upload disabled:', e.message);
}

const config = require('./config');
const logger = require('./logger');
const { createPool } = require('./py-pool');
const { getExecutor } = require('../shared-backend/executors');
const { getPythonRuntimeExecutable } = require('../shared-backend/runtime-paths');
const { corsOrigin, isTrustedDesktopOrigin } = require('../shared-backend/local-request-boundary');

// 桌面版：注册执行器 + 存储适配器（必须在路由之前）
try {
  require('../shared-backend/init').initSharedBackend();
} catch (e) {
  console.warn('[py-server] shared-backend init failed:', e.message);
}

// 断点1（分仓前置）：把 py-server 自己的 config 注入 shared-backend。
// 这样执行器读 config-helper.getConfig() 拿到真 config（不走 env fallback）。
// py-server 不调 LLM providers，不注入 recordAiUsage（helper 未注入时 no-op）。
// 注意：require('../shared-backend') 走相对路径解析到 barrel；分仓后改 @biof3/shared-backend。
try {
  require('../shared-backend').configure({
    getConfig: () => require('./config'),
  });
} catch (e) {
  console.warn('[py-server] shared-backend configure failed:', e.message);
}

// 桌面版：从磁盘加载已装插件（py-server 是独立子进程，不共享 Electron 主进程
// 的 globalThis._biof3Plugins，必须自己扫 ~/Documents/BioF3-Local/plugins/）
try {
  require('../r-server/plugin-loader').loadPluginsFromDisk();
} catch (e) {
  console.warn('[py-server] plugin-loader init failed:', e.message);
}

// ============================================================
// Initialize
// ============================================================

if (!fs.existsSync(config.tempDir)) {
  fs.mkdirSync(config.tempDir, { recursive: true });
}

let pyPool = null;
if (config.poolEnabled) {
  pyPool = createPool();
}

// 本地存储适配器（桌面版）
let _storage = null;
function getStorage() {
  if (!_storage) {
    const { getActiveStorage } = require('../shared-backend/storage');
    _storage = getActiveStorage();
  }
  return _storage;
}

// ============================================================
// Express App
// ============================================================

const app = express();
app.use(cors({ origin: corsOrigin }));
// W2-A: 路径相关 body limit
// - /api/tools/* — 200mb（base64 上传大 h5ad 文件）
// - 其他 — 1mb（fast-path /api/run 等只接受小 JSON）
app.use((req, res, next) => {
  const limit = req.path.startsWith('/api/tools/') ? '200mb' : '1mb';
  express.json({ limit })(req, res, next);
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path !== '/api/health') {
      logger.debug(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
    }
  });
  next();
});

const { LOCAL_USER } = require('./jwt-auth');
function attachLocalUser(req, _res, next) {
  req.user = LOCAL_USER;
  next();
}
app.use(attachLocalUser);

// ── 桌面版本地文件服务 ──────────────────────────────────────
// /api/files/<key> → 从本地 results 目录读取文件并返回
app.get(/^\/api\/files\/(.+)$/, (req, res) => {
    const key = req.params[0];
    try {
      const { getActiveStorage } = require('../shared-backend/storage');
      const storage = getActiveStorage();
      if (!storage || !storage.exists(key)) {
        return res.status(404).json({ status: 'error', error: '文件不存在' });
      }
      const buf = storage.read(key);
      const ext = path.extname(key).toLowerCase();
      const ct = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
        '.csv': 'text/csv', '.tsv': 'text/tab-separated-values',
        '.txt': 'text/plain', '.h5': 'application/octet-stream',
        '.hdf5': 'application/octet-stream', '.h5ad': 'application/octet-stream',
      }[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', ct);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(buf);
    } catch (e) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });

// Upload
function createUploadMiddleware() {
  if (!multer) {
    return {
      single: () => (_req, res) =>
        res.status(501).json({ status: 'error', error: '文件上传功能暂不可用' }),
    };
  }
  return multer({
    dest: path.join(config.tempDir, 'uploads'),
    limits: { fileSize: config.maxUploadSize },
    fileFilter: (req, file, cb) => {
      const allowed = ['.csv', '.tsv', '.txt', '.h5ad', '.h5', '.hdf5', '.gz', '.loom', '.xlsx'];
      const ext = path.extname(file.originalname).toLowerCase();
      cb(allowed.includes(ext) ? null : new Error(`不支持: ${ext}`), allowed.includes(ext));
    },
  });
}
const upload = createUploadMiddleware();

// Rate limiting
const rateLimits = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimits.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + 60000;
  }
  record.count++;
  rateLimits.set(ip, record);
  return record.count <= config.rateLimitPerMinute;
}
setInterval(
  () => {
    const now = Date.now();
    for (const [ip, r] of rateLimits) {
      if (now > r.resetAt + 60000) rateLimits.delete(ip);
    }
  },
  5 * 60 * 1000
);

// ============================================================
// Routes
// ============================================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'py-server',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    pool: pyPool ? { enabled: true, size: config.poolSize } : { enabled: false },
  });
});

// File upload
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ status: 'error', error: '未收到文件' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  const newPath = req.file.path + ext;
  fs.renameSync(req.file.path, newPath);

  const fileKey = `uploads/py-${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  let fileUrl = null;

  try {
    const storage = getStorage();
    if (storage) {
      fileUrl = await storage.upload(newPath, fileKey);
    }
  } catch {}

  res.json({
    status: 'ok',
    filePath: newPath,
    ossUrl: fileUrl || newPath,
    originalName: req.file.originalname,
    size: req.file.size,
  });
});

// Execute Python code (fast path)
app.post('/api/run', async (req, res) => {
  if (!isTrustedDesktopOrigin(req.headers && req.headers.origin)) {
    return res.status(403).json({ status: 'error', error: 'untrusted_origin' });
  }
  return res.status(410).json({
    status: 'error',
    error: 'raw_python_execution_disabled',
    message: '任意 Python 代码执行入口已停用；正式分析必须通过已注册工具和 tool_job 执行。',
  });

  const ip = req.ip || req.socket.remoteAddress;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({
      status: 'error',
      error: `请求过于频繁（限制：${config.rateLimitPerMinute} 次/分钟）`,
    });
  }

  const { code } = req.body;
  if (!code || typeof code !== 'string')
    return res.status(400).json({ status: 'error', error: '缺少 code 参数' });
  if (code.length > 20000)
    return res.status(400).json({ status: 'error', error: '代码过长（最大 20000 字符）' });

  // Security: block dangerous operations
  const forbidden = [
    { pattern: /\bos\.system\s*\(/, name: 'os.system' },
    { pattern: /\bsubprocess\b/, name: 'subprocess' },
    { pattern: /\b__import__\s*\(/, name: '__import__' },
    { pattern: /\beval\s*\(/, name: 'eval' },
    { pattern: /\bexec\s*\(/, name: 'exec' },
    { pattern: /\bshutil\.rmtree\s*\(/, name: 'shutil.rmtree' },
    { pattern: /\bos\.remove\s*\(/, name: 'os.remove' },
  ];
  for (const { pattern, name } of forbidden) {
    if (pattern.test(code)) {
      return res.status(400).json({ status: 'error', error: `禁止使用 ${name}()` });
    }
  }

  const sessionId = uuidv4();
  const workDir = path.join(config.tempDir, sessionId);
  fs.mkdirSync(workDir, { recursive: true });

  try {
    let result;
    if (pyPool) {
      result = await pyPool.execute(code, workDir);
    } else {
      // Cold fallback — 本地执行内嵌 python
      const pyScript = `
import os, sys, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
os.chdir(${JSON.stringify(workDir)})
try:
${code
  .split('\n')
  .map((l) => '    ' + l)
  .join('\n')}
except Exception as e:
    print(f"Error: {e}")
finally:
    if plt.get_fignums(): plt.savefig("plot_001.png", dpi=150, bbox_inches="tight"); plt.close("all")
`;
      fs.writeFileSync(path.join(workDir, 'run.py'), pyScript);
      result = await new Promise((resolve, reject) => {
        const pyBin =
          getPythonRuntimeExecutable(config.pyHome || process.env.BIOF3_PY_HOME || '') ||
          getExecutor('python').binPath;
        execFile(
          pyBin,
          ['-u', path.join(workDir, 'run.py')],
          {
            timeout: config.runTimeoutMs,
            maxBuffer: 1024 * 1024 * 5,
            env: { ...process.env, PYTHONUNBUFFERED: '1' },
          },
          (error, stdout, stderr) => {
            if (error)
              reject(
                new Error(
                  error.killed
                    ? `执行超时（${config.runTimeoutMs / 1000}秒）`
                    : stderr || error.message
                )
              );
            else resolve({ stdout: stdout || '', stderr: stderr || '' });
          }
        );
      });
    }

    const images = await collectImages(workDir, sessionId);
    cleanup(workDir);
    res.json({
      status: 'success',
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      images,
    });
  } catch (err) {
    const images = await collectImages(workDir, sessionId);
    cleanup(workDir);
    res.json({ status: 'error', error: err.message, stdout: '', images });
  }
});

// ============================================================
// W2-A (2026-05-28): User-scoped tools API for /tools page
// JWT-authenticated, mirrors r-server /api/tools/* contract
// ============================================================
const { registerToolsRoutes } = require('./tools-router');
registerToolsRoutes(app);

// ============================================================
// Helpers
// ============================================================

async function collectImages(workDir, sessionId) {
  const images = [];
  const storage = getStorage();
  try {
    const files = fs.readdirSync(workDir).filter((f) => f.match(/\.(png|svg)$/));
    files.sort();
    for (const f of files) {
      const localPath = path.join(workDir, f);
      const key = `results/py-${sessionId}/${f}`;
      if (storage) {
        try {
          const url = await storage.upload(localPath, key);
          images.push(url);
          continue;
        } catch {}
      }
      // fallback: base64
      const data = fs.readFileSync(localPath);
      images.push(`data:image/png;base64,${data.toString('base64')}`);
    }
  } catch {}
  return images;
}

function cleanup(workDir) {
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {}
}

// ============================================================
// Start
// ============================================================

const server = app.listen(config.port, '127.0.0.1', () => {
  logger.info(`BioF3 Python Server running on port ${config.port}`, {
    pool: config.poolEnabled ? `${config.poolSize} workers` : 'disabled',
  });
  logger.info(`  POST http://localhost:${config.port}/api/run`);
  logger.info(`  POST http://localhost:${config.port}/api/tools/run`);
  logger.info(`  GET  http://localhost:${config.port}/api/health`);
});

// Graceful shutdown
function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down...`);
  server.close(() => {
    if (pyPool) pyPool.destroy();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) =>
  logger.error('Uncaught exception', { error: err.message })
);
process.on('unhandledRejection', (reason) =>
  logger.error('Unhandled rejection', { reason: String(reason) })
);
