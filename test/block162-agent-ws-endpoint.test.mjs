'use strict';

/**
 * BLOCK-162 P2 — /m/api/ws 端点契约（fake store 注入，与 tunnel.js 注入约定同门）。
 *
 * 契约：
 *  ① upgrade 会话门：无/错 token → 401 不升级。
 *  ② sub 水位回放：afterSeq 起回放 ev 帧（形状与 SSE 对齐），终态任务直接回 done 帧。
 *  ③ 进程内即时推送：bus emit 快于兜底轮询（本用例轮询拉到 5s，300ms 内收到 ev
 *     即为推送证据）；旧 seq 不回推（单调水位）。
 *  ④ 兜底轮询补齐：绕过 bus 的原始落库（压实快照路径同型）由轮询补发 + 终态帧。
 *  ⑤ 越权/不存在：err 帧（forbidden / task_not_found），不升级不崩。
 *  ⑥ failed 终态帧携带 fallbackTaskId（对齐 SSE error 语义）。
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// 复用 ws-server 测试的最小客户端（同目录相对导入）
const { WsTestClient } = await import('./block162-ws-client.mjs');

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { attachAgentWs, FALLBACK_POLL_MS } = require(path.join(ROOT, 'core/biof3-server/mobile-gateway/agent-ws.js'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeFakeStore() {
  const bus = new EventEmitter();
  const tasks = new Map();
  const events = new Map();
  return {
    bus,
    tasks,
    events,
    getAgentTask: (id) => tasks.get(id) || null,
    getAgentTaskEventsSince: (id, after) => (events.get(id) || []).filter((e) => e.seq > after),
    taskEventBus: bus,
  };
}

const SESSION_STORE = { sessions: { authenticate: (token) => (token === 'good-token' ? { id: 'sess-1' } : null) } };

async function listen(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server.address().port;
}

function makeServer(store, overrides = {}) {
  const server = http.createServer();
  attachAgentWs(server, { stores: SESSION_STORE, store, fallbackPollMs: 60, ...overrides });
  return server;
}

// ── ① 会话门 ─────────────────────────────────────────────────────────────

test('BLOCK-162 ① upgrade 会话门：无 token / 错 token → 401 不升级', async () => {
  const server = makeServer(makeFakeStore());
  const port = await listen(server);
  try {
    const none = await WsTestClient.connect(port, '/m/api/ws');
    assert.equal(none.rejected, 401);
    const bad = await WsTestClient.connect(port, '/m/api/ws', { Authorization: 'Bearer wrong' });
    assert.equal(bad.rejected, 401);
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
});

// ── ② 回放 + 终态 ────────────────────────────────────────────────────────

test('BLOCK-162 ② sub 水位回放：afterSeq 起逐条 ev，终态任务直接 done 帧（形状对齐 SSE）', async () => {
  const store = makeFakeStore();
  store.events.set('t1', [
    { seq: 1, eventType: 'iter', payload: { event: 'iter', n: 1 } },
    { seq: 2, eventType: 'tool_call', payload: { event: 'tool_call', name: 'read' } },
  ]);
  store.tasks.set('t1', { user_id: 'local-user', agent_status: 'done', filesChanged: [{ path: 'a.txt', status: 'M' }] });
  const server = makeServer(store);
  const port = await listen(server);
  try {
    const client = await WsTestClient.connect(port, '/m/api/ws', { Authorization: 'Bearer good-token' });
    client.send({ t: 'sub', taskId: 't1', afterSeq: 0 });
    const e1 = await client.next();
    assert.equal(e1.t, 'ev');
    assert.equal(e1.seq, 1);
    assert.deepEqual(e1.payload, { event: 'iter', n: 1 }, 'ev 帧形状与 SSE data 帧对齐');
    const e2 = await client.next();
    assert.equal(e2.seq, 2);
    const done = await client.next();
    assert.equal(done.t, 'done');
    assert.equal(done.status, 'done');
    assert.deepEqual(done.filesChanged, [{ path: 'a.txt', status: 'M' }]);

    // afterSeq=1 → 只回放 seq=2
    const client2 = await WsTestClient.connect(port, '/m/api/ws', { Authorization: 'Bearer good-token' });
    client2.send({ t: 'sub', taskId: 't1', afterSeq: 1 });
    const only = await client2.next();
    assert.equal(only.seq, 2, 'afterSeq 水位生效');
    assert.equal((await client2.next()).status, 'done');
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
});

// ── ③ 进程内即时推送（快于兜底轮询）──────────────────────────────────────

test('BLOCK-162 ③ 即时推送：bus emit 300ms 内到达（兜底轮询拉到 5s，快到即推送证据）；旧 seq 不回推', async () => {
  const store = makeFakeStore();
  store.tasks.set('t2', { user_id: 'local-user', agent_status: 'running' });
  store.events.set('t2', []);
  const server = makeServer(store, { fallbackPollMs: 5000 }); // 轮询拉到 5s：300ms 内到达只能是 bus 推送
  const port = await listen(server);
  try {
    const client = await WsTestClient.connect(port, '/m/api/ws', { Authorization: 'Bearer good-token' });
    client.send({ t: 'sub', taskId: 't2', afterSeq: 0 });
    await sleep(30); // 等 sub 处理完（回放为空）

    store.bus.emit('event', { taskId: 't9', seq: 99, eventType: 'noise', payload: {} }); // 未订阅任务：不推
    store.bus.emit('event', { taskId: 't2', seq: 0, eventType: 'stale', payload: {} }); // 旧 seq：不推
    const t0 = Date.now();
    store.bus.emit('event', { taskId: 't2', seq: 5, eventType: 'iter', payload: { event: 'iter', n: 5 } });
    const ev = await client.next(500);
    assert.ok(ev && ev.t === 'ev' && ev.seq === 5, `bus 推送必达（got ${JSON.stringify(ev)}）`);
    assert.ok(Date.now() - t0 < 400, '推送快于兜底轮询（<400ms，轮询为 5s）');
    await sleep(30);
    assert.equal(client.queue.length, 0, '未订阅/旧 seq 帧不得漏入');
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
});

// ── ④ 兜底轮询补齐 + 终态帧 ──────────────────────────────────────────────

test('BLOCK-162 ④ 兜底轮询：绕过 bus 的原始落库由轮询补发；终态后发 done 并停表', async () => {
  const store = makeFakeStore();
  store.tasks.set('t3', { user_id: 'local-user', agent_status: 'running' });
  store.events.set('t3', []);
  const server = makeServer(store, { fallbackPollMs: 60 });
  const port = await listen(server);
  try {
    const client = await WsTestClient.connect(port, '/m/api/ws', { Authorization: 'Bearer good-token' });
    client.send({ t: 'sub', taskId: 't3', afterSeq: 0 });
    await sleep(30);

    // 模拟压实快照路径（直接落库，不过 bus——与 coalesceTaskDeltas 同型）
    store.events.get('t3').push({ seq: 7, eventType: 'delta', payload: { choices: [{ delta: { content: 'x' } }] } });
    const ev = await client.next(1000);
    assert.ok(ev && ev.t === 'ev' && ev.seq === 7, `轮询补齐必达（got ${JSON.stringify(ev)})`);

    store.tasks.get('t3').agent_status = 'done';
    const done = await client.next(1000);
    assert.equal(done.t, 'done');
    assert.equal(done.status, 'done');
    assert.equal(await client.next(200), null, '终态后不再有帧（停表）');
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
});

// ── ⑤ 越权 / 不存在 ──────────────────────────────────────────────────────

test('BLOCK-162 ⑤ 越权 sub → err forbidden；不存在 → err task_not_found；连接保持', async () => {
  const store = makeFakeStore();
  store.tasks.set('other-task', { user_id: 'someone-else', agent_status: 'running' });
  const server = makeServer(store);
  const port = await listen(server);
  try {
    const client = await WsTestClient.connect(port, '/m/api/ws', { Authorization: 'Bearer good-token' });
    client.send({ t: 'sub', taskId: 'other-task', afterSeq: 0 });
    assert.deepEqual(await client.next(), { t: 'err', message: 'forbidden', taskId: 'other-task' });
    client.send({ t: 'sub', taskId: 'missing-task', afterSeq: 0 });
    assert.deepEqual(await client.next(), { t: 'err', message: 'task_not_found', taskId: 'missing-task' });
    assert.equal(client.closed, false, '业务 err 不杀连接');
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
});

// ── ⑥ failed 终态帧携带 fallback ─────────────────────────────────────────

test('BLOCK-162 ⑥ failed 终态：error/resumable/fallbackTaskId 对齐 SSE error 语义', async () => {
  const store = makeFakeStore();
  store.events.set('t4', [
    { seq: 1, eventType: 'model_fallback', payload: { newTaskId: 't5', toProfileLabel: 'flash', category: 'chat' } },
  ]);
  store.tasks.set('t4', { user_id: 'local-user', agent_status: 'failed', error: 'boom', interruptedAt: null });
  const server = makeServer(store);
  const port = await listen(server);
  try {
    const client = await WsTestClient.connect(port, '/m/api/ws', { Authorization: 'Bearer good-token' });
    client.send({ t: 'sub', taskId: 't4', afterSeq: 0 });
    // 先回放 model_fallback 事件（ev），再发终态 done 帧（与 SSE 顺序一致）
    const replayed = await client.next();
    assert.equal(replayed.t, 'ev');
    assert.equal(replayed.seq, 1);
    const done = await client.next();
    assert.equal(done.t, 'done');
    assert.equal(done.status, 'failed');
    assert.equal(done.error, 'boom');
    assert.equal(done.fallbackTaskId, 't5');
    assert.equal(done.fallbackLabel, 'flash');
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
});

test('BLOCK-162 兜底轮询间隔常量钉住（2s）', () => {
  assert.equal(FALLBACK_POLL_MS, 2000);
});
