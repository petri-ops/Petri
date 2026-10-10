/**
 * BLOCK-85 格物联邦 P1 — 联邦通道集成探针。
 *
 * 覆盖（对端 = 真实 mobile-gateway 实例；指挥席 = 真实 federation-admin REST）：
 * 1. 配对：粘贴对端配对链接 → 兑换会话 + /federation/api/health 握手 → 落盘
 * 2. 握手内容：节点名/平台/执行器/协议版本
 * 3. 在线探测：probe ok + 延迟；对端吊销会话后 probe 即刻失败（401，D6 安全语义）
 * 4. REST 全链：pair / list（token 不出）/ probe / delete
 * 5. 坏输入：无效链接 400；未知节点 404
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

const { buildMobileGateway } = require(path.join(ROOT, 'core/petri-server/mobile-gateway/index.js'));
const { getStores, resetStoresForTest } = require(path.join(ROOT, 'core/petri-server/mobile-gateway/pairing.js'));

function tmpRoot() {
  return mkdtempSync(path.join(tmpdir(), 'petri-fed-test-'));
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

test('BLOCK-85 P1: pair -> handshake -> probe -> revoke -> remove full chain', async () => {
  const execRoot = tmpRoot();   // 对端格物（执行方）
  const cmdRoot = tmpRoot();    // 指挥席格物
  resetStoresForTest();
  try {
    // ── 对端：gateway + admin（生成配对 token）──
    const express = require('express');
    const adminApp = express();
    adminApp.use(express.json({ limit: '4kb' }));
    require(path.join(ROOT, 'core/petri-server/routes/mobile-admin.js'))(adminApp, { dataDir: execRoot });
    const adminServer = await listen(adminApp);
    const adminBase = `http://127.0.0.1:${adminServer.address().port}`;

    const { app: gatewayApp } = buildMobileGateway({
      dataDir: execRoot,
      mountRoutes: (app) => app.get('/m/api/probe', (_req, res) => res.json({ ok: true })),
    });
    const gatewayServer = await listen(gatewayApp);

    // ── 指挥席：federation-admin REST ──
    // 注意：不挂 app 级 express.json——与生产 routes/index.js 挂法一致
    // （admin 路由自带路由级 json；双重解析会消费已耗尽的 stream → 500）。
    const cmdApp = express();
    require(path.join(ROOT, 'core/petri-server/routes/federation-admin.js'))(cmdApp, { dataDir: cmdRoot });
    const cmdServer = await listen(cmdApp);
    const cmdBase = `http://127.0.0.1:${cmdServer.address().port}`;

    // 空列表
    const empty = await body(await fetch(`${cmdBase}/api/federation/peers`));
    assert.equal(empty.ok, true);
    assert.deepEqual(empty.peers, []);

    // 对端生成配对 token；URL 里的端口是配置值而 gateway 实际监听随机端口，
    // 测试用真实监听端口构造配对链接（生产中两者一致）。
    const pairToken = await body(await fetch(`${adminBase}/api/mobile/pairing/token`, { method: 'POST' }));
    assert.equal(pairToken.ok, true);
    const gatewayPort = gatewayServer.address().port;
    const pairingUrl = `http://127.0.0.1:${gatewayPort}/pair?token=${pairToken.token}`;

    // 1+2. 配对 + 握手
    const paired = await body(await fetch(`${cmdBase}/api/federation/peers/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: pairingUrl }),
    }));
    assert.equal(paired.ok, true, `pair failed: ${JSON.stringify(paired)}`);
    assert.ok(paired.peer.peerId.startsWith('gpeer_'));
    assert.equal(paired.peer.platform, process.platform);
    assert.equal(paired.peer.protocol, 1);
    assert.equal(typeof paired.peer.name, 'string');
    assert.ok(paired.peer.name.length > 0, 'handshake must carry node name');
    const peerId = paired.peer.peerId;

    // token 不出列表
    const listed = await body(await fetch(`${cmdBase}/api/federation/peers`));
    assert.equal(listed.peers.length, 1);
    assert.equal(listed.peers[0].sessionToken, undefined);
    assert.equal(listed.peers[0].peerId, peerId);

    // 3. 在线探测
    const probed = await body(await fetch(`${cmdBase}/api/federation/peers/${peerId}/probe`, { method: 'POST' }));
    assert.equal(probed.ok, true);
    assert.equal(probed.probe.ok, true);
    assert.ok(probed.peer.lastProbe.latencyMs !== null);

    // 对端吊销会话 → 探测即刻失败（D6：对端面板吊销对联邦会话同样生效）
    const stores = getStores(execRoot);
    const execSession = stores.sessions.list().find((session) => !session.revoked);
    assert.ok(execSession, 'gateway must hold the federation session');
    assert.equal(stores.sessions.revoke(execSession.id), true);
    const probedAfterRevoke = await body(await fetch(`${cmdBase}/api/federation/peers/${peerId}/probe`, { method: 'POST' }));
    assert.equal(probedAfterRevoke.probe.ok, false);
    assert.equal(probedAfterRevoke.probe.error, 'status_401', 'revoked session must fail handshake with 401');

    // 重新配对（重发 token 后 upsert 同一节点）
    const pairToken2 = await body(await fetch(`${adminBase}/api/mobile/pairing/token`, { method: 'POST' }));
    const repaired = await body(await fetch(`${cmdBase}/api/federation/peers/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `http://127.0.0.1:${gatewayPort}/pair?token=${pairToken2.token}` }),
    }));
    assert.equal(repaired.ok, true);
    assert.equal(repaired.peer.peerId, peerId, 're-pairing same baseUrl must upsert, not duplicate');

    // 4. 删除
    const removed = await body(await fetch(`${cmdBase}/api/federation/peers/${peerId}`, { method: 'DELETE' }));
    assert.equal(removed.ok, true);
    const afterRemove = await body(await fetch(`${cmdBase}/api/federation/peers`));
    assert.deepEqual(afterRemove.peers, []);

    // 5. 坏输入
    const badUrl = await body(await fetch(`${cmdBase}/api/federation/peers/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-url' }),
    }));
    assert.equal(badUrl.status === 400 || badUrl.ok === false, true);
    const unknownProbe = await body(await fetch(`${cmdBase}/api/federation/peers/gpeer_missing/probe`, { method: 'POST' }));
    assert.equal(unknownProbe.probe.error, 'peer_not_found');

    await closeServer(gatewayServer);
    await closeServer(adminServer);
    await closeServer(cmdServer);
  } finally {
    resetStoresForTest();
    rmSync(execRoot, { recursive: true, force: true });
    rmSync(cmdRoot, { recursive: true, force: true });
  }
});
