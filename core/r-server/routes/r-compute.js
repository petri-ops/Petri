/**
 * routes/r-compute.js — R 即时执行 + Replot 代理路由。
 *
 * 从 server.js 抽出。仅在 Dell compute 节点（runMode=all|api）实际执行；
 * platform runMode 下 rComputeOnly 中间件返回 503 compute_on_dell。
 *
 * 依赖：docker exec Rscript、R plumber (port 8787)、OSS 上传。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFile, execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const config = require('../config');
const IS_PLATFORM = config.runMode === 'platform';
const IS_LOCAL = config.execMode === 'local';

// 执行器注册表（local 模式用，延迟 require 避免循环依赖）
let _executor = null;
function getRExecutor() {
  if (!_executor) {
    const { getExecutor } = require('../../shared-backend/executors');
    _executor = getExecutor('r');
  }
  return _executor;
}

// 存储适配器（local 模式用本地文件，web 模式用 OSS）
let _storage = null;
function getStorage() {
  if (!_storage) {
    const { getActiveStorage } = require('../../shared-backend/storage');
    _storage = getActiveStorage();
  }
  return _storage;
}

// 路径：local 模式用 config.tempDir（可配），docker 模式用原有硬编码
const TEMP_DIR = IS_LOCAL ? (config.tempDir || '/tmp/biof3-tmp') : '/mnt/storage_16tb/omichub/biof3-tmp';
const CONTAINER_TEMP_DIR = IS_LOCAL ? TEMP_DIR : '/app/data/biof3-tmp';
const R_CONTAINER = 'omichub_react_backend_1';
const TIMEOUT_MS = 30000;

// OSS client is bridged via globalThis._biof3 by ai-bridge.js
function getOssClient() {
  return (globalThis._biof3 && globalThis._biof3.ossClient) || null;
}

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

// ── Platform guard ────────────────────────────────────────────
function rComputeOnly(req, res, next) {
  if (IS_PLATFORM) {
    return res.status(503).json({
      status: 'error',
      error: 'compute_on_dell',
      message: 'R 即时执行在算力节点（/api/r/），控制面仅支持任务入队 /api/task',
    });
  }
  next();
}

// ── Helpers ───────────────────────────────────────────────────
async function collectAndUploadImages(workDir) {
  const images = [];
  const storage = IS_LOCAL ? getStorage() : null;
  const ossClient = IS_LOCAL ? null : getOssClient();
  try {
    const files = fs
      .readdirSync(workDir)
      .filter((f) => f.startsWith('plot_') && f.endsWith('.png'));
    files.sort();
    const sessionId = path.basename(workDir);
    for (const f of files) {
      const localPath = path.join(workDir, f);
      // local 模式：走 StorageAdapter（本地文件）
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
      // docker/web 模式：走 OSS（原有逻辑）
      if (ossClient) {
        const ossKey = `results/${sessionId}/${f}`;
        try {
          await ossClient.put(ossKey, localPath);
          const url = `https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/${ossKey}`;
          images.push(url);
          continue;
        } catch {
          // Fallback to base64 if OSS upload fails
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
    hostname: getContainerIp(),
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

function getContainerIp() {
  // local 模式：plumber 跑在 localhost
  if (IS_LOCAL) return '127.0.0.1';
  try {
    return execSync(
      "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' omichub_react_backend_1"
    )
      .toString()
      .trim();
  } catch {
    return '127.0.0.1';
  }
}

// ── Route registration ────────────────────────────────────────
function registerRCompute(app) {
  // Execute R code
  app.post('/api/run', rComputeOnly, (req, res) => {
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
    const containerWorkDir = `${CONTAINER_TEMP_DIR}/${sessionId}`;
    config.mkdirSandbox(workDir);

    const rScript = `
setwd("${containerWorkDir}")
options(device = function(...) png(file.path("${containerWorkDir}", sprintf("plot_%03d.png", length(list.files(pattern="plot_.*\\\\.png")) + 1)), width = 600, height = 400, res = 100, ...))
tryCatch({
${code}
  # Auto-print last ggplot if not already printed
  lp <- tryCatch(ggplot2::last_plot(), error = function(e) NULL)
  if (!is.null(lp) && length(list.files("${containerWorkDir}", pattern="plot_.*\\\\.png")) == 0) print(lp)
}, error = function(e) {
  cat("Error:", conditionMessage(e), "\\n")
})
while (dev.cur() > 1) dev.off()
`;

    const scriptPath = path.join(workDir, 'run.R');
    fs.writeFileSync(scriptPath, rScript);

    // local 模式：直接调 Rscript；docker 模式：走 docker exec
    let execCmd, execArgs;
    if (IS_LOCAL) {
      const executor = getRExecutor();
      const spawnCmd = executor.buildSpawnCommand(`${workDir}/run.R`, workDir, {});
      execCmd = spawnCmd.cmd;
      execArgs = spawnCmd.args;
    } else {
      execCmd = 'docker';
      execArgs = [...config.dockerExecArgs(), 'Rscript', '--vanilla', `${containerWorkDir}/run.R`];
    }

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

  // ── Replot API — proxy to R plumber service inside Docker (port 8787) ──
  app.post('/api/replot/warmup', rComputeOnly, (req, res) => {
    const { taskId, cachePath } = req.body;
    if (!taskId || !cachePath) {
      return res.status(400).json({ status: 'error', error: 'Missing taskId or cachePath' });
    }
    proxyToR('/warmup', { taskId, cachePath }, res);
  });

  app.post('/api/replot/run', rComputeOnly, (req, res) => {
    const { taskId, code } = req.body;
    if (!taskId || !code) {
      return res.status(400).json({ status: 'error', error: 'Missing taskId or code' });
    }
    proxyToR('/run-json', { taskId, code }, res);
  });

  app.get('/api/replot/status', rComputeOnly, (req, res) => {
    const containerIp = getContainerIp();
    http
      .get(`http://${containerIp}:8787/status`, (proxyRes) => {
        const chunks = [];
        proxyRes.on('data', (c) => chunks.push(c));
        proxyRes.on('end', () => res.json(JSON.parse(Buffer.concat(chunks).toString())));
      })
      .on('error', (e) => res.status(502).json({ status: 'error', error: e.message }));
  });

  // ── R container pre-warm (best-effort, async) ────────────────
  if (!IS_PLATFORM) {
    execFile(
      'docker',
      [
        'exec',
        R_CONTAINER,
        'Rscript',
        '--vanilla',
        '-e',
        'suppressMessages(library(ggplot2)); cat("warmed\\n")',
      ],
      { timeout: 30000 },
      (err, out) => {
        if (out && out.includes('warmed'))
          console.log('  R container warmed (ggplot2 loaded in ' + R_CONTAINER + ')');
      }
    );
  }
}

module.exports = { registerRCompute, rComputeOnly };
