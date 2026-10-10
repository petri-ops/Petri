'use strict';

/**
 * BLOCK-159 P0-1 — mobile-gateway 生产路径 gzip 压缩契约。
 *
 * 诊断（plan §1）：压缩此前只在 dev Vite 代理路径存在，生产 dist 资产与全部
 * API JSON 裸传过隧道（首屏 ~1.5-2MB）=「慢」的最大单项。
 *
 * 契约：
 *  ① shouldCompressBuffer 纯函数：阈值/已编码/HEAD/非文本族/SSE 跳过规则。
 *  ② createGzipResponseMiddleware：大 JSON 按 accept-encoding gzip（wire 级
 *     Content-Encoding + 内容 gunzip 后逐字节一致）；小响应与无 gzip 客户端
 *     透传；SSE（event-stream）绝不压缩。
 *  ③ createGzipAssetHandler：/assets 压缩族资产 gzip + immutable 缓存头；
 *     非 gzip 客户端 / 非压缩族扩展名 fallthrough express.static；路径穿越
 *     拒绝；缓存有界（超限淘汰，行为上仍可继续服务新资产）。
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPRESS_PATH = path.join(ROOT, 'core/petri-server/mobile-gateway/compress.js');

const {
  shouldCompressBuffer,
  createGzipResponseMiddleware,
  createGzipAssetHandler,
  COMPRESSIBLE_ASSET_EXTENSIONS,
} = require(COMPRESS_PATH);
const express = require('express');

/** wire 级请求（不走 undici：拿原始字节与响应头，不受自动解压干扰）。 */
function rawRequest(port, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ port, path: requestPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
  });
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

const GZIP_HEADERS = { 'accept-encoding': 'gzip' };

// ── ① 纯函数规则 ─────────────────────────────────────────────────────────

test('BLOCK-159 ① shouldCompressBuffer：阈值/已编码/HEAD/非文本族跳过', () => {
  const base = { contentType: 'application/json; charset=utf-8', byteLength: 4096, accepts: true };
  assert.equal(shouldCompressBuffer(base), true, '大 JSON 压缩');
  assert.equal(shouldCompressBuffer({ ...base, byteLength: 1024 }), true, '恰好阈值压缩');
  assert.equal(shouldCompressBuffer({ ...base, byteLength: 1023 }), false, '小于阈值跳过');
  assert.equal(shouldCompressBuffer({ ...base, accepts: false }), false, '客户端不收 gzip 跳过');
  assert.equal(shouldCompressBuffer({ ...base, contentEncoding: 'gzip' }), false, '已编码跳过');
  assert.equal(shouldCompressBuffer({ ...base, method: 'HEAD' }), false, 'HEAD 跳过');
  assert.equal(shouldCompressBuffer({ ...base, contentType: 'text/event-stream' }), false, 'SSE 跳过');
  assert.equal(shouldCompressBuffer({ ...base, contentType: 'image/png' }), false, '二进制族跳过');
});

// ── ② buffered 响应中间件 ────────────────────────────────────────────────

test('BLOCK-159 ② gzip 响应中间件：大 JSON wire 级压缩、小响应与 SSE 透传', async () => {
  const app = express();
  app.use(createGzipResponseMiddleware());
  app.get('/big.json', (_req, res) => { res.json({ data: 'x'.repeat(16 * 1024) }); });
  app.get('/small', (_req, res) => { res.json({ tiny: true }); });
  app.get('/stream', (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.write(`data: ${'y'.repeat(4096)}\n\n`);
    res.end();
  });
  const { port, close } = await listen(app);
  try {
    const big = await rawRequest(port, '/big.json', GZIP_HEADERS);
    assert.equal(big.headers['content-encoding'], 'gzip', '大 JSON 必须带 Content-Encoding: gzip');
    const plain = zlib.gunzipSync(big.body).toString('utf8');
    assert.ok(plain.startsWith('{"data":"xxx'), 'gunzip 后内容与原始 JSON 一致');

    const small = await rawRequest(port, '/small', GZIP_HEADERS);
    assert.equal(small.headers['content-encoding'], undefined, '小于阈值不压缩');
    assert.ok(small.body.toString('utf8').includes('"tiny"'), '小响应原样可读');

    const stream = await rawRequest(port, '/stream', GZIP_HEADERS);
    assert.equal(stream.headers['content-encoding'], undefined, 'SSE 绝不压缩');
    assert.ok(stream.body.toString('utf8').startsWith('data: '), 'SSE 帧原样');
  } finally {
    await close();
  }
});

test('BLOCK-159 ② 无 gzip 客户端：响应原样（无 Content-Encoding）', async () => {
  const app = express();
  app.use(createGzipResponseMiddleware());
  app.get('/big.json', (_req, res) => { res.json({ data: 'x'.repeat(16 * 1024) }); });
  const { port, close } = await listen(app);
  try {
    const res = await rawRequest(port, '/big.json', { 'accept-encoding': 'identity' });
    assert.equal(res.headers['content-encoding'], undefined);
    assert.ok(res.body.toString('utf8').includes('"data"'), '原样 JSON');
  } finally {
    await close();
  }
});

// ── ③ 静态资产处理器 ─────────────────────────────────────────────────────

test('BLOCK-159 ③ /assets gzip：压缩族 gzip+immutable、png/非 gzip 客户端透传、穿越拒绝、缓存有界', async () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'petri-compress-dist-'));
  const assets = path.join(dist, 'assets');
  mkdirSync(assets);
  writeFileSync(path.join(assets, 'app.js'), `console.log("${'a'.repeat(4096)}");`);
  writeFileSync(path.join(assets, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const secretOutside = path.join(dist, 'secret.txt');
  writeFileSync(secretOutside, 'secret');
  const app = express();
  app.use('/assets', createGzipAssetHandler(dist, { cacheMaxBytes: 64 * 1024 }));
  app.use('/assets', express.static(assets));
  const { port, close } = await listen(app);
  try {
    const js = await rawRequest(port, '/assets/app.js', GZIP_HEADERS);
    assert.equal(js.status, 200);
    assert.equal(js.headers['content-encoding'], 'gzip', '压缩族资产必须 gzip');
    assert.equal(js.headers['cache-control'], 'public, max-age=31536000, immutable', 'immutable 头保持');
    assert.ok(zlib.gunzipSync(js.body).toString('utf8').includes('console.log'), '内容一致');

    const png = await rawRequest(port, '/assets/logo.png', GZIP_HEADERS);
    assert.equal(png.headers['content-encoding'], undefined, '非压缩族扩展名透传静态');
    assert.equal(png.status, 200);

    const identity = await rawRequest(port, '/assets/app.js', { 'accept-encoding': 'identity' });
    assert.equal(identity.headers['content-encoding'], undefined, '非 gzip 客户端透传 express.static');
    assert.ok(identity.body.length > 4096, '原样字节');

    const evil = await rawRequest(port, '/assets/..%2Fsecret.txt', GZIP_HEADERS);
    assert.ok(evil.status === 404 || evil.headers['content-encoding'] === undefined, '路径穿越不落压缩处理器');

    // 缓存有界：cacheMaxBytes=64KB，单资产远小于上限，连续服务多个资产不炸
    writeFileSync(path.join(assets, 'b.js'), `console.log("${'b'.repeat(4096)}");`);
    const b = await rawRequest(port, '/assets/b.js', GZIP_HEADERS);
    assert.equal(b.headers['content-encoding'], 'gzip', '缓存淘汰后新资产照常服务');

    assert.ok(COMPRESSIBLE_ASSET_EXTENSIONS.has('.js'), '.js 在压缩族清单');
  } finally {
    await close();
    rmSync(dist, { recursive: true, force: true });
  }
});
