'use strict';

/**
 * BLOCK-183 P0 — /m/api/ws `data` 请求/响应信封契约（红绿先行）。
 *
 * 契约：
 *  ① 白名单内 GET 读路径 → data-res{status,data} 与 HTTP 响应同形状透传。
 *  ② 白名单外（含查询串后缀/写路径）fail-closed → data-err{path_not_allowed}。
 *  ③ 上游非 2xx（如 500）照实透传 status，形状不变。
 *  ④ 并发多请求 id 关联不串线（慢请求后发先至不混淆）。
 *  ⑤ 上游超时 → data-err{data_timeout}。
 *  ⑥ 在途并发超上限 → data-err{data_overloaded}。
 *  ⑦ 会话门外零 data 面：无/错 token upgrade 即 401（BLOCK-162 门复用，data 不旁路）。
 *
 * 架设：同一 http.Server 上挂请求 handler（模拟既有 Express 路由面——
 * 服务端 loopback 自调打的就是这个口）+ attachAgentWs。
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// 复用 BLOCK-162 测试基建（最小 WS 客户端）
const { WsTestClient } = await import('./block162-ws-client.mjs');

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { attachAgentWs, DATA_ALLOWED_PATHS } = require(path.join(ROOT, 'core/petri-server/mobile-gateway/agent-ws.js'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SESSION_STORE = { sessions: { authenticate: (token) => (token === 'good-token' ? { id: 'sess-1' } : null) } };

/** 模拟既有 Express 路由面：七条白名单路径中的采样 + 一条慢路径（关联/超时/上限用例共用）。 */
function makeApiHandler({ slowDelayMs = 250 } = {}) {
  return function handler(req, res) {
    const pathname = (req.url || '/').split('?')[0];
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (pathname === '/api/runtime/status') {
      json(200, { ok: true, runtime: { r: { installed: true, path: 'R' }, python: { installed: false, path: null } } });
      return;
    }
    if (pathname === '/api/packs/installed') {
      json(500, { ok: false, error: 'upstream_boom' });
      return;
    }
    if (pathname === '/api/packs/available') {
      // 慢路径（白名单内整串 URL，不带查询串——白名单 fail-closed 拒 query）
      setTimeout(() => json(200, { ok: true, packs: [{ id: 'slow-pack' }] }), slowDelayMs);
      return;
    }
    json(404, { ok: false });
  };
}

async function listen(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server.address().port;
}

function makeServer(store, overrides = {}, apiHandler = makeApiHandler()) {
  const server = http.createServer(apiHandler);
  // 本包用例只打 data 面：store 给最小桩（任务流面由 block162 专属测试覆盖）
  const fullStore = {
    getAgentTask: () => null,
    getAgentTaskEventsSince: () => [],
    taskEventBus: new EventEmitter(),
    ...store,
  };
  attachAgentWs(server, { stores: SESSION_STORE, store: fullStore, ...overrides });
  return server;
}

async function closeServer(server) {
  server.close();
  server.closeAllConnections?.();
  await sleep(20);
}

async function connectGood(port) {
  const client = await WsTestClient.connect(port, '/m/api/ws', { Authorization: 'Bearer good-token' });
  assert.ok(!(client && client.rejected), 'good-token 应升级成功');
  return client;
}

// ── ① 白名单透传 ─────────────────────────────────────────────────────────

test('BLOCK-183 ① 白名单内读路径 → data-res status+data 与 HTTP 同形状透传', async () => {
  const server = makeServer({});
  const port = await listen(server);
  try {
    const client = await connectGood(port);
    client.send({ t: 'data', id: 'r1', url: '/api/runtime/status' });
    const res = await client.next();
    assert.equal(res.t, 'data-res');
    assert.equal(res.id, 'r1');
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, {
      ok: true,
      runtime: { r: { installed: true, path: 'R' }, python: { installed: false, path: null } },
    }, 'data 与 HTTP 响应体逐字段一致（形状单一真相）');
    client.close();
  } finally {
    await closeServer(server);
  }
});

// ── ② 白名单外 fail-closed ───────────────────────────────────────────────

test('BLOCK-183 ② 白名单外（未知路径/查询串/写路径）→ data-err path_not_allowed', async () => {
  const server = makeServer({});
  const port = await listen(server);
  try {
    const client = await connectGood(port);
    client.send({ t: 'data', id: 'x1', url: '/api/sessions' });
    const r1 = await client.next();
    assert.equal(r1.t, 'data-err');
    assert.equal(r1.error, 'path_not_allowed');

    client.send({ t: 'data', id: 'x2', url: '/api/runtime/status?verbose=1' });
    const r2 = await client.next();
    assert.equal(r2.error, 'path_not_allowed', '查询串后缀不在白名单（v1 无参数面）');

    client.send({ t: 'data', id: 'x3', url: '/api/ai/settings', method: 'POST' });
    const r3 = await client.next();
    assert.equal(r3.t, 'data-res', 'method 字段被忽略——信封只做 GET 读，白名单内照常');

    client.send({ t: 'data', url: '/api/runtime/status' });
    const r4 = await client.next();
    assert.equal(r4.t, 'data-err');
    assert.equal(r4.error, 'invalid_request', '缺 id → invalid_request');
    client.close();
  } finally {
    await closeServer(server);
  }
});

// ── ③ 上游错误透传 ───────────────────────────────────────────────────────

test('BLOCK-183 ③ 上游 500 照实透传（data-res status=500，不吞不改写）', async () => {
  const server = makeServer({});
  const port = await listen(server);
  try {
    const client = await connectGood(port);
    client.send({ t: 'data', id: 'e1', url: '/api/packs/installed' });
    const res = await client.next();
    assert.equal(res.t, 'data-res');
    assert.equal(res.status, 500);
    assert.deepEqual(res.data, { ok: false, error: 'upstream_boom' });
    client.close();
  } finally {
    await closeServer(server);
  }
});

// ── ④ id 关联并发 ────────────────────────────────────────────────────────

test('BLOCK-183 ④ 并发双请求 id 关联不串线（慢请求后发，快响应先回）', async () => {
  const server = makeServer({});
  const port = await listen(server);
  try {
    const client = await connectGood(port);
    client.send({ t: 'data', id: 'slow', url: '/api/packs/available' });
    client.send({ t: 'data', id: 'fast', url: '/api/runtime/status' });
    const first = await client.next();
    const second = await client.next();
    const ids = [first.id, second.id];
    assert.deepEqual(ids.sort(), ['fast', 'slow'], '两个 id 都有响应');
    assert.equal(first.id, 'fast', '快响应先回（不被慢请求阻塞队头）');
    const slowRes = first.id === 'slow' ? first : second;
    const fastRes = first.id === 'fast' ? first : second;
    assert.equal(slowRes.status, 200);
    assert.deepEqual(slowRes.data, { ok: true, packs: [{ id: 'slow-pack' }] }, '慢请求的 data 归慢 id');
    assert.equal(fastRes.data.ok, true, '快请求 data 归快 id');
    client.close();
  } finally {
    await closeServer(server);
  }
});

// ── ⑤ 超时 ──────────────────────────────────────────────────────────────

test('BLOCK-183 ⑤ 上游超时 → data-err data_timeout（不挂死不串台）', async () => {
  const server = makeServer({}, { dataTimeoutMs: 150 }, makeApiHandler({ slowDelayMs: 600 }));
  const port = await listen(server);
  try {
    const client = await connectGood(port);
    client.send({ t: 'data', id: 't1', url: '/api/packs/available' });
    const res = await client.next();
    assert.equal(res.t, 'data-err');
    assert.equal(res.id, 't1');
    assert.equal(res.error, 'data_timeout');
    // 超时后连接仍可用：再发一条正常请求应正常回
    client.send({ t: 'data', id: 't2', url: '/api/runtime/status' });
    const after = await client.next();
    assert.equal(after.t, 'data-res');
    assert.equal(after.id, 't2');
    client.close();
  } finally {
    await closeServer(server);
  }
});

// ── ⑥ 并发上限 ──────────────────────────────────────────────────────────

test('BLOCK-183 ⑥ 在途并发超上限 → data-err data_overloaded（先到的照常完成）', async () => {
  const server = makeServer({}, { maxInflightDataRequests: 1 });
  const port = await listen(server);
  try {
    const client = await connectGood(port);
    client.send({ t: 'data', id: 'a', url: '/api/packs/available' });
    client.send({ t: 'data', id: 'b', url: '/api/runtime/status' });
    const resB = await client.next();
    assert.equal(resB.t, 'data-err');
    assert.equal(resB.id, 'b');
    assert.equal(resB.error, 'data_overloaded', '第二条被上限挡下');
    const resA = await client.next();
    assert.equal(resA.t, 'data-res');
    assert.equal(resA.id, 'a', '第一条不受影响照常完成');
    // a 完成后额度释放：新请求照常
    client.send({ t: 'data', id: 'c', url: '/api/runtime/status' });
    const resC = await client.next();
    assert.equal(resC.t, 'data-res');
    assert.equal(resC.id, 'c');
    client.close();
  } finally {
    await closeServer(server);
  }
});

// ── ⑦ 会话门外零 data 面 ────────────────────────────────────────────────

test('BLOCK-183 ⑦ 会话门复用：错 token upgrade 401，data 面不旁路', async () => {
  const server = makeServer({});
  const port = await listen(server);
  try {
    const bad = await WsTestClient.connect(port, '/m/api/ws', { Authorization: 'Bearer wrong' });
    assert.equal(bad.rejected, 401, 'data 信封共享 upgrade 会话门，无独立放行口');
  } finally {
    await closeServer(server);
  }
});

// ── 白名单常量对账（前端镜像与桥调用面一致的锚点）────────────────────────

test('BLOCK-183 ⑧ 白名单=七条数据桥读路径（与 projectionDataBridges 调用面对账锚点）', () => {
  assert.deepEqual([...DATA_ALLOWED_PATHS].sort(), [
    '/api/ai/settings',
    '/api/packs/available',
    '/api/packs/installed',
    '/api/plugins/catalog',
    '/api/plugins/installed',
    '/api/runtime/status',
    '/api/skills/registry',
  ]);
});
