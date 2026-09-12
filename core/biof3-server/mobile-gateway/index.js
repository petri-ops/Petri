'use strict';

/**
 * BLOCK-70 mobile-gateway — 手机浏览器直连移动面（同 WiFi / A2 隧道共用）。
 *
 * D1 独立 Express app 实例 + 独立端口；主后端 127.0.0.1:3001 本地面零改动。
 * D4 安全边界：默认关闭；除 /m/api/pair 与静态页外全部过会话 token 鉴权；
 * 按 IP 限速；JSONL 审计（只记元数据不记内容）。
 * D3 单一真相：mountRoutes 注入既有路由模块（同进程共享 db 单例），
 * 不建第二套存储；DB 零新业务表。
 *
 * 移动 app 实例只挂载读面所需的模块注入（files/workspace/terminal 等
 * 模块不进入本实例）——v1 无文件上传/产物下载。
 */

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const { getStores } = require('./pairing');
const { readConfig, resolveEnabled, resolvePort, lanAddresses } = require('./config');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 240;
const AUDIT_MAX_LINE_BYTES = 4 * 1024;

function createAuditWriter(auditPath) {
  return function audit(entry) {
    try {
      const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
      if (Buffer.byteLength(line, 'utf8') <= AUDIT_MAX_LINE_BYTES) {
        fs.appendFileSync(auditPath, `${line}\n`, 'utf8');
      }
    } catch {
      // 审计写失败绝不影响请求处理（fail-open 仅限审计自身）。
    }
  };
}

function createRateLimiter({ windowMs = RATE_LIMIT_WINDOW_MS, max = RATE_LIMIT_MAX_REQUESTS, now = () => Date.now() } = {}) {
  const hits = new Map(); // ip -> [timestamps]
  setInterval(() => hits.clear(), windowMs).unref?.();
  return function rateLimit(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const stamps = (hits.get(ip) || []).filter((ts) => now() - ts < windowMs);
    if (stamps.length >= max) {
      res.status(429).json({ ok: false, error: 'rate_limited', message: '请求过于频繁，请稍后再试' });
      return;
    }
    stamps.push(now());
    hits.set(ip, stamps);
    next();
  };
}

/**
 * 构建 mobile Express app。mountRoutes(app) 由调用方注入既有读面路由模块。
 */
function buildMobileGateway({
  dataDir,
  mountRoutes,
  auditPath = path.join(dataDir, 'mobile', 'audit.log'),
  rateLimit,
} = {}) {
  if (!dataDir) throw new Error('mobile_gateway_data_dir_required');
  const stores = getStores(dataDir);
  const audit = createAuditWriter(auditPath);
  const app = express();
  app.disable('x-powered-by');

  app.use(createRateLimiter(rateLimit ? { ...rateLimit } : {}));

  // 审计中间件：只记元数据（ip/method/path/status/时长），不记 query 与 body（D9）。
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      audit({
        ip: req.ip || req.socket?.remoteAddress || 'unknown',
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });
    next();
  });

  // 静态移动页（/m）。fallthrough 保持默认 true：/m/api/* 必须穿透到下方
  // API 中间件链，不能被静态中间件吞掉。
  const publicDir = path.join(__dirname, 'public');
  app.use('/m', express.static(publicDir, { index: 'index.html' }));

  app.use(express.json({ limit: '64kb' }));

  // 配对：一次性 token 换持久会话 token（无需既有会话）。
  app.post('/m/api/pair', (req, res) => {
    const token = String(req.body?.token || '');
    const redeemed = stores.pairing.redeem(token);
    if (!redeemed) {
      res.status(401).json({ ok: false, error: 'pair_token_invalid', message: '配对码无效或已过期，请在桌面端重新生成' });
      return;
    }
    const userAgent = String(req.headers['user-agent'] || '');
    const name = /iphone|ipad/i.test(userAgent) ? 'iOS 设备'
      : /android/i.test(userAgent) ? 'Android 设备'
        : '移动设备';
    const { sessionId, sessionToken } = stores.sessions.createSession({ name });
    res.json({ ok: true, sessionId, sessionToken });
  });

  // 会话鉴权：Authorization: Bearer <token> 或（EventSource 场景）?session=<token>。
  function sessionAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
    const token = bearer || String(req.query.session || '');
    const session = stores.sessions.authenticate(token);
    if (!session) {
      res.status(401).json({ ok: false, error: 'session_invalid', message: '会话无效或已被吊销' });
      return;
    }
    req.mobileSession = { id: session.id, name: session.name };
    req.user = { id: 'local' };
    next();
  }

  app.get('/m/api/health', (_req, res) => {
    res.json({ ok: true, service: 'gewu-mobile-gateway' });
  });

  // 会话鉴权：公开面（静态页 / 配对 / 健康）之外的一切端点——包括挂载的
  // 既有 /api/* 路由模块——都必须持有效会话（D4：token 鉴权中间件全覆盖）。
  app.use(sessionAuth);

  // P2 控制面窄口：批准决定（进程内直调 db.ackToolJob，权限不放大）。
  require('./control').registerMobileControl(app);

  // 既有读面/控制路由模块注入（conversations / agent tasks / SSE / tools）。
  if (typeof mountRoutes === 'function') {
    mountRoutes(app);
  }

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    res.status(500).json({ ok: false, error: 'mobile_gateway_error', message: '移动网关内部错误' });
  });

  return { app, stores, audit };
}

/**
 * 按配置/env 启动。默认关闭 → 返回 { started:false }（additive 红线）。
 */
function startMobileGateway({ dataDir, mountRoutes, env = process.env } = {}) {
  if (!resolveEnabled({ dataDir, env })) {
    return { started: false, reason: 'disabled' };
  }
  const port = resolvePort({ dataDir, env });
  const config = readConfig(dataDir);
  const { app, stores } = buildMobileGateway({ dataDir, mountRoutes });
  const server = app.listen(port, config.bind, () => {
    console.log(`📱 [mobile-gateway] listening on ${config.bind}:${port} (LAN: ${(lanAddresses()).join(', ') || 'N/A'})`);
  });
  server.on('error', (error) => {
    console.warn(`[mobile-gateway] listen failed on :${port}:`, error.message);
  });
  return {
    started: true,
    port,
    bind: config.bind,
    server,
    stores,
    lanAddresses: lanAddresses(),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = {
  buildMobileGateway,
  startMobileGateway,
  createRateLimiter,
  lanAddresses,
  readConfig,
};
