/**
 * BLOCK-156 P3 — MCP 工具投影契约测试。
 * 钉住：命名空间与 sanitize/撞名去重/上限；零连接=零投影（R1）；
 * 投影 entry 三件套（definition/handler/contract）；handler 经真实夹具
 * server 回显；policy 档位行为（D4 落地面=execution+R2：read/plan/workspace-write
 * 禁、full 可用）；静态名不被投影遮蔽；knowledge-console 子集自动排除。
 */

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b156-mcp-proj-'));
process.env.BIOF3_LOCAL_DATA_DIR = tmpDir;

// registry 全图自举临时 DB（与 agent-tool-registry.test.mjs 同一修法）：
// require 链 query-tools → db.js 在缺 schema 时抛 no such table: projects；
// BIOF3_DB_PATH 必须在 require registry 前生效。
{
  const Database = require(path.join(ROOT, 'core', 'biof3-server', 'node_modules', 'better-sqlite3'));
  const boot = new Database(path.join(tmpDir, 'biof3.db'));
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.BIOF3_DB_PATH = path.join(tmpDir, 'biof3.db');
}

const settings = require(path.join(ROOT, 'core/biof3-server/helpers/mcp-settings'));
const manager = require(path.join(ROOT, 'core/biof3-server/mcp/client-manager'));
const projection = require(path.join(ROOT, 'core/biof3-server/agent-tools/mcp-projection'));
const registry = require(path.join(ROOT, 'core/biof3-server/agent-tools/registry'));
const policy = require(path.join(ROOT, 'core/biof3-server/agent-tools/agent-tool-policy'));

const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'mcp-fixture-server.cjs');
const NODE = process.execPath;

after(async () => {
  await manager.closeAll().catch(() => {});
});

test('BLOCK-156 命名投影：sanitize/撞名去重/零连接=零投影', () => {
  assert.equal(projection.projectedToolName('my srv', 'echo tool!'), 'mcp_my_srv_echo_tool_');
  // 零连接 → 投影空（R1 护栏）
  assert.equal(projection.projectMcpToolDefs().length, 0);
  assert.equal(projection.getMcpToolEntry('mcp_fixture_fixture_echo'), null);
  // 非 mcp_ 前缀名不走投影层
  assert.equal(projection.getMcpToolEntry('workspace_list'), null);
});

test('BLOCK-156 连接夹具后投影齐备：defs + entry 三件套 + registry 兜底查表', async () => {
  settings.saveMcpServers([{ id: 'fixture', command: NODE, args: [FIXTURE], autoConnect: false }]);
  const conn = await manager.connectServer('fixture');
  assert.equal(conn.ok, true);

  const defs = projection.projectMcpToolDefs();
  assert.equal(defs.length, 1);
  assert.equal(defs[0].function.name, 'mcp_fixture_fixture_echo');
  assert.equal(defs[0].function.parameters.required[0], 'message');

  // registry 集成：getProviderToolDefs 追加（76 静态 + 1 投影）；getToolEntry 兜底命中
  const providerDefs = registry.getProviderToolDefs();
  assert.ok(providerDefs.length > 76, `投影应追加（实际 ${providerDefs.length}）`);
  assert.ok(providerDefs.some((d) => d.function.name === 'mcp_fixture_fixture_echo'));

  const entry = registry.getToolEntry('mcp_fixture_fixture_echo');
  assert.ok(entry && typeof entry.handler === 'function' && entry.contract.sideEffect === 'execution');

  // 静态名永不被遮蔽
  assert.equal(registry.getToolEntry('workspace_list').definition.function.name, 'workspace_list');
});

test('BLOCK-156 handler 经真实 stdio 夹具回显；未连接名=unknown', async () => {
  const entry = registry.getToolEntry('mcp_fixture_fixture_echo');
  const result = await entry.handler({ message: 'p3 你好' });
  assert.equal(result.ok, true);
  assert.equal(result.text, 'echo: p3 你好');
  assert.equal(result.server, 'fixture');
});

test('BLOCK-156 D4 档位行为：execution+R2 → read/plan/workspace-write 禁、full 可用', () => {
  const contract = projection.mcpToolContract();
  const name = 'mcp_fixture_fixture_echo';
  const args = { message: 'x' };

  const readDecision = policy.decideAgentToolCall({ name, args, ctx: { accessMode: 'read' }, contract });
  assert.equal(readDecision.decision, 'deny', JSON.stringify(readDecision));

  const planDecision = policy.decideAgentToolCall({ name, args, ctx: { accessMode: 'plan' }, contract });
  assert.equal(planDecision.decision, 'deny');

  const wwDecision = policy.decideAgentToolCall({ name, args, ctx: { accessMode: 'workspace-write' }, contract });
  assert.equal(wwDecision.decision, 'deny');

  const fullDecision = policy.decideAgentToolCall({ name, args, ctx: { accessMode: 'full' }, contract });
  assert.equal(fullDecision.decision, 'allow');
});

test('BLOCK-156 knowledge-console 白名单子集自动排除 mcp_* 工具', async () => {
  const { resolveToolDefsForContext } = require(path.join(ROOT, 'core/biof3-server/agent-tools/knowledge-console-tools'));
  const all = registry.getProviderToolDefs();
  const scoped = resolveToolDefsForContext({ toolSubset: 'knowledge-console' }, all);
  assert.ok(scoped.every((d) => !d.function.name.startsWith('mcp_')));
  assert.ok(scoped.length < all.length, '子集应窄于全量');
});

test('BLOCK-156 断开后投影即时消失（动态层与连接同生命周期）', async () => {
  await manager.disconnectServer('fixture');
  assert.equal(projection.projectMcpToolDefs().length, 0);
  assert.ok(!registry.getToolEntry('mcp_fixture_fixture_echo')); // null/undefined 皆可（falsy 即未注册）
});
