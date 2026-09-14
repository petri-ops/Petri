import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { buildMobileGateway } = require(path.join(ROOT, 'core/biof3-server/mobile-gateway/index.js'));
const { resetStoresForTest, createSessionStore } = require(path.join(ROOT, 'core/biof3-server/mobile-gateway/pairing.js'));
const registerProjectionDataRoutes = require(path.join(ROOT, 'core/biof3-server/routes/projection-data.js'));

function tmpRoot() {
  return mkdtempSync(path.join(tmpdir(), 'gewu-projection-l42-'));
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

// ── BLOCK-87 L4-2：限速只计 API 面（静态/页面资产不消耗配额）──────────────
// 用户实测：手机投影「总是 rate_limited」——原实现把静态资源、Vite 热更模块
// 与 API 一起计数，投影 SPA 冷启动数百请求直接打满 240/分。
test('BLOCK-87 gateway rate limit counts API paths only', async () => {
  const root = tmpRoot();
  resetStoresForTest();
  try {
    const { app } = buildMobileGateway({
      dataDir: root,
      rateLimit: { windowMs: 60_000, max: 3 },
      mountRoutes: (mobileApp) => {
        mobileApp.get('/m/api/probe', (_req, res) => res.json({ ok: true }));
      },
    });
    const server = await listen(app);
    const base = `http://127.0.0.1:${server.address().port}`;

    const pair = async () => (await fetch(`${base}/m/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'bogus' }),
    })).status;

    // API 面：3 次后限速（401=配对失败仍在计数，第 4 次 429）
    assert.equal(await pair(), 401);
    assert.equal(await pair(), 401);
    assert.equal(await pair(), 401);
    assert.equal(await pair(), 429, 'API requests must be rate limited after max');
    assert.equal((await fetch(`${base}/m/api/probe`)).status, 429);

    // 非 API 面：同一 IP 已超限，静态页与页面路由仍可达（不受配额影响）
    for (let i = 0; i < 8; i += 1) {
      const res = await fetch(`${base}/m/`);
      assert.notEqual(res.status, 429, `static page request ${i} must not be rate limited`);
      assert.equal(res.status, 200);
    }

    await closeServer(server);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── BLOCK-87 L4-2：投影数据端点（插件目录/运行时/领域包）──────────────────
test('BLOCK-87 projection data: catalog, runtime status, packs read plane', async () => {
  const sandbox = tmpRoot();
  const prevDataDir = process.env.BIOF3_LOCAL_DATA_DIR;
  const prevProjectRoot = process.env.BIOF3_PROJECT_ROOT;
  try {
    // 沙盒布局：<sandbox>/proj/biof3-desktop（BIOF3_PROJECT_ROOT，资源/发现根）
    //          <sandbox>/proj/gewu-pack-bio（projectRoot 的兄弟仓发现位）
    //          <sandbox>/data（dataDir）
    const projectRoot = path.join(sandbox, 'proj', 'biof3-desktop');
    const dataDir = path.join(sandbox, 'data');
    mkdirSync(path.join(projectRoot, 'resources', 'runtime'), { recursive: true });
    writeFileSync(
      path.join(projectRoot, 'resources', 'runtime', 'manifest.json'),
      JSON.stringify({ version: '2.0.0', plugins: { 'biof3-r-runtime': { id: 'biof3-r-runtime', type: 'runtime', title: 'R 运行时' } } }),
    );
    const packRoot = path.join(sandbox, 'proj', 'gewu-pack-bio');
    mkdirSync(path.join(packRoot, 'plugins'), { recursive: true });
    writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({ packId: 'gewu-pack-bio', name: '格物 · 生信分析包', version: '0.1.0', description: 'bio pack' }));
    writeFileSync(path.join(packRoot, 'plugins', 'installed.json'), '[]');
    mkdirSync(path.join(dataDir, 'packs'), { recursive: true });
    writeFileSync(
      path.join(dataDir, 'packs', 'installed.json'),
      JSON.stringify([{ packId: 'gewu-pack-bio', packRoot, version: '0.1.0', installedAt: '2026-09-14T00:00:00.000Z' }]),
    );

    process.env.BIOF3_LOCAL_DATA_DIR = dataDir;
    process.env.BIOF3_PROJECT_ROOT = projectRoot;

    const express = require('express');
    const app = express();
    registerProjectionDataRoutes(app);
    const server = await listen(app);
    const base = `http://127.0.0.1:${server.address().port}`;
    const getJson = async (p) => (await fetch(`${base}${p}`)).json();

    // 目录：与桌面 getBuiltInManifest 同一文件语义
    const catalog = await getJson('/api/plugins/catalog');
    assert.equal(catalog.ok, true);
    assert.ok(catalog.manifest.plugins['biof3-r-runtime']);
    assert.equal(catalog.manifest.plugins['biof3-r-runtime'].type, 'runtime');

    // 运行时状态：测试进程未注册执行器 → 诚实全 false（形状契约）
    const runtime = await getJson('/api/runtime/status');
    assert.equal(runtime.ok, true);
    assert.deepEqual(runtime.runtime, {
      r: { installed: false, path: null },
      python: { installed: false, path: null },
    });

    // 领域包：安装记录 + 兄弟仓发现（已装标记）
    const installed = await getJson('/api/packs/installed');
    assert.equal(installed.ok, true);
    assert.equal(installed.packs.length, 1);
    assert.equal(installed.packs[0].packId, 'gewu-pack-bio');
    const available = await getJson('/api/packs/available');
    assert.equal(available.ok, true);
    assert.equal(available.packs.length, 1);
    assert.equal(available.packs[0].installed, true, 'sibling pack must be flagged installed');

    await closeServer(server);
  } finally {
    if (prevDataDir === undefined) delete process.env.BIOF3_LOCAL_DATA_DIR;
    else process.env.BIOF3_LOCAL_DATA_DIR = prevDataDir;
    if (prevProjectRoot === undefined) delete process.env.BIOF3_PROJECT_ROOT;
    else process.env.BIOF3_PROJECT_ROOT = prevProjectRoot;
    rmSync(sandbox, { recursive: true, force: true });
  }
});

// ── BLOCK-87 L4-2：投影端点挂进 gateway 必须落会话门内 ────────────────────
test('BLOCK-87 projection data routes sit behind the gateway session gate', async () => {
  const root = tmpRoot();
  resetStoresForTest();
  try {
    const { app, stores } = buildMobileGateway({
      dataDir: root,
      mountRoutes: (mobileApp) => {
        registerProjectionDataRoutes(mobileApp);
      },
    });
    const server = await listen(app);
    const base = `http://127.0.0.1:${server.address().port}`;

    // 无会话：一律 401（投影数据面不外泄）
    for (const p of ['/api/plugins/catalog', '/api/runtime/status', '/api/packs/installed', '/api/packs/available']) {
      assert.equal((await fetch(`${base}${p}`)).status, 401, `${p} must require a session`);
    }

    // 有会话：可达
    const { sessionToken } = stores.sessions.createSession({ name: 'probe' });
    const res = await fetch(`${base}/api/packs/installed`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    await closeServer(server);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── BLOCK-87 性能修复：会话落盘节流（用户实测「点击频繁时刷新很慢」根因）
// authenticate 原来每请求全量 persist()——模块/资产也过会话门，一次页面加载
// 数百请求 × 全量序列化双同步写盘，网关事件循环被磁盘刷满。
test('BLOCK-87 session store throttles persist on authenticate (lastSeenAt)', async () => {
  const root = tmpRoot();
  try {
    const store = createSessionStore({ dataDir: root, persistDebounceMs: 25 });
    const { sessionToken } = store.createSession({ name: 'throttle-probe' });
    const file = () => readFileSync(store.sessionsPath, 'utf8');
    const before = file();

    // 多次 authenticate：内存即时更新，但磁盘在 debounce 窗口内不写
    for (let i = 0; i < 5; i += 1) {
      assert.ok(store.authenticate(sessionToken));
    }
    assert.equal(file(), before, 'authenticate must not hit disk within the debounce window');

    // debounce 到期后合并落盘（lastSeenAt 更新最终可见）
    await new Promise((resolve) => setTimeout(resolve, 120));
    const after = file();
    assert.ok(JSON.parse(after).sessions[0].lastSeenAt >= JSON.parse(before).sessions[0].lastSeenAt);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── BLOCK-87 性能修复：Vite 代理条件请求透传（304 重验证）+ 文本模块 gzip ──
// 原实现对代理响应强制 no-store——手机每次刷新全量重拉整张模块图 × 隧道 RTT。
test('BLOCK-87 gateway proxies Vite modules with 304 revalidation and gzip', async (t) => {
  const distIndex = path.join(ROOT, 'frontend', 'dist', 'index.html');
  if (!existsSync(distIndex)) {
    t.skip('frontend/dist not built — desktop projection proxy block not registered');
    return;
  }
  const root = tmpRoot();
  resetStoresForTest();
  const upstreamHits = [];
  const MODULE_BODY = `export const x = ${JSON.stringify('y'.repeat(4096))};\n`;
  const upstream = http.createServer((req, res) => {
    upstreamHits.push({ inm: req.headers['if-none-match'] || null });
    if (req.headers['if-none-match'] === '"mod-v1"') {
      res.writeHead(304, { ETag: '"mod-v1"' });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', ETag: '"mod-v1"' });
    res.end(MODULE_BODY);
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  const prevRenderer = process.env.BIOF3_RENDERER_DEV_URL;
  process.env.BIOF3_RENDERER_DEV_URL = upstreamUrl;
  try {
    const { app, stores } = buildMobileGateway({ dataDir: root });
    const server = await listen(app);
    const base = `http://127.0.0.1:${server.address().port}`;
    const { sessionToken } = stores.sessions.createSession({ name: 'perf-probe' });
    const auth = { Authorization: `Bearer ${sessionToken}`, 'Accept-Encoding': 'gzip' };

    // 首拉：200 + gzip 头（文本模块 >1KB）+ 不再强制 no-store。
    // 注：undici fetch 对 Content-Encoding: gzip 透明解码，body 比较用原文。
    const first = await fetch(`${base}/src/mod.js`, { headers: auth });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('content-encoding'), 'gzip', 'text module must be gzipped');
    assert.ok(first.headers.get('cache-control') !== 'no-cache, no-store', 'modules must not be forced no-store');
    assert.equal(await first.text(), MODULE_BODY);

    // 条件再拉：If-None-Match 透传给上游 → 304 透传回客户端
    const second = await fetch(`${base}/src/mod.js`, { headers: { ...auth, 'If-None-Match': '"mod-v1"' } });
    assert.equal(second.status, 304, 'conditional revalidation must pass through as 304');
    assert.equal(upstreamHits.at(-1).inm, '"mod-v1"', 'If-None-Match must be forwarded to upstream');

    await closeServer(server);
  } finally {
    if (prevRenderer === undefined) delete process.env.BIOF3_RENDERER_DEV_URL;
    else process.env.BIOF3_RENDERER_DEV_URL = prevRenderer;
    upstream.closeAllConnections?.();
    upstream.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// ── BLOCK-87 性能修复：dist 哈希资产不可变缓存 ───────────────────────────
test('BLOCK-87 dist hashed assets are served immutable', async (t) => {
  const distDir = path.join(ROOT, 'frontend', 'dist', 'assets');
  if (!existsSync(distDir)) {
    t.skip('frontend/dist/assets not built');
    return;
  }
  const root = tmpRoot();
  resetStoresForTest();
  try {
    const { app, stores } = buildMobileGateway({ dataDir: root });
    const server = await listen(app);
    const base = `http://127.0.0.1:${server.address().port}`;
    const { sessionToken } = stores.sessions.createSession({ name: 'asset-probe' });
    const asset = readdirSync(distDir).find((f) => f.endsWith('.js')) || readdirSync(distDir)[0];
    const res = await fetch(`${base}/assets/${asset}`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    assert.ok([200, 304].includes(res.status));
    assert.match(res.headers.get('cache-control') || '', /immutable/, 'hashed assets must be immutable');
    await closeServer(server);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
