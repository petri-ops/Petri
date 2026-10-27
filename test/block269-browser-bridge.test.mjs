import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// BLOCK-269（C-40 尾项）— 浏览器连接器前端桥契约：
// transport（SSE 下发 + 回传 resolve + 超时）+ REST 四面（与 agent 工具同源）+ 回传面（未知 404）。

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b269-bridge-'));
process.env.PETRI_LOCAL_DATA_DIR = tempDir;

const tools = require('../core/petri-server/agent-tools/browser-tools.js');
const connector = require('../core/petri-server/helpers/browser-connector.js');
const bus = require('../core/petri-server/helpers/event-bus.js');
const registerBrowserConnector = require('../core/petri-server/routes/browser-connector.js');

test.after(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// 捕获下发载荷（publish 仍照常广播）
let lastPublished = null;
const origPublish = bus.publishInvalidation;
bus.publishInvalidation = (domain, payload) => {
  if (domain === 'browser-connector') lastPublished = payload;
  return origPublish(domain, payload);
};

async function makeServer() {
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 'local-user' }; next(); });
  registerBrowserConnector(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => {
    const resp = await fetch(base + p, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await resp.json(); } catch { /* non-json */ }
    return { status: resp.status, data };
  };
  return { server, call };
}

test('b269: transport 下发→回传 resolve 全链（act 收敛 ok + 白名单计数）', async () => {
  connector.connect({ allowedOrigins: ['https://example.com'] });
  const actPromise = tools.browser_act({ action: 'navigate', url: 'https://example.com/demo' });
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(lastPublished, 'SSE 下发发生');
  assert.equal(lastPublished.kind, 'browser-action');
  assert.equal(lastPublished.params.action, 'navigate');
  assert.equal(lastPublished.params.url, 'https://example.com/demo');
  assert.equal(typeof lastPublished.actionId, 'string');
  assert.equal(tools.pendingCount(), 1);
  const resolved = tools.resolveBrowserAction(lastPublished.actionId, { ok: true, result: { url: 'https://example.com/demo' } });
  assert.equal(resolved, true);
  const outcome = await actPromise;
  assert.equal(outcome.ok, true);
  assert.equal(outcome.action, 'navigate');
  const status = connector.status();
  assert.equal(status.actionsPerformed, 1);
  assert.equal(status.lastUrl, 'https://example.com/demo');
  assert.equal(tools.pendingCount(), 0);
});

test('b269: 回传错误态 resolve → act 如实失败', async () => {
  connector.connect({});
  const actPromise = tools.browser_act({ action: 'navigate', url: 'https://example.com/x' });
  await new Promise((r) => setTimeout(r, 30));
  tools.resolveBrowserAction(lastPublished.actionId, { ok: false, error: 'webview_not_ready' });
  const outcome = await actPromise;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error, 'webview_not_ready');
});

test('b269: 面板不回传 → 超时 transport_timeout（短超时注入）', async () => {
  connector.connect({});
  const transport = tools._createTransport(80);
  const outcome = await transport.perform({ action: 'read_text' });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error, 'transport_timeout');
  assert.equal(tools.pendingCount(), 0);
});

test('b269: 未知 actionId resolve 返回 false（回传面 404 基础）', () => {
  assert.equal(tools.resolveBrowserAction('ba-unknown', { ok: true }), false);
});

test('b269: REST 四面 + 回传面（同源执行面语义）', async () => {
  const { server, call } = await makeServer();
  try {
    connector.disconnect(); // 模块级 session 跨测试残留清场
    // 未连接 → act 拒
    let resp = await call('POST', '/api/browser-connector/act', { action: 'navigate', url: 'https://example.com/' });
    assert.equal(resp.data.error, 'browser_not_connected');

    // connect + 私网硬拒
    resp = await call('POST', '/api/browser-connector/connect', { allowedOrigins: ['https://example.com'] });
    assert.equal(resp.status, 200);
    assert.equal(resp.data.ok, true);
    resp = await call('POST', '/api/browser-connector/act', { action: 'navigate', url: 'http://127.0.0.1:8080/admin' });
    assert.equal(resp.data.error, 'web_url_private_host');
    // 白名单外 origin 拒
    resp = await call('POST', '/api/browser-connector/act', { action: 'navigate', url: 'https://other.example.net/a' });
    assert.equal(resp.data.error, 'origin_not_allowed');
    // mutating 无 ackToken 拒
    resp = await call('POST', '/api/browser-connector/act', { action: 'click', selector: '#go' });
    assert.equal(resp.data.error, 'ack_token_required');

    // 全链：act navigate → POST action-result → act ok
    const actPromise = call('POST', '/api/browser-connector/act', { action: 'navigate', url: 'https://example.com/bridge' });
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(lastPublished && lastPublished.actionId);
    resp = await call('POST', '/api/browser-connector/action-result', {
      actionId: lastPublished.actionId, ok: true, result: { url: 'https://example.com/bridge' },
    });
    assert.equal(resp.status, 200);
    const outcome = (await actPromise).data;
    assert.equal(outcome.ok, true);

    // status 与 disconnect
    resp = await call('GET', '/api/browser-connector/status');
    assert.equal(resp.data.connected, true);
    assert.equal(resp.data.actionsPerformed, 1);
    resp = await call('POST', '/api/browser-connector/disconnect');
    assert.equal(resp.data.ok, true);
    resp = await call('GET', '/api/browser-connector/status');
    assert.equal(resp.data.connected, false);

    // 回传面守卫：缺 actionId 400 / 未知 404
    resp = await call('POST', '/api/browser-connector/action-result', {});
    assert.equal(resp.status, 400);
    resp = await call('POST', '/api/browser-connector/action-result', { actionId: 'ba-none', ok: true });
    assert.equal(resp.status, 404);
  } finally {
    server.close();
  }
});
