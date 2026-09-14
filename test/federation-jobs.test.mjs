/**
 * BLOCK-85 P2 — 作业级联邦转发探针。
 *
 * 对端 = 真实 mobile-gateway + mountRoutes 模拟 /api/tools/* 三端点契约
 * （与生产形态一致：对端全量路由挂 gateway 会话门内）；
 * 指挥席 = 真实 federation-admin REST。
 *
 * 覆盖：
 * 1. 作业转发：POST /api/federation/peers/:id/jobs → 对端 /api/tools/run
 *    收到 toolId/params（含 200mb 级 body 通道）并返回对端 jobId
 * 2. 状态转发：GET .../jobs/:jobId → 对端 status 端点
 * 3. 产物拉取：GET .../jobs/:jobId/file/:filename → 字节透传
 * 4. 鉴权传播：对端吊销联邦会话后 → 401 peer_session_invalid
 * 5. 对端离线 → 504 peer_unreachable/timeout
 * 6. 未知节点 → 404；缺 toolId → 400
 *
 * 诚实边界：本探针验证转发语义与鉴权传播；真实跨机 R 分析作业（双真机
 * 配对后端到端）属用户双机验收，不由本探针覆盖。
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

const { buildMobileGateway } = require(path.join(ROOT, 'core/biof3-server/mobile-gateway/index.js'));
const { getStores, resetStoresForTest } = require(path.join(ROOT, 'core/biof3-server/mobile-gateway/pairing.js'));

function tmpRoot() {
  return mkdtempSync(path.join(tmpdir(), 'gewu-fedjob-test-'));
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

test('BLOCK-85 P2: job forward -> status -> file -> revoke propagation -> offline', async () => {
  const execRoot = tmpRoot();
  const cmdRoot = tmpRoot();
  resetStoresForTest();
  const seen = { run: null, statusId: null, fileJob: null, file: null };
  try {
    const express = require('express');

    // ── 对端：gateway + 模拟全量路由（生产=真实 /api/tools/*，会话门内）──
    const { app: gatewayApp } = buildMobileGateway({
      dataDir: execRoot,
      mountRoutes: (app) => {
        app.post('/api/tools/run', express.json({ limit: '8mb' }), (req, res) => {
          seen.run = { toolId: req.body?.toolId, params: req.body?.params, userId: req.user?.id };
          res.json({ ok: true, jobId: 'job_peer0001', status: 'pending' });
        });
        app.get('/api/tools/status/:id', (req, res) => {
          seen.statusId = req.params.id;
          res.json({ ok: true, job: { id: req.params.id, status: 'completed', tool_id: 'volcano-plot' } });
        });
        app.get('/api/tools/file/:jobId/:filename', (req, res) => {
          seen.fileJob = req.params.jobId;
          seen.file = req.params.filename;
          res.setHeader('Content-Type', 'image/png');
          res.send(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        });
      },
    });
    const gatewayServer = await listen(gatewayApp);
    const gatewayPort = gatewayServer.address().port;

    // ── 对端 admin：生成配对 token ──
    const adminApp = express();
    adminApp.use(express.json({ limit: '4kb' }));
    require(path.join(ROOT, 'core/biof3-server/routes/mobile-admin.js'))(adminApp, { dataDir: execRoot });
    const adminServer = await listen(adminApp);
    const adminBase = `http://127.0.0.1:${adminServer.address().port}`;

    // ── 指挥席：federation-admin REST ──
    const cmdApp = express();
    require(path.join(ROOT, 'core/biof3-server/routes/federation-admin.js'))(cmdApp, { dataDir: cmdRoot });
    const cmdServer = await listen(cmdApp);
    const cmdBase = `http://127.0.0.1:${cmdServer.address().port}`;

    // 配对
    const pairToken = await body(await fetch(`${adminBase}/api/mobile/pairing/token`, { method: 'POST' }));
    const paired = await body(await fetch(`${cmdBase}/api/federation/peers/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `http://127.0.0.1:${gatewayPort}/pair?token=${pairToken.token}` }),
    }));
    assert.equal(paired.ok, true, JSON.stringify(paired));
    const peerId = paired.peer.peerId;

    // 1. 作业转发（身份必须映射为对端 LOCAL_USER）
    const submitted = await body(await fetch(`${cmdBase}/api/federation/peers/${peerId}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId: 'volcano-plot', projectId: 'p_fed', params: { genes: 'demo', executionTargetId: '' } }),
    }));
    assert.equal(submitted.ok, true, JSON.stringify(submitted));
    assert.equal(submitted.job.jobId, 'job_peer0001');
    assert.equal(submitted.peerId, peerId);
    assert.equal(seen.run.toolId, 'volcano-plot');
    assert.equal(seen.run.userId, 'local-user', 'federation session must map to peer LOCAL_USER');

    // 2. 状态转发（job 字段 = 对端 /api/tools/status 的完整响应）
    const status = await body(await fetch(`${cmdBase}/api/federation/peers/${peerId}/jobs/job_peer0001`));
    assert.equal(status.ok, true);
    assert.equal(status.job.job.status, 'completed');
    assert.equal(seen.statusId, 'job_peer0001');

    // 3. 产物拉取（字节透传）
    const fileResp = await fetch(`${cmdBase}/api/federation/peers/${peerId}/jobs/job_peer0001/file/volcano.png`);
    assert.equal(fileResp.status, 200);
    const bytes = Buffer.from(await fileResp.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'PNG magic must pass through');
    assert.equal(seen.fileJob, 'job_peer0001');
    assert.equal(seen.file, 'volcano.png');

    // 4. 鉴权传播：对端吊销联邦会话 → 转发全部 401 peer_session_invalid
    const stores = getStores(execRoot);
    const execSession = stores.sessions.list().find((session) => !session.revoked);
    stores.sessions.revoke(execSession.id);
    const afterRevoke = await body(await fetch(`${cmdBase}/api/federation/peers/${peerId}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId: 'volcano-plot' }),
    }));
    assert.equal(afterRevoke.error, 'peer_session_invalid', JSON.stringify(afterRevoke));

    // 5. 对端离线 → 504
    await closeServer(gatewayServer);
    const offline = await body(await fetch(`${cmdBase}/api/federation/peers/${peerId}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId: 'volcano-plot' }),
    }));
    assert.equal(offline.ok, false);
    assert.ok(['peer_unreachable', 'peer_timeout'].includes(offline.error), JSON.stringify(offline));

    // 6. 未知节点 / 缺 toolId
    const unknown = await body(await fetch(`${cmdBase}/api/federation/peers/gpeer_x/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId: 'x' }),
    }));
    assert.equal(unknown.error, 'peer_not_found');
    const noTool = await body(await fetch(`${cmdBase}/api/federation/peers/${peerId}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));
    assert.equal(noTool.error, 'missing_tool_id');

    await closeServer(adminServer);
    await closeServer(cmdServer);
  } finally {
    resetStoresForTest();
    rmSync(execRoot, { recursive: true, force: true });
    rmSync(cmdRoot, { recursive: true, force: true });
  }
});
