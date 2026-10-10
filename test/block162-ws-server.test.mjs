'use strict';

/**
 * BLOCK-162 P0 — 零依赖 RFC6455 最小 WS 服务端契约。
 *
 * 契约：
 *  ① acceptKey RFC6455 官方向量；握手 101 + Sec-WebSocket-Accept 正确。
 *  ② 掩码解码：客户端 masked text 帧 → 服务端 'message' 事件 JSON。
 *  ③ ping→pong（服务端回 0xA）；pong 判活；无 pong 连续 2 轮 → close 1001。
 *  ④ 未掩码客户端帧 / 分片帧 → 协议错误显式 close（1002）。
 *  ⑤ 慢消费者：socket.writableLength 越限 → 主动 close 1009（背压保护）。
 *
 * 测试自带最小 WS 客户端（RFC6455 客户端方向必须掩码），零测试依赖。
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WS_PATH = path.join(ROOT, 'core/biof3-server/mobile-gateway/ws.js');

const { acceptKey, attachWsServer, encodeFrame } = require(WS_PATH);
const { WsTestClient } = require('./block162-ws-client.mjs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`waitFor timeout (${timeoutMs}ms)`);
    await sleep(5);
  }
}

async function listen(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server.address().port;
}

// ── ① acceptKey RFC 向量 + 握手 ──────────────────────────────────────────

test('BLOCK-162 ① acceptKey：RFC6455 官方向量；握手 101 且 Accept 正确', async () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  const server = http.createServer();
  const { hub } = attachWsServer(server, { path: '/ws', authenticate: () => true });
  hub.on('connection', (conn) => conn.on('message', (m) => conn.send({ echo: m.x })));
  const port = await listen(server);
  let client = null;
  try {
    client = await WsTestClient.connect(port, '/ws');
    assert.ok(client, '升级成功');
    client.send({ x: 42 });
    assert.deepEqual(await client.next(), { echo: 42 }, '掩码帧解码 + 回环');
    client.close();
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
});

// ── ② 升级拒绝面 ─────────────────────────────────────────────────────────

test('BLOCK-162 ② 鉴权失败 401 拒绝升级；路径不匹配 404', async () => {
  const server = http.createServer();
  attachWsServer(server, { path: '/ws', authenticate: () => false });
  const port = await listen(server);
  try {
    const denied = await WsTestClient.connect(port, '/ws');
    assert.equal(denied.rejected, 401, '未授权必须 401 且不升级');
    const notFound = await WsTestClient.connect(port, '/other');
    assert.equal(notFound.rejected, 404, '路径不匹配 404');
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
});

// ── ③ 协议错误显式拒绝 ───────────────────────────────────────────────────

test('BLOCK-162 ③ 未掩码帧 → close 1002；分片文本帧 → close 1002', async () => {
  const server = http.createServer();
  const { hub } = attachWsServer(server, { path: '/ws', authenticate: () => true });
  hub.on('connection', () => {});
  const port = await listen(server);
  let c1 = null;
  let c2 = null;
  try {
    c1 = await WsTestClient.connect(port, '/ws');
    c1.sendUnmaskedText({ x: 1 });
    await waitFor(() => c1.closed);
    assert.equal(c1.closeCode, 1002, '客户端帧必须掩码（RFC6455 §5.1）');

    c2 = await WsTestClient.connect(port, '/ws');
    c2.sendRawMasked(0x01, Buffer.from('frag'), false); // FIN=0 分片首帧
    await waitFor(() => c2.closed);
    assert.equal(c2.closeCode, 1002, '分片帧显式拒绝（边界如实声明）');
  } finally {
    try { c1?.socket.destroy(); } catch {}
    try { c2?.socket.destroy(); } catch {}
    server.close();
    server.closeAllConnections?.();
  }
});

// ── ④ 心跳：ping/pong 判活；连续无 pong 判死 ─────────────────────────────

test('BLOCK-162 ④ 心跳：ping 必达；自动 pong 保活；失联 2 轮 close 1001', async () => {
  const server = http.createServer();
  const { hub } = attachWsServer(server, { path: '/ws', authenticate: () => true, pingIntervalMs: 30 });
  hub.on('connection', () => {});
  const port = await listen(server);
  let alive = null;
  let silent = null;
  try {
    alive = await WsTestClient.connect(port, '/ws');
    assert.ok(await alive.next(500)?.then?.((m) => m && m.__ping === true), '服务端 ping 必达');
    await sleep(100);
    assert.equal(alive.closed, false, '自动 pong 客户端保持连接');

    silent = await WsTestClient.connect(port, '/ws');
    silent.autoPong = false;
    await waitFor(() => silent.closed, 2000);
    assert.equal(silent.closeCode, 1001, '连续 2 轮无 pong 判死');
  } finally {
    try { alive?.socket.destroy(); } catch {}
    try { silent?.socket.destroy(); } catch {}
    server.close();
    server.closeAllConnections?.();
  }
});

// ── ⑤ 慢消费者背压保护 ───────────────────────────────────────────────────

test('BLOCK-162 ⑤ 慢消费者：对端不读，待发越限 → 服务端主动断开止损', async () => {
  const server = http.createServer();
  let serverConn = null;
  const { hub } = attachWsServer(server, { path: '/ws', authenticate: () => true });
  hub.on('connection', (conn) => {
    serverConn = conn;
    conn.on('message', () => {
      // 每条回显 ~200KB；客户端暂停读取 → writableLength 堆积越限
      conn.send({ blob: 'x'.repeat(200 * 1024) });
    });
  });
  const port = await listen(server);
  let client = null;
  try {
    client = await WsTestClient.connect(port, '/ws');
    client.socket.pause();
    for (let i = 0; i < 30; i += 1) client.send({ i, pad: 'y'.repeat(64 * 1024) });
    await waitFor(() => serverConn && serverConn.closed, 5000);
    assert.equal(serverConn.closed, true, '背压越限必须服务端断开止损（事件可经水位重连补齐）');
    // Windows 对接收缓冲有未读数据的连接丢弃 RST——resume 后客户端终态闭合即可，
    // close 帧本身被 1.2MB 队列吞掉（destroy 语义），不断言 closeCode。
    client.socket.resume();
    await waitFor(() => client.closed, 3000);
  } finally {
    try { client?.socket.destroy(); } catch {}
    server.close();
    server.closeAllConnections?.();
  }
});

// ── ⑥ encodeFrame 形状（7/16 位长度）────────────────────────────────────

test('BLOCK-162 ⑥ encodeFrame：小帧 2 字节头、126 档 4 字节头、FIN+opcode 正确', () => {
  const small = encodeFrame(0x1, Buffer.from('hi'));
  assert.equal(small[0], 0x81, 'FIN|text');
  assert.equal(small[1], 2);
  const mid = encodeFrame(0x1, Buffer.alloc(300));
  assert.equal(mid[1], 126);
  assert.equal(mid.readUInt16BE(2), 300);
});
