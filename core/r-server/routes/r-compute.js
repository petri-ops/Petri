/**
 * routes/r-compute.js — R 即时执行 + Replot 代理路由。
 *
 * 本地执行内嵌 Rscript；Replot 代理到本地 R plumber (port 8787)。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const config = require('../config');
// 执行器注册表（local 模式用，延迟 require 避免循环依赖）
let _executor = null;
function getRExecutor() {
  if (!_executor) {
    const { getExecutor } = require('../../shared-backend/executors');
    _executor = getExecutor('r');
  }
  return _executor;
}

// 本地文件存储适配器
let _storage = null;
function getStorage() {
  if (!_storage) {
    const { getActiveStorage } = require('../../shared-backend/storage');
    _storage = getActiveStorage();
  }
  return _storage;
}

const TEMP_DIR = config.tempDir || '/tmp/biof3-tmp';
const TIMEOUT_MS = 30000;

// ── Rate limiting (simple in-memory, per-IP) ──────────────────
const rateLimits = new Map();
const RATE_LIMIT = 20; // requests per minute
const RATE_WINDOW = 60000; // 1 minute

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimits.get(ip) || { count: 0, resetAt: now + RATE_WINDOW };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + RATE_WINDOW;
  }
  record.count++;
  rateLimits.set(ip, record);
  return record.count <= RATE_LIMIT;
}

// ── Helpers ───────────────────────────────────────────────────
async function collectAndUploadImages(workDir) {
  const images = [];
  const storage = getStorage();
  try {
    const files = fs
      .readdirSync(workDir)
      .filter((f) => f.startsWith('plot_') && f.endsWith('.png'));
    files.sort();
    const sessionId = path.basename(workDir);
    for (const f of files) {
      const localPath = path.join(workDir, f);
      if (storage) {
        const key = `results/${sessionId}/${f}`;
        try {
          const url = await storage.upload(localPath, key);
          images.push(url);
          continue;
        } catch {
          // fallback to base64
        }
      }
      const imgData = fs.readFileSync(localPath);
      images.push(`data:image/png;base64,${imgData.toString('base64')}`);
    }
  } catch {}
  return images;
}

function cleanup(workDir) {
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {}
}

// ── Replot proxy helper ───────────────────────────────────────
function proxyToR(rPath, reqBody, res) {
  const postData = JSON.stringify(reqBody);
  const options = {
    hostname: getReplotHost(),
    port: 8787,
    path: rPath,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    timeout: 30000,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const chunks = [];
    proxyRes.on('data', (chunk) => chunks.push(chunk));
    proxyRes.on('end', () => {
      const body = Buffer.concat(chunks);
      const ct = proxyRes.headers['content-type'] || 'application/json';
      res.setHeader('Content-Type', ct);
      res.status(proxyRes.statusCode || 200).send(body);
    });
  });
  proxyReq.on('error', (e) => {
    res.status(502).json({ status: 'error', error: 'R replot service unavailable: ' + e.message });
  });
  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.status(504).json({ status: 'error', error: 'R replot service timeout' });
  });
  proxyReq.write(postData);
  proxyReq.end();
}

function getReplotHost() {
  return '127.0.0.1';
}

// ── Route registration ────────────────────────────────────────
function registerRCompute(app) {
  // Execute R code
  app.post('/api/run', (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(ip)) {
      return res.status(429).json({
        status: 'error',
        error: '请求过于频繁，请稍后再试（限制：20 次/分钟）',
      });
    }

    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ status: 'error', error: '缺少 code 参数' });
    }

    if (code.length > 10000) {
      return res.status(400).json({ status: 'error', error: '代码过长（最大 10000 字符）' });
    }

    // Security: block dangerous operations
    const forbidden = [
      { pattern: /\bsystem\s*\(/, name: 'system' },
      { pattern: /\bsystem2\s*\(/, name: 'system2' },
      { pattern: /\bshell\s*\(/, name: 'shell' },
      { pattern: /\bfile\.remove\s*\(/, name: 'file.remove' },
      { pattern: /\bunlink\s*\(/, name: 'unlink' },
      { pattern: /\bSys\.setenv\s*\(/, name: 'Sys.setenv' },
      { pattern: /\bquit\s*\(/, name: 'quit' },
      { pattern: /\.Internal\s*\(/, name: '.Internal' },
    ];
    for (const { pattern, name } of forbidden) {
      if (pattern.test(code)) {
        return res.status(400).json({
          status: 'error',
          error: `禁止使用 ${name}() 函数`,
        });
      }
    }

    const sessionId = uuidv4();
    const workDir = path.join(TEMP_DIR, sessionId);
    config.mkdirSandbox(workDir);

    const rScript = `
setwd("${workDir}")
options(device = function(...) png(file.path("${workDir}", sprintf("plot_%03d.png", length(list.files(pattern="plot_.*\\\\.png")) + 1)), width = 600, height = 400, res = 100, ...))
tryCatch({
${code}
  # Auto-print last ggplot if not already printed
  lp <- tryCatch(ggplot2::last_plot(), error = function(e) NULL)
  if (!is.null(lp) && length(list.files("${workDir}", pattern="plot_.*\\\\.png")) == 0) print(lp)
}, error = function(e) {
  cat("Error:", conditionMessage(e), "\\n")
})
while (dev.cur() > 1) dev.off()
`;

    const scriptPath = path.join(workDir, 'run.R');
    fs.writeFileSync(scriptPath, rScript);

    // 本地执行：直接调内嵌 Rscript
    const executor = getRExecutor();
    const spawnCmd = executor.buildSpawnCommand(`${workDir}/run.R`, workDir, {});
    const execCmd = spawnCmd.cmd;
    const execArgs = spawnCmd.args;

    execFile(
      execCmd,
      execArgs,
      {
        timeout: TIMEOUT_MS,
        maxBuffer: 1024 * 1024 * 5,
        env: { ...process.env, LC_ALL: 'en_US.UTF-8' },
      },
      async (error, stdout, stderr) => {
        const images = await collectAndUploadImages(workDir);
        cleanup(workDir);

        if (error) {
          if (error.killed) {
            return res.json({
              status: 'error',
              error: `执行超时（最大 ${TIMEOUT_MS / 1000} 秒）`,
              stdout: stdout || '',
              images,
            });
          }
          return res.json({
            status: 'error',
            error: stderr || error.message,
            stdout: stdout || '',
            images,
          });
        }
        res.json({ status: 'success', stdout: stdout || '', stderr: stderr || '', images });
      }
    );
  });

  // ── Replot API — proxy to local R plumber service (port 8787) ──
  app.post('/api/replot/warmup', (req, res) => {
    const { taskId, cachePath } = req.body;
    if (!taskId || !cachePath) {
      return res.status(400).json({ status: 'error', error: 'Missing taskId or cachePath' });
    }
    proxyToR('/warmup', { taskId, cachePath }, res);
  });

  app.post('/api/replot/run', (req, res) => {
    const { taskId, code } = req.body;
    if (!taskId || !code) {
      return res.status(400).json({ status: 'error', error: 'Missing taskId or code' });
    }
    proxyToR('/run-json', { taskId, code }, res);
  });

  app.get('/api/replot/status', (req, res) => {
    const replotHost = getReplotHost();
    http
      .get(`http://${replotHost}:8787/status`, (proxyRes) => {
        const chunks = [];
        proxyRes.on('data', (c) => chunks.push(c));
        proxyRes.on('end', () => res.json(JSON.parse(Buffer.concat(chunks).toString())));
      })
      .on('error', (e) => res.status(502).json({ status: 'error', error: e.message }));
  });

}

module.exports = { registerRCompute };
