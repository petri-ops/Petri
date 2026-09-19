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
const { readFileSync } = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { getStores } = require('./pairing');
const { sanitizeEngineerIdentity } = require('../../shared-backend/engineer-identity');
const { readConfig, resolveEnabled, resolvePort, lanAddresses } = require('./config');
const crypto = require('node:crypto');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
// BLOCK-87 实测修正：投影 SPA 自带大量轮询器（摘要卡 5s×多路、会话对账 5s、
// 偏好 15s…），且经隧道时全部设备共享 127.0.0.1 一个 IP——240/分 必然误伤
// 正常使用（用户实测「总是 rate_limited」）。限速目的（D4）是保护 API 面不被
// 爆破/刷量，不是限制页面资产：静态资源与 Vite 热更模块不计数，只计 API 面。
const RATE_LIMIT_MAX_REQUESTS = 600;
// 计入限速的 API 前缀（其余路径——/m 静态页、投影 SPA 资产、Vite 代理——
// 仍过 sessionAuth 会话门，只是不消耗限速配额）。
const RATE_LIMITED_PREFIXES = ['/api/', '/m/api/', '/federation/'];
const AUDIT_MAX_LINE_BYTES = 4 * 1024;
// 会话 cookie 长效：一次认证长期有效，除非用户主动吊销/关闭（加映 4）。
const SESSION_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
// 同名设备记录区分用短尾缀（无登录态下不做设备指纹，代价可接受）。
function pairShortId() {
  return crypto.randomBytes(2).toString('hex');
}

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
    const isApi = RATE_LIMITED_PREFIXES.some((prefix) => req.path.startsWith(prefix));
    if (!isApi) return next();
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
  // 加映 4：请求已带有效会话（cookie/Bearer）时直接复用，不再新建——
  // 同一手机重复扫码/重开配对链接不应堆积设备记录。
  // BLOCK-88 P1（D2）：body.identity additive——联邦指挥席配对时声明的工程师
  // 身份（displayName/device）经净化落会话；声明身份仅展示、未经验证（D1-A）。
  app.post('/m/api/pair', (req, res) => {
    const token = String(req.body?.token || '');
    const redeemed = stores.pairing.redeem(token);
    if (!redeemed) {
      res.status(401).json({ ok: false, error: 'pair_token_invalid', message: '配对码无效或已过期，请在桌面端重新生成' });
      return;
    }
    const identity = sanitizeEngineerIdentity(req.body?.identity);
    const existingToken = readCookieToken(req) || bearerToken(req);
    const existingSession = existingToken ? stores.sessions.authenticate(existingToken) : null;
    if (existingSession) {
      res.json({ ok: true, sessionId: existingSession.id, sessionToken: existingToken, reused: true });
      return;
    }
    const userAgent = String(req.headers['user-agent'] || '');
    // 指挥席 fetch 无 UA（UA 推导恒命中「移动设备」兜底）——带署名时优先以
    // 署名命名会话，「我的设备」列表与协作成员面语义一致（评审 P2 清偿）。
    const uaName = /iphone|ipad/i.test(userAgent) ? 'iOS 设备'
      : /android/i.test(userAgent) ? 'Android 设备'
        : '移动设备';
    const baseName = (identity && identity.displayName) || uaName;
    const { sessionId, sessionToken } = stores.sessions.createSession({ name: `${baseName}-${pairShortId()}`, identity });
    res.json({ ok: true, sessionId, sessionToken, identity: identity || null });
  });

  // 会话鉴权：token 来源优先级 = gw_session cookie（桌面投影 SPA 同源自动携带，
  // 其 Bearer 是无会话语义的 'desktop-local' 常量）> Bearer 头 / ?session=
  // （EventSource 与外部 API 客户端）。
  function readCookieToken(req) {
    return String((req.headers.cookie || '')
      .split(/;\s*/)
      .find((pair) => pair.startsWith('gw_session='))
      ?.split('=').slice(1).join('=') || '');
  }

  function bearerToken(req) {
    const header = String(req.headers.authorization || '');
    return header.startsWith('Bearer ') ? header.slice(7) : '';
  }

  function sessionAuth(req, res, next) {
    const token = readCookieToken(req) || bearerToken(req) || String(req.query.session || '');
    const session = stores.sessions.authenticate(token);
    if (!session) {
      res.status(401).json({ ok: false, error: 'session_invalid', message: '会话无效或已被吊销' });
      return;
    }
    req.mobileSession = { id: session.id, name: session.name, identity: session.identity || null };
    // 与桌面完全相同的身份对象（auth.js LOCAL_USER）——路由按 user_id 过滤的
    // 数据面才可能与桌面同源同门（id 必须一字不差，'local-user'）。
    req.user = require('../auth').LOCAL_USER;
    next();
  }

  function issueSessionCookie(res, sessionToken) {
    res.setHeader('Set-Cookie', `gw_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_COOKIE_MAX_AGE}`);
  }

  app.get('/m/api/health', (_req, res) => {
    res.json({ ok: true, service: 'gewu-mobile-gateway' });
  });

  // ── UI-357 桌面投影（用户裁决「整个软件桌面原封不动的过来」）────────
  // /app?token=<一次性配对码> → 服务端兑换会话 + 下发 cookie → 302 /app/。
  // SPA 静态服务 + index.html 注入 window.biof3Desktop 身份/后端垫片；
  // /api/* 走全量路由注册表（sessionAuth 会话门内）——手机获得与桌面
  // 同源同门的完整 API。Electron 专属能力（终端/窗口控制等）经 Proxy 垫片
  // 诚实降级为 no-op。
  const desktopDist = path.join(__dirname, '..', '..', '..', 'frontend', 'dist');
  const desktopIndex = path.join(desktopDist, 'index.html');
  const desktopAvailable = () => fs.existsSync(desktopIndex);
  console.log(`[mobile-gateway] desktop projection: dist=${desktopDist} available=${desktopAvailable()}`);

  app.get('/pair', (req, res) => {
    if (!desktopAvailable()) {
      res.status(501).send('desktop projection unavailable: frontend/dist not built (npm run build:spa)');
      return;
    }
    const token = String(req.query.token || '');
    const redeemed = token ? stores.pairing.redeem(token) : null;
    if (redeemed) {
      // 加映 4：已有有效会话直接复用（刷新长效 cookie），不再每次扫码新建——
      // 同一手机重复扫码/重开配对链接不应堆积设备记录。
      const existingToken = readCookieToken(req) || bearerToken(req);
      const existingSession = existingToken ? stores.sessions.authenticate(existingToken) : null;
      if (existingSession) {
        issueSessionCookie(res, existingToken);
      } else {
        const { sessionToken } = stores.sessions.createSession({ name: `桌面投影-${pairShortId()}` });
        issueSessionCookie(res, sessionToken);
      }
    }
    const hasCookie = String(req.headers.cookie || '').includes('gw_session=');
    if (!redeemed && !hasCookie) {
      res.redirect('/m');
      return;
    }
    res.redirect('/');
  });

  // 会话鉴权：公开面（静态页 / 配对 / 健康 / app 兑换入口）之外的一切端点
  // ——包括挂载的全量 /api/* 路由——都必须持有效会话（D4）。
  app.use(sessionAuth);

  // ── BLOCK-85 格物联邦（D1/D3）：对端格物经此端点握手本机节点能力 ──
  // 会话门内（配对后才能读）；指挥席用兑换到的会话 Bearer 调用。
  // BLOCK-88 P1：回显本会话落档的工程师声明身份——指挥席可断言对端记录的
  // 署名与自己所发一致（契约面），被访端面板「协作成员」同源读取。
  const os = require('node:os');
  app.get('/federation/api/health', (req, res) => {
    let executors = { r: false, python: false };
    try {
      const { getExecutor } = require('../../shared-backend/executors');
      for (const lang of ['r', 'python']) {
        const executor = getExecutor(lang);
        executors[lang] = Boolean(executor && executor.binPath && fs.existsSync(executor.binPath));
      }
    } catch { /* 执行器探测失败诚实报 false */ }
    res.json({
      ok: true,
      service: 'gewu-federation',
      protocol: 1,
      node: {
        name: os.hostname(),
        platform: process.platform,
        arch: process.arch,
      },
      gewuVersion: process.env.npm_package_version || '0.0.1-rc.7',
      executors,
      session: {
        name: req.mobileSession?.name || null,
        identity: req.mobileSession?.identity || null,
      },
    });
  });

  // ── BLOCK-88 P3（D4）：访客列自己的被授权项目（「A 能看到 B 的哪些项目」）──
  // 会话门内；身份键=本会话 P1 落档的工程师声明署名；附项目名供 delegate 选参。
  const grantsMod = require('../../shared-backend/federation-grants');
  app.get('/federation/api/granted-projects', (req, res) => {
    const identity = req.mobileSession?.identity;
    if (!identity || !identity.displayName) {
      res.json({ ok: true, projects: [], note: 'session_without_engineer_identity' });
      return;
    }
    const grants = grantsMod.grantedProjectsFor(dataDir, identity.displayName);
    let projects = grants;
    try {
      const db = require('../db').getDatabase();
      const names = new Map(db.prepare('SELECT id, name FROM projects').all().map((r) => [r.id, r.name]));
      projects = grants.map((g) => ({ projectId: g.projectId, projectName: names.get(g.projectId) || null }));
    } catch { /* 项目名附不上时诚实降级为纯 id */ }
    res.json({ ok: true, engineer: identity.displayName, projects });
  });

  // ── BLOCK-85 P4 投影终端（node-pty 会话 + SSE 下行 / POST 上行）──
  // 会话门内；会话驻留 core 进程，手机锁屏断流回来可重连重放（环形缓冲）。
  const terminalEngine = require('../federation-terminal').createTerminalEngine();

  app.get('/m/api/terminal', (_req, res) => {
    if (!terminalEngine.available) {
      res.status(501).json({ ok: false, error: 'terminal_unavailable', message: terminalEngine.reason });
      return;
    }
    res.json({ ok: true, sessions: terminalEngine.list() });
  });

  app.post('/m/api/terminal/start', express.json({ limit: '8kb' }), (req, res) => {
    if (!terminalEngine.available) {
      res.status(501).json({ ok: false, error: 'terminal_unavailable', message: terminalEngine.reason });
      return;
    }
    const result = terminalEngine.start({ cwd: req.body?.cwd, ssh: req.body?.ssh });
    res.status(result.error ? 400 : 200).json({ ok: !result.error, ...result });
  });

  app.post('/m/api/terminal/:id/input', express.json({ limit: '64kb' }), (req, res) => {
    const session = terminalEngine.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ ok: false, error: 'session_not_found' });
      return;
    }
    const data = req.body?.data;
    if (typeof data !== 'string') {
      res.status(400).json({ ok: false, error: 'data_required' });
      return;
    }
    res.json(terminalEngine.write(session, data));
  });

  app.post('/m/api/terminal/:id/resize', express.json({ limit: '2kb' }), (req, res) => {
    const session = terminalEngine.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ ok: false, error: 'session_not_found' });
      return;
    }
    res.json(terminalEngine.resize(session, req.body?.cols, req.body?.rows));
  });

  app.post('/m/api/terminal/:id/kill', (req, res) => {
    const session = terminalEngine.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ ok: false, error: 'session_not_found' });
      return;
    }
    res.json(terminalEngine.kill(session));
  });

  // SSE 下行：连接即重放环形缓冲，此后实时推送；terminal:exit 后保留至 TTL。
  app.get('/m/api/terminal/:id/stream', (req, res) => {
    const session = terminalEngine.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ ok: false, error: 'session_not_found' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders && res.flushHeaders();
    const send = (event, payload) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    const replay = terminalEngine.ringText(session);
    if (replay) send('terminal:replay', { data: replay, exited: session.exited });
    const unsubscribe = terminalEngine.subscribe(session, send);
    if (session.exited) send('terminal:exit', { exitCode: session.exitCode });
    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* closed */ }
    }, 15_000);
    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  // P2 控制面窄口：批准决定（进程内直调 db.ackToolJob，权限不放大）。
  require('./control').registerMobileControl(app);

  // 既有读面/控制路由模块注入（conversations / agent tasks / SSE / tools）。
  if (typeof mountRoutes === 'function') {
    mountRoutes(app);
  }

  // 桌面投影：全量路由注册表（异步注册，落在 sessionAuth 之后=会话门内）
  // + SPA 静态服务 + 客户端路由 fallback + 身份/后端垫片注入。
  if (desktopAvailable()) {
    try { require('../routes')(app); } catch (e) {
      console.warn('[mobile-gateway] full route registry failed:', e && e.message);
    }
    const shimArr = [
      '<script>window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String(e&&e.message||e))});</script>',
      '<script>document.documentElement.setAttribute("data-projection","1");</script>',
      '<script>(function(){',
      '  var base={backendConfig:{rApiBase:"/api"},isDesktop:true,platform:"win32",__projection:true};',
      '  var mk=function(){var f=function(){return p;};var p=new Proxy(f,{get:function(t,k){if(k===Symbol.toPrimitive){return function(){return "";};}if(k==="then"){return function(res,rej){return Promise.resolve(undefined).then(res,rej);};}return p;},apply:function(){return p;}});return p;};',
      '  window.biof3Desktop=new Proxy(base,{get:function(t,k){if(k in t){return t[k];}return mk();}});',
      '})();</script>',
    ];
    const shim = shimArr.join('');
    // 每次请求读盘注入（index.html 仅数 KB）：dist 重建后投影即时生效——
    // 曾因启动时一次性缓存旧 index.html，引用已删除的旧 hash 资产 → 手机
    // 投影停留在旧界面/白屏（BLOCK-85 双真机实测抓真）。
    const sendIndex = (res) => {
      try {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        const injected = readFileSync(desktopIndex, 'utf8').replace('<head>', '<head>' + shim);
        res.type('html').send(injected);
      } catch {
        res.status(404).send('dist index missing (npm run build:spa)');
      }
    };
    // dist 哈希资产内容寻址：永久缓存（Vite 不可达落 dist 时刷新不再全量重拉）
    app.use(express.static(desktopDist, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }));
    // BLOCK-87 — dev 模式投影走 Vite 热更源（源码改动手机即时跟随，无需手动
    // build:spa；生产/无 Vite 时走 dist）。窄代理：只接管 /（首页 HTML，注垫片）
    // 与 Vite 专有路径（/@、/node_modules/、/src/）；/assets 构建产物不误代理。
    // BLOCK-87 实测性能修复（用户「点击频繁时刷新很慢」）：①条件请求透传——
    // 原实现对所有代理响应强制 no-store，手机每次刷新都全量重拉整张模块图
    // （数百模块 × 隧道 RTT）；现透传 If-None-Match/If-Modified-Since 让 Vite
    // 的 ETag 304 生效，未变更模块只回 tiny 304。②文本模块 gzip——隧道流量
    // 降 ~70%。HTML 仍 no-store（垫片注入必须即时新鲜）。
    const viteDevBase = process.env.BIOF3_RENDERER_DEV_URL || 'http://127.0.0.1:3000';
    const isViteOwnedPath = (p) => p === '/' || p.startsWith('/@') || p.startsWith('/node_modules/') || p.startsWith('/src/');
    const acceptsGzip = (req) => String(req.headers['accept-encoding'] || '').includes('gzip');
    const isTextLike = (contentType) => /text\/|application\/(javascript|json|xml|wasm)/.test(contentType);
    app.get('*', async (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/m') || req.path === '/pair') return next();
      if (!isViteOwnedPath(req.path)) return next();
      try {
        const conditional = {};
        if (req.headers['if-none-match']) conditional['If-None-Match'] = req.headers['if-none-match'];
        if (req.headers['if-modified-since']) conditional['If-Modified-Since'] = req.headers['if-modified-since'];
        const upstream = await fetch(viteDevBase + req.originalUrl, {
          headers: { Accept: req.headers.accept || '*/*', ...conditional },
          signal: AbortSignal.timeout(8000),
        });
        const contentType = upstream.headers.get('content-type') || '';
        if (upstream.status === 304) {
          res.setHeader('Cache-Control', 'no-cache');
          const etag = upstream.headers.get('etag');
          if (etag) res.setHeader('ETag', etag);
          res.status(304).end();
          return;
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.setHeader('Content-Type', contentType);
        if (contentType.includes('text/html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store');
          res.status(upstream.status).send(buf.toString('utf8').replace('<head>', '<head>' + shim));
          return;
        }
        res.setHeader('Cache-Control', upstream.headers.get('cache-control') || 'no-cache');
        const etag = upstream.headers.get('etag');
        if (etag) res.setHeader('ETag', etag);
        if (acceptsGzip(req) && isTextLike(contentType) && buf.length > 1024) {
          const gz = zlib.gzipSync(buf);
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Content-Length', String(gz.length));
          res.status(upstream.status).end(gz);
          return;
        }
        res.status(upstream.status).send(buf);
        return;
      } catch { /* Vite 不可达 → 落回 dist */ }
      next();
    });
    // SPA 客户端路由 fallback：非 /api、/m、/pair 的 GET 一律回 index.html
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/m') || req.path === '/pair') return next();
      sendIndex(res);
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    res.status(500).json({ ok: false, error: 'mobile_gateway_error', message: '移动网关内部错误' });
  });

  return { app, stores, audit, desktopAvailable };
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
