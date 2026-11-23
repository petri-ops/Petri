/**
 * QODER-J4 MCP 信任/OAuth 余项 — P1 纯函数 HK-01（2026-11-23）。
 *
 * 用户发令一次性推完剩余6项；J4 范围=agent 侧 authenticate 余项 + 项目级默认策略。
 * D1 默认=ask（现状零变化）/ D2 工具 needsApproval=true（外部可见动作事前声明）。
 * 红线：不读写 token（mcp-oauth-store 已封装）、URL 不落日志/审计、不碰凭据存储。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = path.join(ROOT, 'core', 'shared-backend', 'mcp-agent-auth-request.js');
const load = () => require(MODULE);

test('J4 P1 模块存在且零新依赖', () => {
  assert.ok(fs.existsSync(MODULE), '须有 mcp-agent-auth-request.js');
  const s = fs.readFileSync(MODULE, 'utf8');
  assert.doesNotMatch(s, /require\(['"](?!\.\.?\/|node:)/, '不得引入非本地/非 node 新依赖');
});

test('authenticate 请求校验：仅 http/sse 远程服务可发起，不碰 token', () => {
  const { validateAuthRequest } = load();
  const ok = validateAuthRequest({ serverId: 'srv1', transport: 'http', redirectBase: 'http://127.0.0.1:3000/cb' });
  assert.equal(ok.ok, true);
  assert.equal(ok.needsApproval, true, 'D2：外部可见动作须事前声明审批');
  assert.equal(validateAuthRequest({ serverId: 'srv1', transport: 'stdio' }).ok, false, 'stdio 不需要 OAuth');
  assert.equal(validateAuthRequest({ serverId: '', transport: 'http' }).ok, false);
});

test('URL 不落日志：投影只含状态与 serverId，不含 authorizationUrl/token', () => {
  const { publicAuthOutcome } = load();
  const view = publicAuthOutcome({ serverId: 'srv1', authorizationUrl: 'https://idp/authorize?secret=XYZ', token: 'abc', status: 'pending' });
  assert.equal(view.serverId, 'srv1');
  assert.equal(view.status, 'pending');
  assert.ok(!JSON.stringify(view).includes('secret'));
  assert.ok(!JSON.stringify(view).includes('abc'));
  assert.ok(!Object.prototype.hasOwnProperty.call(view, 'authorizationUrl'));
});

test('项目级默认策略：缺省=ask 零变化，非法值回落 ask', () => {
  const { resolveProjectMcpDefault } = load();
  assert.equal(resolveProjectMcpDefault(undefined), 'ask');
  assert.equal(resolveProjectMcpDefault({}), 'ask');
  assert.equal(resolveProjectMcpDefault({ mcpDefaultTrust: 'allow' }), 'allow');
  assert.equal(resolveProjectMcpDefault({ mcpDefaultTrust: 'bogus' }), 'ask', '非法值回落 ask');
});

test('红线：既有凭据存储与 handler 未改', () => {
  const store = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/mcp-oauth-store.js'), 'utf8');
  const policy = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/mcp-server-policy.js'), 'utf8');
  assert.match(store, /encryptTokens|decryptOrEmpty/, 'token 加密链仍在');
  assert.match(policy, /trust:\s*'ask'/, '既有默认 ask 仍在');
});
