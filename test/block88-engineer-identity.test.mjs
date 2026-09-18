/**
 * BLOCK-88 P1 — 工程师声明身份契约测试（身份层贯通）。
 *
 * 覆盖（对端 = 真实 mobile-gateway 实例；指挥席 = 真实 federation-admin REST）：
 * 1. sanitizeEngineerIdentity：控制字符剥离 / 截断 / 非对象与空净化 → null
 * 2. 会话存储：identity 只在声明时落键（存量手机会话投影键集不变）
 * 3. 配对握手：POST /m/api/pair 声明 identity → 会话落档；/federation/api/health
 *    回显本会话身份（指挥席契约断言面）
 * 4. 端到端：指挥席带署名配对 → 对端会话收到身份 + 指挥席 peers 注册表存
 *    identity + sanitizePeers 投影；无署名链路保持原形态（additive 不回归）
 * 5. 协作成员端点：/api/federation/members 只出带身份的活跃会话
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { sanitizeEngineerIdentity, FIELD_MAX } = require(path.join(ROOT, 'core/shared-backend/engineer-identity.js'));
const { buildMobileGateway } = require(path.join(ROOT, 'core/biof3-server/mobile-gateway/index.js'));
const { getStores, resetStoresForTest } = require(path.join(ROOT, 'core/biof3-server/mobile-gateway/pairing.js'));
const { addPeerFromPairingUrl, sanitizePeers } = require(path.join(ROOT, 'core/shared-backend/federation-peers.js'));

function tmpRoot() {
  return mkdtempSync(path.join(tmpdir(), 'gewu-block88-test-'));
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

async function body(response) {
  return response.json();
}

// ── 1. 净化函数 ─────────────────────────────────────────────────────────

test('BLOCK-88 P1: sanitizeEngineerIdentity strips control chars, caps length, rejects empty', () => {
  assert.equal(sanitizeEngineerIdentity(null), null);
  assert.equal(sanitizeEngineerIdentity('工程师 A'), null);
  assert.equal(sanitizeEngineerIdentity(42), null);
  assert.equal(sanitizeEngineerIdentity({}), null);
  assert.equal(sanitizeEngineerIdentity({ displayName: '   ' }), null);
  assert.equal(sanitizeEngineerIdentity({ displayName: '\u0000\u001f' }), null);

  const clean = sanitizeEngineerIdentity({ displayName: '  工程师 A  ', device: 'macOS' });
  assert.deepEqual(clean, { displayName: '工程师 A', device: 'macOS' });

  const hostile = sanitizeEngineerIdentity({ displayName: `A\u0000B\u001fC${'x'.repeat(80)}` });
  assert.equal(hostile.displayName.length, FIELD_MAX);
  assert.equal(hostile.displayName, 'ABC' + 'x'.repeat(FIELD_MAX - 3));

  // device 单独声明也成立
  assert.deepEqual(sanitizeEngineerIdentity({ device: 'Windows' }), { device: 'Windows' });
});

// ── 2. 会话存储：identity 只在声明时落键 ────────────────────────────────

test('BLOCK-88 P1: sessions carry identity only when declared; legacy projection keys unchanged', () => {
  const root = tmpRoot();
  resetStoresForTest();
  try {
    const stores = getStores(root);
    stores.sessions.createSession({ name: '手机设备-01' });
    stores.sessions.createSession({ name: '联邦访客', identity: { displayName: '工程师 A', device: 'macOS' } });

    const list = stores.sessions.list();
    assert.equal(list.length, 2);
    // 无声明会话：键集与 BLOCK-70 既有契约逐字一致
    assert.deepEqual(Object.keys(list[0]).sort(), ['createdAt', 'id', 'lastSeenAt', 'name', 'revoked']);
    // 有声明会话：identity 键 additive
    assert.deepEqual(Object.keys(list[1]).sort(), ['createdAt', 'id', 'identity', 'lastSeenAt', 'name', 'revoked']);
    assert.deepEqual(list[1].identity, { displayName: '工程师 A', device: 'macOS' });

    // 落盘内容无 token 明文、identity 在档
    const { readFileSync } = require('node:fs');
    const raw = readFileSync(stores.sessions.sessionsPath, 'utf8');
    assert.ok(raw.includes('"identity"'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── 3. 配对握手：pair 收身份 + health 回显 ──────────────────────────────

test('BLOCK-88 P1: gateway pair stores declared identity; health echoes session identity', async () => {
  const root = tmpRoot();
  resetStoresForTest();
  try {
    const stores = getStores(root);
    const { app: gatewayApp } = buildMobileGateway({ dataDir: root });
    const server = await listen(gatewayApp);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      // 带署名配对
      const { token } = stores.pairing.issue();
      const paired = await body(await fetch(`${base}/m/api/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, identity: { displayName: '工程师 A', device: 'macOS' } }),
      }));
      assert.equal(paired.ok, true);
      assert.deepEqual(paired.identity, { displayName: '工程师 A', device: 'macOS' });

      const sessions = stores.sessions.list();
      const engineerSession = sessions.find((s) => s.identity);
      assert.ok(engineerSession, 'engineer session must be stored');
      assert.equal(engineerSession.id, paired.sessionId);
      assert.deepEqual(engineerSession.identity, { displayName: '工程师 A', device: 'macOS' });
      assert.ok(engineerSession.name.startsWith('工程师 A'), `session name must carry signature, got: ${engineerSession.name}`);

      // health 回显本会话身份（指挥席契约断言面）
      const health = await body(await fetch(`${base}/federation/api/health`, {
        headers: { Authorization: `Bearer ${paired.sessionToken}` },
      }));
      assert.equal(health.ok, true);
      assert.deepEqual(health.session.identity, { displayName: '工程师 A', device: 'macOS' });
      assert.ok(health.session.name, 'health must echo session name');

      // 无署名配对：identity 不落键（additive 不回归）
      const { token: token2 } = stores.pairing.issue();
      const plain = await body(await fetch(`${base}/m/api/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token2 }),
      }));
      assert.equal(plain.ok, true);
      assert.equal(plain.identity, null);
      assert.ok(!stores.sessions.list().find((s) => s.id === plain.sessionId)?.identity, 'plain session must not carry identity key');

      // 恶意身份：控制字符与超长在网关入口即被净化
      const { token: token3 } = stores.pairing.issue();
      const hostile = await body(await fetch(`${base}/m/api/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token3, identity: { displayName: `X\u0000Y${'z'.repeat(80)}` } }),
      }));
      assert.equal(hostile.identity.displayName.length, FIELD_MAX);
    } finally {
      await closeServer(server);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── 4. 端到端：指挥席带署名配对 → 双端落档 ──────────────────────────────

test('BLOCK-88 P1: command-seat pairing with signature lands identity on both ends', async () => {
  const execRoot = tmpRoot();   // 对端格物（被访端）
  const cmdRoot = tmpRoot();    // 指挥席格物
  resetStoresForTest();
  try {
    const express = require('express');
    const adminApp = express();
    adminApp.use(express.json({ limit: '4kb' }));
    require(path.join(ROOT, 'core/biof3-server/routes/mobile-admin.js'))(adminApp, { dataDir: execRoot });
    const adminServer = await listen(adminApp);
    const adminBase = `http://127.0.0.1:${adminServer.address().port}`;

    const { app: gatewayApp } = buildMobileGateway({ dataDir: execRoot });
    const gatewayServer = await listen(gatewayApp);
    const gatewayPort = gatewayServer.address().port;

    try {
      const pairToken = await body(await fetch(`${adminBase}/api/mobile/pairing/token`, { method: 'POST' }));
      const pairingUrl = `http://127.0.0.1:${gatewayPort}/pair?token=${pairToken.token}`;

      // 指挥席以「工程师 A · macOS」署名配对
      const result = await addPeerFromPairingUrl(cmdRoot, pairingUrl, {
        identity: { displayName: '工程师 A', device: 'macOS' },
      });
      assert.equal(result.ok, true, `pair failed: ${JSON.stringify(result)}`);

      // 对端（被访端）：会话落档身份
      const execSessions = getStores(execRoot).sessions.list();
      const visitor = execSessions.find((s) => s.identity);
      assert.ok(visitor, 'host side must hold the declared identity on the session');
      assert.deepEqual(visitor.identity, { displayName: '工程师 A', device: 'macOS' });

      // 指挥席：peers 注册表存 identity 且安全投影暴露（token 仍不出）
      const peers = sanitizePeers(cmdRoot).peers;
      assert.equal(peers.length, 1);
      assert.deepEqual(peers[0].identity, { displayName: '工程师 A', device: 'macOS' });
      assert.equal(peers[0].sessionToken, undefined);
    } finally {
      await closeServer(gatewayServer);
      await closeServer(adminServer);
    }
  } finally {
    rmSync(execRoot, { recursive: true, force: true });
    rmSync(cmdRoot, { recursive: true, force: true });
  }
});

// ── 5. 协作成员端点 ─────────────────────────────────────────────────────

test('BLOCK-88 P1: /api/federation/members lists only active engineer sessions', async () => {
  const root = tmpRoot();
  resetStoresForTest();
  try {
    const stores = getStores(root);
    stores.sessions.createSession({ name: '手机设备-01' });                                             // 无身份：不出
    stores.sessions.createSession({ name: '联邦访客-1', identity: { displayName: '工程师 A', device: 'macOS' } });
    const revoked = stores.sessions.createSession({ name: '联邦访客-2', identity: { displayName: '工程师 B', device: 'Windows' } });
    assert.equal(stores.sessions.revoke(revoked.sessionId), true);

    const express = require('express');
    const app = express();
    require(path.join(ROOT, 'core/biof3-server/routes/federation-admin.js'))(app, { dataDir: root });
    const server = await listen(app);
    try {
      const data = await body(await fetch(`http://127.0.0.1:${server.address().port}/api/federation/members`));
      assert.equal(data.ok, true);
      assert.equal(data.members.length, 1, 'only active identity sessions are members');
      assert.deepEqual(data.members[0].identity, { displayName: '工程师 A', device: 'macOS' });
      assert.deepEqual(Object.keys(data.members[0]).sort(), ['createdAt', 'id', 'identity', 'lastSeenAt', 'name']);
    } finally {
      await closeServer(server);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
