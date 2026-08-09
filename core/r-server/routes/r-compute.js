/**
 * routes/r-compute.js — R 即时执行 + Replot 代理路由。
 *
 * 任意代码执行入口已停用；受控 Replot 代理到本地 R plumber (port 8787)。
 */
const http = require('http');
const { requireTrustedDesktopOrigin } = require('../helpers/local-request-boundary');

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
  app.post('/api/run', requireTrustedDesktopOrigin, (_req, res) => {
    return res.status(410).json({
      status: 'error',
      error: 'raw_r_execution_disabled',
      message: '任意 R 代码执行入口已停用；正式分析必须通过已注册工具和 tool_job 执行。',
    });
  });

  // ── Replot API — proxy to local R plumber service (port 8787) ──
  app.post('/api/replot/warmup', requireTrustedDesktopOrigin, (req, res) => {
    const { taskId, cachePath } = req.body;
    if (!taskId || !cachePath) {
      return res.status(400).json({ status: 'error', error: 'Missing taskId or cachePath' });
    }
    proxyToR('/warmup', { taskId, cachePath }, res);
  });

  app.post('/api/replot/run', requireTrustedDesktopOrigin, (_req, res) => {
    return res.status(410).json({
      status: 'error',
      error: 'raw_r_execution_disabled',
      message: '旧的任意代码 replot 入口已停用。',
    });
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
