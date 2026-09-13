import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { getStores, resetStoresForTest, createPairingStore, createSessionStore, PAIR_TOKEN_TTL_MS } = require(path.join(ROOT, 'core/biof3-server/mobile-gateway/pairing.js'));
const { readConfig, writeConfig, lanAddresses, resolveEnabled, resolvePort } = require(path.join(ROOT, 'core/biof3-server/mobile-gateway/config.js'));
const { buildMobileGateway, startMobileGateway } = require(path.join(ROOT, 'core/biof3-server/mobile-gateway/index.js'));

function tmpRoot() {
  return mkdtempSync(path.join(tmpdir(), 'gewu-mobile-test-'));
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** 关服并掐断 keep-alive 连接（fetch 的 undici 连接会挂住 close()）。 */
function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

async function body(response) {
  return response.json();
}

// ── 配对 token：单次使用 / TTL / 无效 ────────────────────────────────────

test('BLOCK-70 pairing token redeems exactly once and expires', () => {
  let clock = 1_000_000;
  const store = createPairingStore({ now: () => clock });
  const { token, expiresAt } = store.issue();
  assert.equal(expiresAt, clock + PAIR_TOKEN_TTL_MS);
  assert.equal(store.redeem('not-a-token'), null);
  assert.deepEqual(store.redeem(token), { used: true });
  assert.equal(store.redeem(token), null, 'second redeem of the same token must fail');
  const lateToken = store.issue().token;
  clock += PAIR_TOKEN_TTL_MS + 1;
  assert.equal(store.redeem(lateToken), null, 'expired token must not redeem');
});

// ── 会话存储：哈希落盘 / 吊销即时失效 / 持久化 ───────────────────────────

test('BLOCK-70 sessions persist hashed tokens, authenticate and revoke', () => {
  const root = tmpRoot();
  try {
    const store = createSessionStore({ dataDir: root });
    const { sessionId, sessionToken } = store.createSession({ name: 'iPhone' });
    assert.ok(sessionToken.length >= 64);
    assert.deepEqual(store.authenticate('bogus'), null);
    const session = store.authenticate(sessionToken);
    assert.equal(session.id, sessionId);

    const raw = readFileSync(store.sessionsPath, 'utf8');
    assert.ok(!raw.includes(sessionToken), 'session token must never be stored in plaintext');
    assert.ok(raw.includes('tokenHash'));

    assert.equal(store.revoke(sessionId), true);
    assert.equal(store.authenticate(sessionToken), null, 'revoked session must stop authenticating immediately');

    const reloaded = createSessionStore({ dataDir: root });
    assert.equal(reloaded.authenticate(sessionToken), null, 'revocation must survive reload');
    assert.equal(reloaded.list().length, 1);
    assert.deepEqual(Object.keys(reloaded.list()[0]).sort(), ['createdAt', 'id', 'lastSeenAt', 'name', 'revoked']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── 配置：默认关闭 / 写入 / env 覆盖 ────────────────────────────────────

test('BLOCK-70 gateway config defaults to off and round-trips writes', () => {
  const root = tmpRoot();
  try {
    assert.deepEqual(readConfig(root), { enabled: false, port: 3005, bind: '0.0.0.0' });
    assert.equal(resolveEnabled({ dataDir: root, env: {} }), false, 'must default to disabled');
    assert.equal(resolveEnabled({ dataDir: root, env: { BIOF3_MOBILE_ENABLED: '1' } }), true, 'env override enables');
    const next = writeConfig(root, { enabled: true, port: 3007 });
    assert.deepEqual(next, { enabled: true, port: 3007, bind: '0.0.0.0' });
    assert.deepEqual(readConfig(root), next);
    assert.equal(resolvePort({ dataDir: root, env: {} }), 3007);
    assert.equal(resolvePort({ dataDir: root, env: { BIOF3_MOBILE_PORT: '3010' } }), 3010);
    writeConfig(root, { port: 99999 });
    assert.equal(readConfig(root).port, 3007, 'out-of-range port must be ignored');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('BLOCK-70 lanAddresses returns strings and never the loopback', () => {
  for (const address of lanAddresses()) {
    assert.equal(typeof address, 'string');
    assert.notEqual(address, '127.0.0.1', 'LAN list must not contain the loopback');
  }
});

// ── gateway 集成（真实回环 HTTP）───────────────────────────────────────

test('BLOCK-70 gateway: static page, pairing, session auth, revocation, audit', async () => {
  const root = tmpRoot();
  resetStoresForTest();
  try {
    const { app, stores } = buildMobileGateway({
      dataDir: root,
      mountRoutes: (mobileApp) => {
        mobileApp.get('/m/api/probe', (req, res) => {
          res.json({ ok: true, session: req.mobileSession, user: req.user.id });
        });
      },
    });
    const server = await listen(app);
    const base = `http://127.0.0.1:${server.address().port}`;

    // 静态移动页可达
    const page = await fetch(`${base}/m/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Gewu · 移动工作区/);

    // 未配对：/m/api/* 一律 401
    assert.equal((await fetch(`${base}/m/api/probe`)).status, 401);
    assert.equal((await fetch(`${base}/m/api/probe`, { headers: { Authorization: 'Bearer forged' } })).status, 401);

    // 配对：一次性 token → 会话
    const { token } = stores.pairing.issue();
    const pairRes = await body(await fetch(`${base}/m/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }));
    assert.equal(pairRes.ok, true);
    assert.ok(pairRes.sessionToken);

    // 坏 token 拒绝（含已被消费的同一 token）
    const badPair = await fetch(`${base}/m/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    assert.equal(badPair.status, 401, 'one-time token must not pair twice');

    // 授权访问：header 与 ?session= 双通道（EventSource 场景）
    const probe = await body(await fetch(`${base}/m/api/probe`, { headers: { Authorization: `Bearer ${pairRes.sessionToken}` } }));
    assert.equal(probe.ok, true);
    assert.equal(probe.user, 'local-user', 'session identity must be the real LOCAL_USER');
    const probeQuery = await body(await fetch(`${base}/m/api/probe?session=${encodeURIComponent(pairRes.sessionToken)}`));
    assert.equal(probeQuery.ok, true);

    // 吊销即刻失效
    assert.equal(stores.sessions.revoke(pairRes.sessionId), true);
    assert.equal((await fetch(`${base}/m/api/probe`, { headers: { Authorization: `Bearer ${pairRes.sessionToken}` } })).status, 401);

    // 审计日志落盘且不含 query 串（D9：只记元数据）
    const auditPath = path.join(root, 'mobile', 'audit.log');
    assert.ok(existsSync(auditPath));
    const auditRaw = readFileSync(auditPath, 'utf8');
    assert.match(auditRaw, /"path":"\/m\/api\/probe"/);
    assert.ok(!auditRaw.includes(encodeURIComponent(pairRes.sessionToken)), 'audit must not record session tokens');

    await closeServer(server);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('BLOCK-70 gateway rate limit returns 429 and never crashes the app', async () => {
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
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await fetch(`${base}/m/api/health`)).status);
    }
    assert.deepEqual(statuses.slice(0, 3), [200, 200, 200]);
    assert.equal(statuses[4], 429, 'requests beyond the window budget must be limited');
    await closeServer(server);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('BLOCK-70 startMobileGateway stays off unless enabled (additive red line)', async () => {
  const root = tmpRoot();
  resetStoresForTest();
  try {
    const off = startMobileGateway({ dataDir: root, env: {} });
    assert.deepEqual(off, { started: false, reason: 'disabled' });
    const enabled = startMobileGateway({
      dataDir: root,
      env: { BIOF3_MOBILE_ENABLED: '1', BIOF3_MOBILE_PORT: String(39100 + Math.floor(Math.random() * 400)) },
      mountRoutes: (mobileApp) => {
        mobileApp.get('/m/api/probe', (_req, res) => res.json({ ok: true }));
      },
    });
    assert.equal(enabled.started, true);
    assert.equal(typeof enabled.close, 'function');
    await closeServer(enabled.server);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('BLOCK-70 admin REST and gateway share one session truth (revoke is instant)', async () => {  const root = tmpRoot();
  resetStoresForTest();
  try {
    const express = require('express');
    const adminApp = express();
    adminApp.use(express.json({ limit: '4kb' }));
    require(path.join(ROOT, 'core/biof3-server/routes/mobile-admin.js'))(adminApp, { dataDir: root });
    const adminServer = await listen(adminApp);
    const adminBase = `http://127.0.0.1:${adminServer.address().port}`;

    const statusBefore = await body(await fetch(`${adminBase}/api/mobile/status`));
    assert.equal(statusBefore.ok, true);
    assert.equal(statusBefore.enabled, false);
    assert.equal(statusBefore.activeDevices, 0);

    const pairToken = await body(await fetch(`${adminBase}/api/mobile/pairing/token`, { method: 'POST' }));
    assert.equal(pairToken.ok, true);
    assert.match(pairToken.primaryUrl, /\/pair\?token=/);

    const { app, stores } = buildMobileGateway({ dataDir: root, mountRoutes: (mobileApp) => mobileApp.get('/m/api/probe', (_req, res) => res.json({ ok: true })) });
    const server = await listen(app);
    const base = `http://127.0.0.1:${server.address().port}`;
    const paired = await body(await fetch(`${base}/m/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pairToken.token }),
    }));
    assert.equal(paired.ok, true);

    const statusAfter = await body(await fetch(`${adminBase}/api/mobile/status`));
    assert.equal(statusAfter.activeDevices, 1, 'admin status must see gateway-created devices');

    const revoke = await body(await fetch(`${adminBase}/api/mobile/devices/${paired.sessionId}/revoke`, { method: 'POST' }));
    assert.equal(revoke.ok, true);
    assert.equal((await fetch(`${base}/m/api/probe`, { headers: { Authorization: `Bearer ${paired.sessionToken}` } })).status, 401, 'admin revoke must cut the mobile session immediately');

    await closeServer(server);
    await closeServer(adminServer);
  } finally {
    resetStoresForTest();
    rmSync(root, { recursive: true, force: true });
  }
});

// ── P2 控制面：批准决定窄口（db 全链归实机探针，此处只验请求形状与鉴权）──

test('BLOCK-70 P2 approvals decide: session required, scope keys required', async () => {
  const root = tmpRoot();
  resetStoresForTest();
  try {
    const { app, stores } = buildMobileGateway({
      dataDir: root,
      mountRoutes: (mobileApp) => { mobileApp.get('/m/api/probe', (_req, res) => res.json({ ok: true })); },
    });
    const server = await listen(app);
    const base = `http://127.0.0.1:${server.address().port}`;

    // 无会话 401（sessionAuth 覆盖控制窄口）
    assert.equal((await fetch(`${base}/m/api/approvals/some-token/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approve: true, projectId: null, conversationId: null }),
    })).status, 401);

    const { sessionToken } = stores.sessions.createSession({ name: 'test' });
    const auth = { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' };

    // 缺 scope 键 → 400（与桌面 REST 同契约；该校验先于任何 db 触碰）
    const noScope = await fetch(`${base}/m/api/approvals/some-token/decide`, {
      method: 'POST', headers: auth, body: JSON.stringify({ approve: true }),
    });
    assert.equal(noScope.status, 400);
    assert.deepEqual(await body(noScope), { ok: false, error: 'approval_scope_required', message: '缺少批准范围（projectId/conversationId）' });

    await closeServer(server);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('BLOCK-70 P2 mobile page ships control face (approval/cancel/composer markers)', async () => {
  const root = tmpRoot();
  resetStoresForTest();
  try {
    const { app } = buildMobileGateway({ dataDir: root, mountRoutes: () => {} });
    const server = await listen(app);
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await (await fetch(`${base}/m/`)).text();
    assert.ok(page.includes('/m/api/approvals/'), 'approval decide endpoint must be wired');
    assert.ok(page.includes('再点一次确认'), 'two-step confirm (D4) must be present');
    assert.ok(page.includes('/api/ai/agent/task/'), 'task stream/cancel wiring must be present');
    assert.ok(page.includes("'/api/ai/agent'"), 'composer send must hit the agent endpoint');
    await closeServer(server);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
