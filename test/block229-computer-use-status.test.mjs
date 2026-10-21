/**
 * BLOCK-229 — 电脑控制 sidecar 状态/探针路由。
 * 真实 HTTP：express + mock auth；sidecar 路径指向不存在文件 → built=false / probe 503。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..');

process.env.PETRI_COMPUTER_USE_SIDECAR = path.join(ROOT, 'test', 'no-such-sidecar-binary');

let server;
let baseUrl;

test.before(async () => {
  const express = require('express');
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 'local-user' }; next(); });
  require(path.join(ROOT, 'core/petri-server/routes/computer-use.js'))(app);
  server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => { try { server.close(); } catch {} });

function request(method, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(baseUrl + pathname, { method }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('status：只读、built=false、支持平台与权限提示在场', async () => {
  const { status, body } = await request('GET', '/api/computer-use/status');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.built, false);
  assert.equal(body.supported, true);
  assert.equal(typeof body.permissionNote, 'string');
  assert.ok(body.permissionNote.length > 0);
});

test('probe：sidecar 未构建 → 503 sidecar_not_built（诚实失败）', async () => {
  const { status, body } = await request('POST', '/api/computer-use/probe');
  assert.equal(status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'sidecar_not_built');
});
