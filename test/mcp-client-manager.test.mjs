/**
 * BLOCK-156 P2 — client-manager 连接生命周期测试（stdio + 夹具 MCP server）。
 * 钉住：connect→tools 非空（fixture_echo）/callTool 回显/断开态拒绝调用/
 * 坏命令降级 error 状态不抛（R1 护栏）/getStatuses 配置∪运行态视图。
 */

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b156-mcp-mgr-'));
process.env.BIOF3_LOCAL_DATA_DIR = tmpDir;

const settings = require('../core/biof3-server/helpers/mcp-settings');
const manager = require('../core/biof3-server/mcp/client-manager');

const FIXTURE = path.resolve('test', 'fixtures', 'mcp-fixture-server.cjs');
const NODE = process.execPath;

after(async () => {
  await manager.closeAll().catch(() => {});
});

test('BLOCK-156 connect → tools/list 含 fixture_echo → callTool 回显', async () => {
  settings.saveMcpServers([
    { id: 'fixture', command: NODE, args: [FIXTURE], autoConnect: false },
  ]);

  const conn = await manager.connectServer('fixture');
  assert.equal(conn.ok, true, JSON.stringify(conn));
  // BLOCK-157 CAP-1 — 夹具双工具（fixture_echo + fixture_lookup_readonly）
  assert.equal(conn.toolCount, 2);

  const tools = manager.listServerTools('fixture');
  assert.equal(tools.ok, true);
  assert.equal(tools.tools[0].name, 'fixture_echo');

  const call = await manager.callServerTool('fixture', 'fixture_echo', { message: '你好格物' });
  assert.equal(call.ok, true, JSON.stringify(call));
  assert.equal(call.result.content[0].text, 'echo: 你好格物');
});

test('BLOCK-156 重复连接幂等（alreadyConnected）；断开后调用拒绝', async () => {
  const again = await manager.connectServer('fixture');
  assert.equal(again.ok, true);
  assert.equal(again.alreadyConnected, true);

  const off = await manager.disconnectServer('fixture');
  assert.equal(off.ok, true);
  const refused = await manager.callServerTool('fixture', 'fixture_echo', { message: 'x' });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'server_not_connected');
});

test('BLOCK-156 坏命令降级 error 状态（R1：不抛、不阻塞）', async () => {
  settings.saveMcpServers([
    { id: 'fixture', command: NODE, args: [FIXTURE] },
    { id: 'broken', command: 'gewu-definitely-not-a-command-156', args: [], autoConnect: false },
  ]);
  const broken = await manager.connectServer('broken');
  assert.equal(broken.ok, false);
  assert.ok(broken.error && broken.error.length > 0, 'error 面非空');

  const statuses = manager.getStatuses();
  const brokenRow = statuses.find((s) => s.id === 'broken');
  assert.equal(brokenRow.status, 'error');
  // 其它 server 不受牵连（R1 护栏的可见面）
  const fixtureRow = statuses.find((s) => s.id === 'fixture');
  assert.equal(fixtureRow.status, 'disconnected');
});

test('BLOCK-156 不存在的 server 连接=server_not_found；getStatuses 透出配置字段', async () => {
  const missing = await manager.connectServer('nope-156');
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'server_not_found');

  const statuses = manager.getStatuses();
  const row = statuses.find((s) => s.id === 'fixture');
  assert.deepEqual(
    { id: row.id, command: row.command, status: row.status, toolCount: row.toolCount },
    { id: 'fixture', command: NODE, status: 'disconnected', toolCount: 0 },
  );
});
