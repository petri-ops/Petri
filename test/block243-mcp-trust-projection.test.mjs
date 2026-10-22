/**
 * BLOCK-243 — MCP trust 投影元数据 + 拦截器接线（红绿先行）。
 *
 * 钉住：
 * - destructiveHint 工具合同附 mcpApproval{serverId,destructive}；非 destructive 不附；
 * - 目录模式 call 代理只要目录含 destructive 工具即保守附 mcpApproval；
 * - 拦截器调用时解析当前 server trust（缺策略 fail-closed ask）；
 * - trust ask 的 deny 信封携 mcpServerId/explanation/approvalVariant/requestId/argsPreview，
 *   维度 ack 后真实执行。
 */
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b243-mcp-trust-'));
process.env.PETRI_LOCAL_DATA_DIR = tmpDir;
delete process.env.PETRI_MCP_CATALOG_THRESHOLD;

// 内存 DB 自举（interceptor require 链拉起 db 模块；PETRI_DB_PATH 须先行）
{
  const Database = require('better-sqlite3');
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b243-mcp-db-'));
  const boot = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }
  });
}

const settings = require(path.join(ROOT, 'core/petri-server/helpers/mcp-settings'));
const manager = require(path.join(ROOT, 'core/petri-server/mcp/client-manager'));
const projection = require(path.join(ROOT, 'core/petri-server/agent-tools/mcp-projection'));
const store = require(path.join(ROOT, 'core/petri-server/helpers/approval-request-store'));
const { createAgentToolInterceptor } = require(path.join(ROOT, 'core/petri-server/agent-tools/agent-tool-interceptor'));

const MANY_FIXTURE = path.join(ROOT, 'test', 'fixtures', 'mcp-many-tools-server.cjs');

before(async () => {
  const saved = settings.upsertMcpServer({
    id: 'many',
    command: process.execPath,
    args: [MANY_FIXTURE],
    autoConnect: false,
  });
  assert.equal(saved.error, undefined, JSON.stringify(saved));
  const conn = await manager.connectServer('many');
  assert.equal(conn.ok, true, JSON.stringify(conn));
});

after(async () => {
  await manager.closeAll().catch(() => {});
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('BLOCK-243 投影：destructive 工具附 mcpApproval，非 destructive 不附', () => {
  const destructive = projection.getMcpToolEntry('mcp_many_many_destructive');
  assert.ok(destructive, 'destructive 工具应在默认阈值下逐工具投影');
  assert.deepEqual(destructive.contract.mcpApproval, { serverId: 'many', destructive: true });

  const echo = projection.getMcpToolEntry('mcp_many_many_echo');
  assert.ok(echo);
  assert.equal(echo.contract.mcpApproval, undefined);

  const openWorld = projection.getMcpToolEntry('mcp_many_many_openworld');
  assert.ok(openWorld);
  assert.equal(openWorld.contract.mcpApproval, undefined);
});

test('BLOCK-243 目录代理：目录含 destructive 工具时 call 保守附 mcpApproval', () => {
  process.env.PETRI_MCP_CATALOG_THRESHOLD = '2';
  try {
    const call = projection.getMcpToolEntry('mcp_many__call');
    assert.ok(call, '阈值 2 时应进入目录模式');
    assert.deepEqual(call.contract.mcpApproval, { serverId: 'many', destructive: true });
    const catalog = projection.getMcpToolEntry('mcp_many__catalog');
    assert.ok(catalog);
    assert.equal(catalog.contract.mcpApproval, undefined, 'catalog 只读不要求审批');
  } finally {
    delete process.env.PETRI_MCP_CATALOG_THRESHOLD;
  }
});

test('BLOCK-243 拦截器：trust ask 的 destructive 调用 deny 信封完整，ack 后执行', async () => {
  const entry = {
    contract: {
      category: 'action',
      sideEffect: 'execution',
      riskTier: 'R2',
      mcpApproval: { serverId: 'demo', destructive: true },
    },
    definition: { function: { name: 'mcp_demo_destructive', parameters: { type: 'object', properties: {} } } },
    handler: async () => ({ ok: true, executed: true }),
  };
  const intercept = createAgentToolInterceptor({
    getToolEntry: () => entry,
    preflightWorkspaceTool: async () => ({ ok: true }),
  });
  const approvalRequests = store.createApprovalRequests('b243-mcp');
  const ackSet = new Set();
  const ctx = {
    accessMode: 'full',
    approvalRequests,
    approvedFingerprints: approvalRequests.approvedFingerprints,
    dynamicGuardAcks: ackSet,
  };
  const args = { target: 'db' };
  const denied = await intercept('mcp_demo_destructive', args, ctx);
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'mcp_trust_required');
  assert.equal(denied.guardKey, 'mcp:demo');
  assert.equal(denied.dimension, 'mcp-trust');
  assert.equal(denied.mcpServerId, 'demo');
  assert.equal(denied.approvalVariant, 'info');
  assert.match(denied.explanation, /destructive/);
  assert.ok(denied.requestId && denied.requestId.startsWith('apr_'));
  assert.equal(denied.argsPreview, JSON.stringify(args));
  assert.equal(denied.inputEditable, true);
  assert.equal(denied.pendingRequestCount, 1);
  assert.equal(denied.duplicatePending, false);

  const duplicate = await intercept('mcp_demo_destructive', args, ctx);
  assert.equal(duplicate.requestId, denied.requestId);
  assert.equal(duplicate.duplicatePending, true);
  assert.equal(duplicate.pendingRequestCount, 1);

  ackSet.add('mcp:demo');
  const allowed = await intercept('mcp_demo_destructive', args, ctx);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.executed, true);
  store.releaseApprovalRequests('b243-mcp');
});
