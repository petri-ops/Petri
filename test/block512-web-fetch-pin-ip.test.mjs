'use strict';

/**
 * BLOCK-512 P1 — web_fetch pin-IP（HK-01 红绿先行）。
 *
 * 缺陷（BLOCK-511 §2 第 8 项遗留）：guardedFetch 先解析校验全部地址，再把 URL 交给
 * fetchImpl（undici 自行重解析）——校验与建连之间存在 DNS rebinding TOCTOU 窗口。
 *
 * 修法契约（本测试钉住）：
 *  1. guardedFetch 新增 `transportImpl` 注入点：默认通道改 Node 内建 http/https +
 *     pinned lookup（建连层不再查 DNS，只连已校验地址）。
 *  2. transportImpl 收到 { url, host, addresses, timeoutMs, maxBytes, headers }，
 *     addresses 必须是**已过私网校验**的解析结果（重定向第二跳重新解析重新 pin）。
 *  3. 默认通道导出 `pinnedLookupFor(addresses)`：返回的 lookup 对任何 hostname 都只回
 *     已 pin 地址（rebind-proof 的核心属性）；https 时 servername=host 保 SNI/证书身份。
 *  4. 有界读体（超限截断）与超时错误名映射（TimeoutError → web_fetch_timeout）对两条
 *     通道一致。
 *  5. fetchImpl 注入契约保留（既有 block247/qoder-l1l2 测试不动；文档明示该通道不 pin）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import http from 'node:http';
import dns from 'node:dns';

const policy = await import('../core/petri-server/helpers/web-fetch-policy.js');

const PUBLIC_IP = '93.184.216.34'; // example.com 网段，测试中代表「公网解析结果」

function fakeLookup(map) {
  return async (host) => {
    if (!(host in map)) {
      const err = new Error(`lookup: no fake record for ${host}`);
      err.code = 'ENOTFOUND';
      throw err;
    }
    return map[host].map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
}

function streamResponse({ status = 200, contentType = 'text/plain', headers = {}, body = 'hello' }) {
  const stream = new PassThrough();
  stream.end(Buffer.from(body));
  const h = { 'content-type': contentType, ...headers };
  return {
    status,
    headers: { get: (name) => h[String(name).toLowerCase()] ?? null },
    stream,
  };
}

test('red: guardedFetch 支持 transportImpl 注入且收到已校验地址（当前实现必红）', async () => {
  const calls = [];
  const result = await policy.guardedFetch('https://a.example/page', {
    lookup: fakeLookup({ 'a.example': [PUBLIC_IP] }),
    transportImpl: async (opts) => {
      calls.push(opts);
      return streamResponse({ body: 'pinned-body' });
    },
  });
  assert.equal(result.ok, true, `transportImpl 路径应成功，实际=${JSON.stringify(result).slice(0, 200)}`);
  assert.equal(result.text, 'pinned-body');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].host, 'a.example');
  assert.deepEqual(calls[0].addresses, [PUBLIC_IP]);
});

test('red: transportImpl 缺省时默认通道走 pinned node transport（当前实现必红）', async () => {
  assert.equal(typeof policy.defaultTransport, 'function', 'web-fetch-policy 应导出 defaultTransport');
  assert.equal(typeof policy.pinnedLookupFor, 'function', 'web-fetch-policy 应导出 pinnedLookupFor');
});

test('pinnedLookupFor 对任何 hostname 只回已 pin 地址（rebind-proof 核心属性）', () => {
  const lookup = policy.pinnedLookupFor([{ address: PUBLIC_IP, family: 4 }]);
  // hostname 即使被污染成私网名，也只回 pin 地址——建连层不再信 DNS
  lookup('evil.internal', { all: true }, (err, rows) => {
    assert.ifError(err);
    assert.deepEqual(rows, [{ address: PUBLIC_IP, family: 4 }]);
  });
  lookup('whatever', {}, (err, address, family) => {
    assert.ifError(err);
    assert.equal(address, PUBLIC_IP);
    assert.equal(family, 4);
  });
});

test('重定向第二跳重新解析并重新 pin', async () => {
  const calls = [];
  const result = await policy.guardedFetch('https://a.example/redirect', {
    lookup: fakeLookup({ 'a.example': [PUBLIC_IP], 'b.example': ['1.2.3.4'] }),
    transportImpl: async (opts) => {
      calls.push(opts);
      if (calls.length === 1) {
        return streamResponse({ status: 302, headers: { location: 'https://b.example/x' }, body: '' });
      }
      return streamResponse({ body: 'second-hop' });
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 200));
  assert.equal(result.text, 'second-hop');
  assert.equal(result.finalUrl, 'https://b.example/x');
  assert.deepEqual(calls[1].addresses, ['1.2.3.4']);
  assert.equal(calls[1].host, 'b.example');
});

test('transportImpl 超时错误名映射保持 web_fetch_timeout', async () => {
  const err = new Error('timed out');
  err.name = 'TimeoutError';
  const result = await policy.guardedFetch('https://a.example/slow', {
    lookup: fakeLookup({ 'a.example': [PUBLIC_IP] }),
    transportImpl: async () => { throw err; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'web_fetch_timeout');
  assert.equal(result.retryable, true);
});

test('有界读体：超过 maxBytes 截断且 seenBytes 如实', async () => {
  const big = 'x'.repeat(4096);
  const result = await policy.guardedFetch('https://a.example/big', {
    maxBytes: 1024,
    lookup: fakeLookup({ 'a.example': [PUBLIC_IP] }),
    transportImpl: async () => streamResponse({ body: big }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.equal(result.bytes, 1024);
  assert.equal(result.seenBytes, 4096);
});

test('非 2xx 时不消费的流被关闭（transport 通道不留挂起 socket）', async () => {
  let destroyed = false;
  const stream = new PassThrough();
  const origDestroy = stream.destroy.bind(stream);
  stream.destroy = (...args) => { destroyed = true; return origDestroy(...args); };
  const result = await policy.guardedFetch('https://a.example/404', {
    lookup: fakeLookup({ 'a.example': [PUBLIC_IP] }),
    transportImpl: async () => ({ status: 404, headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'text/plain' : null) }, stream }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'web_fetch_http_error');
  assert.equal(destroyed, true, '早退路径应 destroy 底层流');
});

test('默认通道实连本地 http 服务（bounded 读体回读一致）', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('local-echo');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    // transport 级单测：绕过策略校验，直接打本地回环验证默认通道自身
    const shim = await policy.defaultTransport({
      url: new URL(`http://127.0.0.1:${port}/echo`),
      host: '127.0.0.1',
      addresses: ['127.0.0.1'],
      timeoutMs: 3000,
      maxBytes: 65536,
      headers: {},
    });
    assert.equal(shim.status, 200);
    const chunks = [];
    for await (const c of shim.stream) chunks.push(c);
    assert.equal(Buffer.concat(chunks).toString('utf8'), 'local-echo');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('默认通道超时断开（错误名 TimeoutError）', async () => {
  const server = http.createServer(() => { /* 永不响应 */ });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await assert.rejects(
      policy.defaultTransport({
        url: new URL(`http://127.0.0.1:${port}/slow`),
        host: '127.0.0.1',
        addresses: ['127.0.0.1'],
        timeoutMs: 300,
        maxBytes: 65536,
        headers: {},
      }),
      (err) => err && (err.name === 'TimeoutError' || err.name === 'AbortError'),
    );
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('live smoke：默认通道真实抓取 https://example.com（离线显式 skip）', async (t) => {
  try {
    await Promise.race([
      dns.promises.lookup('example.com'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('dns probe timeout')), 5000)),
    ]);
  } catch {
    t.skip('离线/受限网络：example.com 不可解析，live smoke 显式跳过');
    return;
  }
  const result = await policy.guardedFetch('https://example.com/', { timeoutMs: 8000, maxBytes: 65536 });
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 300));
  assert.equal(result.status, 200);
  assert.ok(result.bytes > 0);
});
