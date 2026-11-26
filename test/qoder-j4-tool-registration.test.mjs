/**
 * QODER-J4 工具注册 — HK-01 契约（2026-11-23）。
 *
 * 用户发令「开始 J4 工具注册」：把 P1 核心（mcp-agent-auth-request.js）注册为真实
 * agent 工具 mcp_authenticate：schema + handler（委托既有 beginAuthorization，不碰 token）
 * + metadata + registry 三方互查 + 工具数 119→120。
 * 红线：不读写 token、authorizationUrl 不进工具返回/审计、不改 handler/凭据。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HANDLER = path.join(ROOT, 'core/petri-server/agent-tools/mcp-auth-tools.js');
const SCHEMA = path.join(ROOT, 'core/petri-server/agent-tools/tool-defs/mcp.js');
const read = (p) => fs.readFileSync(p, 'utf8');

test('J4 工具注册：schema/handler/metadata/registry 四处齐备', () => {
  assert.ok(fs.existsSync(SCHEMA), '须有 tool-defs/mcp.js');
  assert.ok(fs.existsSync(HANDLER), '须有 mcp-auth-tools.js');
  assert.match(read(SCHEMA), /mcp_authenticate/);
  const registry = read(path.join(ROOT, 'core/petri-server/agent-tools/registry.js'));
  assert.match(registry, /mcp_authenticate/, 'registry HANDLERS/CONTRACTS 须登记');
  const metadata = read(path.join(ROOT, 'core/petri-server/agent-tools/tool-metadata.js'));
  assert.match(metadata, /mcp_authenticate/, 'metadata 须登记');
  const defs = read(path.join(ROOT, 'core/petri-server/agent-tools/tool-defs.js'));
  assert.match(defs, /tool-defs\/mcp/, 'defs facade 须汇编 mcp 域');
});

test('handler 委托既有 beginAuthorization + P1 校验 + 不泄漏 URL/token', async () => {
  const { createMcpAuthTools } = require(HANDLER);
  let called = null;
  const managerStub = {
    beginAuthorization: async (id, opts) => {
      called = { id, opts };
      return { ok: true, status: 'redirect', authorizationUrl: 'https://idp/authorize?secret=XYZ' };
    },
  };
  const settingsStub = { getMcpServer: (id) => ({ id, transport: 'http' }) };
  const tools = createMcpAuthTools({ manager: managerStub, settings: settingsStub });
  const out = await tools.mcpAuthenticate({ serverId: 'srv1' }, {});
  assert.equal(out.ok, true);
  assert.equal(called.id, 'srv1');
  assert.equal(typeof called.opts.redirectBase, 'string', '须传 redirectBase');
  assert.ok(!JSON.stringify(out).includes('secret'), 'authorizationUrl 不得进工具返回');
  assert.equal(out.status, 'redirect');
  assert.equal(out.serverId, 'srv1');
});

test('handler 拒绝：stdio / 未配置服务 / 非法 redirectBase 不触发 beginAuthorization', async () => {
  const { createMcpAuthTools } = require(HANDLER);
  let calls = 0;
  const managerStub = { beginAuthorization: async () => { calls += 1; return { ok: true, status: 'redirect' }; } };
  const settingsStub = { getMcpServer: (id) => (id === 'stdio1' ? { id, transport: 'stdio' } : id === 'remote1' ? { id, transport: 'http' } : null) };
  const tools = createMcpAuthTools({ manager: managerStub, settings: settingsStub });
  assert.equal((await tools.mcpAuthenticate({ serverId: 'stdio1' }, {})).ok, false);
  assert.equal((await tools.mcpAuthenticate({ serverId: 'nope' }, {})).ok, false);
  assert.equal((await tools.mcpAuthenticate({ serverId: 'remote1', redirectBase: 'file:///evil' }, {})).ok, false);
  assert.equal(calls, 0, '非法请求不得触发真实 OAuth 发起');
});

test('工具数 120→123（内置创作包三工具，两处断言同步）', () => {
  const t = read(path.join(ROOT, 'test/agent-tool-registry.test.mjs'));
  assert.equal((t.match(/!== 123/g) || []).length, 1, 'getToolDefs 断言须 123');
  assert.equal((t.match(/tools\.length, 123/g) || []).length, 1, 'receivedBody 断言须 123');
});

test('红线：凭据存储/OAuth handler 未改', () => {
  const store = read(path.join(ROOT, 'core/petri-server/helpers/mcp-oauth-store.js'));
  const route = read(path.join(ROOT, 'core/petri-server/routes/mcp-client.js'));
  assert.match(store, /encryptTokens/);
  assert.match(route, /beginAuthorization/);
});
