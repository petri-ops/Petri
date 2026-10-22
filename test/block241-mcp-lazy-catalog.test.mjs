/**
 * BLOCK-241 — MCP 大目录懒加载（catalog/call 代理）集成测试。
 *
 * 真实 stdio 夹具（many-tools，6 工具）+ 阈值 3：
 * - 大目录只投影 catalog(R1)/call(R2)，真实工具不再单独投影；
 * - catalog list/describe 只读且只列策略允许的工具；
 * - call 按名调用并在调用时复核 server/tool policy（投影后改策略也生效）；
 * - 小目录（2 工具）仍走逐工具投影，零变化。
 */

import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b241-mcp-catalog-'));
process.env.PETRI_LOCAL_DATA_DIR = tmpDir;
process.env.PETRI_MCP_CATALOG_THRESHOLD = '2';

const settings = require(path.join(ROOT, 'core/petri-server/helpers/mcp-settings'));
const manager = require(path.join(ROOT, 'core/petri-server/mcp/client-manager'));
const toolPolicy = require(path.join(ROOT, 'core/petri-server/helpers/mcp-tool-policy'));
const serverPolicy = require(path.join(ROOT, 'core/petri-server/helpers/mcp-server-policy'));
const projection = require(path.join(ROOT, 'core/petri-server/agent-tools/mcp-projection'));

const MANY_FIXTURE = path.join(ROOT, 'test', 'fixtures', 'mcp-many-tools-server.cjs');
const SMALL_FIXTURE = path.join(ROOT, 'test', 'fixtures', 'mcp-fixture-server.cjs');

const CATALOG = 'mcp_many__catalog';
const CALL = 'mcp_many__call';

async function addAndConnect(id, fixturePath, toolNames) {
  const saved = settings.upsertMcpServer({
    id,
    command: process.execPath,
    args: [fixturePath],
    autoConnect: false,
  });
  assert.equal(saved.error, undefined, JSON.stringify(saved));
  const conn = await manager.connectServer(id);
  assert.equal(conn.ok, true, JSON.stringify(conn));
  const tools = manager.listServerTools(id).tools.map((tool) => tool.name);
  if (toolNames) assert.deepEqual(tools.sort(), [...toolNames].sort());
  return tools;
}

before(async () => {
  const manyTools = await addAndConnect('many', MANY_FIXTURE, [
    'many_echo', 'many_readonly', 'many_destructive', 'many_openworld', 'many_blocked', 'many_disabled',
  ]);

  const checked = serverPolicy.validatePatch('many', { block: ['many_blocked'] }, {
    knownServerIds: new Set(['many']),
    connectedTools: manyTools,
  });
  assert.equal(checked.ok, true, JSON.stringify(checked.diagnostics));
  assert.equal(serverPolicy.writeStore(checked.nextStore).ok, true);

  const written = toolPolicy.writeStore({
    projectionLimit: 40,
    tools: [{ tool: 'mcp_many_many_disabled', enabled: false }],
  });
  assert.equal(written.ok, true, JSON.stringify(written.diagnostics));

  await addAndConnect('small', SMALL_FIXTURE);
});

after(async () => {
  await manager.closeAll().catch(() => {});
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('BLOCK-241 — 大目录只投影 catalog/call；小目录逐工具零变化', () => {
  const names = projection.projectedToolNames();
  assert.ok(names.includes(CATALOG), JSON.stringify(names));
  assert.ok(names.includes(CALL), JSON.stringify(names));
  assert.ok(!names.includes('mcp_many_many_echo'), '大目录不应再单独投影真实工具');
  assert.ok(names.includes('mcp_small_fixture_echo'), '小目录仍逐工具投影');
  assert.ok(!names.includes('mcp_small__catalog'), '小目录不进入目录模式');

  const catalogMode = projection.catalogModeByServer();
  assert.deepEqual(catalogMode.many, { mode: 'catalog', total: 4 });
  assert.equal(catalogMode.small, undefined);

  const defs = projection.projectMcpToolDefs();
  const defNames = defs.map((def) => def.function.name);
  assert.ok(defNames.includes(CATALOG) && defNames.includes(CALL));
  assert.ok(defNames.includes('mcp_small_fixture_echo'));
});

test('BLOCK-241 — catalog R1 只读，call R2 执行合同', () => {
  const catalog = projection.getMcpToolEntry(CATALOG);
  assert.ok(catalog);
  assert.equal(catalog.contract.category, 'retrieval');
  assert.equal(catalog.contract.sideEffect, 'none');
  assert.equal(catalog.contract.riskTier, 'R1');

  const call = projection.getMcpToolEntry(CALL);
  assert.ok(call);
  assert.equal(call.contract.category, 'action');
  assert.equal(call.contract.sideEffect, 'execution');
  assert.equal(call.contract.riskTier, 'R2');
  assert.match(call.contract.notes, /catalog proxy/);
});

test('BLOCK-241 — catalog list/describe 只暴露策略允许的工具', async () => {
  const catalog = projection.getMcpToolEntry(CATALOG);
  const listed = await catalog.handler({ action: 'list' });
  assert.equal(listed.ok, true);
  assert.equal(listed.total, 4);
  const names = listed.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ['many_destructive', 'many_echo', 'many_openworld', 'many_readonly']);
  assert.ok(!names.includes('many_blocked'));
  assert.ok(!names.includes('many_disabled'));

  const described = await catalog.handler({ action: 'describe', tool: 'many_echo' });
  assert.equal(described.ok, true);
  assert.equal(described.tool, 'many_echo');
  assert.equal(described.inputSchema.type, 'object');
  assert.equal(described.hints.readOnly, false);

  const ro = await catalog.handler({ action: 'describe', tool: 'many_readonly' });
  assert.equal(ro.hints.readOnly, true);

  const blocked = await catalog.handler({ action: 'describe', tool: 'many_blocked' });
  assert.deepEqual(blocked, { ok: false, error: 'tool_not_available' });

  const badAction = await catalog.handler({ action: 'call', tool: 'many_echo' });
  assert.equal(badAction.ok, false);
  assert.equal(badAction.error, 'invalid_action');
});

test('BLOCK-241 — call 代理调用允许工具；blocked/disabled/unknown 拒绝', async () => {
  const call = projection.getMcpToolEntry(CALL);
  const ok = await call.handler({ tool: 'many_echo', arguments: { message: 'hi' } });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.server, 'many');
  assert.equal(ok.tool, 'many_echo');
  assert.match(ok.text, /called:many_echo/);

  for (const tool of ['many_blocked', 'many_disabled', 'nope', 'mcp_many__catalog']) {
    const denied = await call.handler({ tool });
    assert.equal(denied.ok, false, `${tool} 应被拒绝`);
    assert.equal(denied.error, 'tool_not_available', `${tool}: ${JSON.stringify(denied)}`);
  }
  const missing = await call.handler({});
  assert.equal(missing.error, 'tool_required');
});

test('BLOCK-241 — call 在调用时复核策略（投影后新增 block 立即生效）', async () => {
  const call = projection.getMcpToolEntry(CALL);
  const checked = serverPolicy.validatePatch('many', { block: ['many_blocked', 'many_echo'] }, {
    knownServerIds: new Set(['many']),
    connectedTools: manager.listServerTools('many').tools.map((tool) => tool.name),
  });
  assert.equal(checked.ok, true);
  assert.equal(serverPolicy.writeStore(checked.nextStore).ok, true);

  const denied = await call.handler({ tool: 'many_echo' });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'tool_not_available');

  const listed = await projection.getMcpToolEntry(CATALOG).handler({ action: 'list' });
  assert.ok(!listed.tools.some((tool) => tool.name === 'many_echo'));
});
