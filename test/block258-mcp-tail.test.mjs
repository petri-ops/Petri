/**
 * BLOCK-258 Q8-REM — MCP 尾项契约测试。
 *
 * 覆盖：SSE 传输（含自定义 Header 全链）、headers 密文/脱敏/导出剥离/导入保留、
 * 传输/Header 校验、OAuth 本地撤销（保留/清除 client 注册）与 REST 路由。
 */

import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import { startMcpSseServer } from './fixtures/mcp-sse-server.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b258-mcp-tail-'));
process.env.PETRI_LOCAL_DATA_DIR = tmpDir;

const settings = require(path.join(ROOT, 'core/petri-server/helpers/mcp-settings'));
const manager = require(path.join(ROOT, 'core/petri-server/mcp/client-manager'));
const oauthStore = require(path.join(ROOT, 'core/petri-server/helpers/mcp-oauth-store'));
const { registerMcpClientRoutes } = require(path.join(ROOT, 'core/petri-server/routes/mcp-client'));

let sseFixture = null;
let apiServer = null;
let apiBase = '';

function statusOf(id) {
  return manager.getStatuses().find((row) => row.id === id);
}

before(async () => {
  sseFixture = await startMcpSseServer();
  const app = express();
  registerMcpClientRoutes(app);
  apiServer = await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  apiBase = `http://127.0.0.1:${apiServer.address().port}`;
});

after(async () => {
  await manager.closeAll().catch(() => {});
  await new Promise((resolve) => apiServer.close(resolve));
  await sseFixture.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('BLOCK-258 — 配置校验：SSE 缺 url / stdio 带 headers / 非法 Header 全拒', () => {
  assert.equal(settings.upsertMcpServer({ id: 'sse-bad', transport: 'sse' }).error, 'sse_url_required');
  assert.equal(
    settings.upsertMcpServer({ id: 'std-headers', command: 'node', headers: { 'x-a': '1' } }).error,
    'headers_require_remote',
  );
  const base = { id: 'sse-header-bad', transport: 'sse', url: 'http://127.0.0.1:1/sse' };
  assert.equal(settings.upsertMcpServer({ ...base, headers: { 'bad header': 'x' } }).error, 'invalid_header_name');
  assert.equal(settings.upsertMcpServer({ ...base, headers: { 'x-a': 'a\r\nb' } }).error, 'invalid_header_value');
  assert.equal(settings.upsertMcpServer({ ...base, headers: { 'content-type': 'x' } }).error, 'reserved_header:content-type');
  assert.equal(
    settings.upsertMcpServer({ ...base, headers: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`x-${i}`, 'v'])) }).error,
    'too_many_headers',
  );
});

test('BLOCK-258 — headers 落盘密文/读回明文/状态只透键名/导出剥离/导入按 id 保留', () => {
  const saved = settings.upsertMcpServer({
    id: 'remote-headers',
    transport: 'http',
    url: 'http://127.0.0.1:1/mcp',
    headers: { 'X-Api-Key': 'sk-header-secret', 'X-Trace': 'trace-1' },
    autoConnect: false,
  });
  assert.equal(saved.error, undefined, JSON.stringify(saved));

  const onDisk = JSON.parse(fs.readFileSync(settings.SETTINGS_FILE, 'utf8'));
  const persisted = onDisk.servers.find((s) => s.id === 'remote-headers');
  assert.match(persisted.headers['x-api-key'], /^enc:v1:/, 'headers 落盘必须密文');
  assert.ok(!JSON.stringify(persisted.headers).includes('sk-header-secret'), '落盘不得出现明文');

  const listed = settings.listMcpServers().find((s) => s.id === 'remote-headers');
  assert.deepEqual(listed.headers, { 'x-api-key': 'sk-header-secret', 'x-trace': 'trace-1' });

  const exported = settings.listMcpServersForExport().find((s) => s.id === 'remote-headers');
  assert.equal(exported.headers, undefined, '导出不得带 headers');

  const row = statusOf('remote-headers');
  assert.deepEqual(row.headerKeys, ['x-api-key', 'x-trace']);
  assert.equal(row.headerCount, 2);
  assert.ok(!JSON.stringify(row).includes('sk-header-secret'), '状态面不得出现 header 值');

  const { validateImport, importConfig } = require(path.join(ROOT, 'core/petri-server/helpers/config-transfer.js'));
  const envelope = (servers) => ({ format: 'petri-config', version: 1, families: { 'mcp-servers': { servers } } });
  const withHeaders = validateImport(envelope([{ id: 'remote-headers', transport: 'http', url: 'http://127.0.0.1:1/mcp', headers: { 'x-a': 'plain' } }]));
  assert.equal(withHeaders.ok, false);
  assert.ok(withHeaders.diagnostics.some((d) => d.path === 'servers[0].headers' && d.code === 'not-allowed'));

  const applied = importConfig(envelope([{ id: 'remote-headers', transport: 'http', url: 'http://127.0.0.1:1/mcp' }]));
  assert.equal(applied.ok, true, JSON.stringify(applied));
  const afterImport = settings.listMcpServers().find((s) => s.id === 'remote-headers');
  assert.deepEqual(afterImport.headers, { 'x-api-key': 'sk-header-secret', 'x-trace': 'trace-1' }, '导入不得清空已有 headers');

  // 导入把同一 id 改成 stdio：旧 headers 属于远程凭据，必须丢弃而不是让导入失败
  const toStdio = importConfig(envelope([{ id: 'remote-headers', command: 'node', args: ['x.js'] }]));
  assert.equal(toStdio.ok, true, JSON.stringify(toStdio));
  const stdioAfter = settings.listMcpServers().find((s) => s.id === 'remote-headers');
  assert.equal(stdioAfter.transport, 'stdio');
  assert.equal(stdioAfter.headers, undefined, 'stdio 不得继承远程 headers');
});

test('BLOCK-258 — SSE：自定义 Header 同时作用于长连接与 POST；工具可列可调', async () => {
  const saved = settings.upsertMcpServer({
    id: 'sse-ok',
    command: 'sse',
    transport: 'sse',
    url: sseFixture.url,
    headers: { [sseFixture.header]: sseFixture.key },
    autoConnect: false,
  });
  assert.equal(saved.error, undefined, JSON.stringify(saved));

  const conn = await manager.connectServer('sse-ok');
  assert.equal(conn.ok, true, JSON.stringify(conn));
  assert.equal(conn.toolCount, 1);
  const row = statusOf('sse-ok');
  assert.equal(row.transport, 'sse');
  assert.equal(row.status, 'connected');
  assert.deepEqual(row.headerKeys, [sseFixture.header]);

  const called = await manager.callServerTool('sse-ok', 'sse_ping', { message: 'hi' });
  assert.equal(called.ok, true, JSON.stringify(called));
  assert.equal(called.result.content[0].text, 'pong:hi');
  await manager.disconnectServer('sse-ok');
});

test('BLOCK-258 — SSE 缺 Header 连接失败（证明 headers 真被发送）', async () => {
  const saved = settings.upsertMcpServer({
    id: 'sse-noheader',
    command: 'sse',
    transport: 'sse',
    url: sseFixture.url,
    autoConnect: false,
  });
  assert.equal(saved.error, undefined, JSON.stringify(saved));
  const conn = await manager.connectServer('sse-noheader');
  assert.equal(conn.ok, false, JSON.stringify(conn));
  const row = statusOf('sse-noheader');
  assert.equal(row.status, 'error');
  assert.equal(row.toolCount, 0);
});

test('BLOCK-258 — OAuth 本地撤销：清 tokens/verifier/pending，默认保留 client', async () => {
  settings.upsertMcpServer({
    id: 'oauth-revoke',
    command: 'http',
    transport: 'http',
    url: 'http://127.0.0.1:9/mcp',
    autoConnect: false,
  });
  oauthStore.updateEntry('oauth-revoke', () => ({
    clientInformation: { client_id: 'client-1', client_secret: 'secret-1' },
    tokens: { access_token: 'tok-1', refresh_token: 'refresh-1', token_type: 'Bearer' },
    codeVerifier: 'verifier-1',
  }));
  assert.equal(statusOf('oauth-revoke').auth, 'authorized');

  const revoked = await manager.revokeAuthorization('oauth-revoke');
  assert.equal(revoked.ok, true, JSON.stringify(revoked));
  const entry = oauthStore.readEntry('oauth-revoke');
  assert.equal(entry.tokens, null, 'tokens 必须清空');
  assert.equal(entry.codeVerifier, null, 'verifier 必须清空');
  assert.equal(entry.pending, null, 'pending 必须清空');
  assert.equal(entry.clientInformation.client_id, 'client-1', '默认保留动态注册 client');
  assert.notEqual(statusOf('oauth-revoke').auth, 'authorized');

  const forgotten = await manager.revokeAuthorization('oauth-revoke', { forgetClient: true });
  assert.equal(forgotten.ok, true, JSON.stringify(forgotten));
  assert.ok(!oauthStore.readEntry('oauth-revoke').clientInformation, 'forgetClient 时整条清除');
});

test('BLOCK-258 — REST 撤销路由：200/400/404 与诚实边界', async () => {
  settings.upsertMcpServer({ id: 'std-revoke', command: 'node', args: ['-e', '0'], autoConnect: false });
  oauthStore.updateEntry('oauth-revoke', () => ({
    clientInformation: { client_id: 'client-1' },
    tokens: { access_token: 'tok-2', token_type: 'Bearer' },
  }));

  const ok = await fetch(`${apiBase}/api/mcp/servers/oauth-revoke/oauth/revoke`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
  });
  const body = await ok.json();
  assert.equal(ok.status, 200, JSON.stringify(body));
  assert.equal(body.revoked, true);
  assert.match(String(body.note), /服务端令牌在过期前可能仍有效/);

  const stdio = await fetch(`${apiBase}/api/mcp/servers/std-revoke/oauth/revoke`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
  });
  assert.equal(stdio.status, 400);
  assert.equal((await stdio.json()).error, 'oauth_requires_remote');

  const missing = await fetch(`${apiBase}/api/mcp/servers/no-such-server/oauth/revoke`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
  });
  assert.equal(missing.status, 404);
});
