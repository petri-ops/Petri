/**
 * BLOCK-239 — MCP OAuth per-server authenticate（HTTP）集成测试。
 *
 * 真实 HTTP 流程：mock OAuth auth server + Bearer 保护的 MCP /mcp。
 * 钉住：无 token → auth_required 且零工具；POST authenticate → 授权 URL →
 * callback（state+PKCE）→ connected + 工具出现；凭据密文落盘；重连复用 token；
 * state 不匹配/stdio/未知 server 可读错误。
 */

import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import { startMcpOAuthServer } from './fixtures/mcp-oauth-server.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b239-mcp-oauth-'));
process.env.PETRI_LOCAL_DATA_DIR = tmpDir;

const settings = require(path.join(ROOT, 'core/petri-server/helpers/mcp-settings'));
const manager = require(path.join(ROOT, 'core/petri-server/mcp/client-manager'));
const { registerMcpClientRoutes } = require(path.join(ROOT, 'core/petri-server/routes/mcp-client'));

let fixture = null;
let apiServer = null;
let apiBase = '';

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function waitFor(fn, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

function statusOf(id) {
  return manager.getStatuses().find((row) => row.id === id);
}

before(async () => {
  fixture = await startMcpOAuthServer();
  const app = express();
  // 路由自身带 express.json()（POST /servers）；这里不能再挂全局 parser，
  // 否则同一请求流被消费两次 → stream is not readable。
  registerMcpClientRoutes(app);
  apiServer = await listen(app);
  apiBase = `http://127.0.0.1:${apiServer.address().port}`;
});

after(async () => {
  await manager.closeAll().catch(() => {});
  await new Promise((resolve) => apiServer.close(resolve));
  await fixture.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('BLOCK-239 — REST 新增 HTTP server 保真 transport/url', async () => {
  const resp = await fetch(`${apiBase}/api/mcp/servers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'oauth-route',
      command: 'ignored',
      transport: 'http',
      url: fixture.mcpUrl,
      autoConnect: false,
    }),
  });
  assert.equal(resp.status, 200);
  const row = statusOf('oauth-route');
  assert.equal(row.transport, 'http');
  assert.equal(row.url, fixture.mcpUrl);
  settings.removeMcpServer('oauth-route');
});

test('BLOCK-239 — 无 token 连接 = auth_required 且工具零投影', async () => {
  const saved = settings.upsertMcpServer({
    id: 'oauth-fixture',
    command: 'ignored',
    transport: 'http',
    url: fixture.mcpUrl,
    autoConnect: false,
  });
  assert.equal(saved.error, undefined, JSON.stringify(saved));

  const conn = await manager.connectServer('oauth-fixture');
  assert.equal(conn.ok, false, JSON.stringify(conn));
  assert.equal(conn.error, 'authorization_required');
  const row = statusOf('oauth-fixture');
  assert.equal(row.status, 'auth_required');
  assert.equal(row.toolCount, 0);
  assert.equal(row.auth, 'required');
});

test('BLOCK-239 — authenticate → 授权 URL → callback → connected + 工具出现', async () => {
  const start = await fetch(`${apiBase}/api/mcp/servers/oauth-fixture/authenticate`, { method: 'POST' });
  assert.equal(start.status, 200);
  const startData = await start.json();
  assert.equal(startData.status, 'redirect', JSON.stringify(startData));
  assert.match(String(startData.authorizationUrl), /^http:\/\/127\.0\.0\.1:/);

  // 模拟系统浏览器：授权服务器自动批准并重定向到本服务的 callback。
  const callback = await fetch(String(startData.authorizationUrl), { redirect: 'follow' });
  assert.equal(callback.status, 200, await callback.text());

  const connected = await waitFor(() => {
    const row = statusOf('oauth-fixture');
    return row && row.status === 'connected' ? row : null;
  });
  assert.ok(connected, 'callback 后应自动重连');
  assert.equal(connected.toolCount, 2);
  assert.equal(connected.auth, 'authorized');

  const raw = fs.readFileSync(path.join(tmpDir, 'mcp-oauth.json'), 'utf8');
  const store = JSON.parse(raw);
  const entry = store.servers['oauth-fixture'];
  assert.ok(entry, 'oauth store 应写入 server 条目');
  assert.ok(String(entry.tokens.access_token).startsWith('enc:v1:'), 'access_token 必须密文落盘');
  assert.ok(!entry.pending, '授权完成后 pending 必须清空');
  assert.ok(!raw.includes('"access_token":"' + entry.tokens.access_token.replace('enc:v1:', '')), '不得出现明文 token');
});

test('BLOCK-239 — 授权后重连复用 token，不再走授权', async () => {
  await manager.disconnectServer('oauth-fixture');
  const conn = await manager.connectServer('oauth-fixture');
  assert.equal(conn.ok, true, JSON.stringify(conn));
  assert.equal(conn.toolCount, 2);
  assert.equal(statusOf('oauth-fixture').auth, 'authorized');
});

test('BLOCK-239 — state 不匹配被拒且不连接', async () => {
  settings.upsertMcpServer({
    id: 'oauth-bad',
    command: 'ignored',
    transport: 'http',
    url: fixture.mcpUrl,
    autoConnect: false,
  });
  await manager.connectServer('oauth-bad');
  const begin = await manager.beginAuthorization('oauth-bad', { redirectBase: apiBase });
  assert.equal(begin.status, 'redirect', JSON.stringify(begin));

  const bad = await fetch(`${apiBase}/api/mcp/oauth/callback/oauth-bad?code=bad&state=wrong`);
  assert.equal(bad.status, 400);
  const row = statusOf('oauth-bad');
  assert.notEqual(row.status, 'connected');
  assert.match(String(row.error), /authorization_state_invalid|authorization_failed/);
});

test('BLOCK-239 — stdio 调授权=400；未知 server=404', async () => {
  settings.upsertMcpServer({ id: 'std-oauth', command: 'node', args: ['-e', 'setTimeout(()=>{},1)'], autoConnect: false });
  const stdio = await fetch(`${apiBase}/api/mcp/servers/std-oauth/authenticate`, { method: 'POST' });
  assert.equal(stdio.status, 400);
  const stdioData = await stdio.json();
  assert.equal(stdioData.error, 'oauth_requires_http');

  const missing = await fetch(`${apiBase}/api/mcp/servers/missing-oauth/authenticate`, { method: 'POST' });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'server_not_found');
});
