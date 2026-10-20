/**
 * BLOCK-221 — Q8 垂直切片：MCP 服务级治理（凭据脱敏 + 工具允许/阻断）。
 *
 * 钉住：①env 值绝不出状态面；②默认全允许（行为不变）；③block 优先、allow 白名单；
 * ④写侧 fail-closed（未知 server/非法名/越界）；⑤坏 store 降级为空策略而不放开过滤；
 * ⑥投影真的按服务级策略裁剪。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'block221-policy-'));
process.env.PETRI_LOCAL_DATA_DIR = TMP;
process.env.PETRI_DB_PATH = path.join(TMP, 'petri.db');

const policy = require('../core/petri-server/helpers/mcp-server-policy.js');
const settings = require('../core/petri-server/helpers/mcp-settings.js');
const manager = require('../core/petri-server/mcp/client-manager.js');
const projection = require('../core/petri-server/agent-tools/mcp-projection.js');

test.after(() => {
  manager._resetForTests();
  fs.rmSync(TMP, { recursive: true, force: true });
});

test.beforeEach(() => {
  fs.rmSync(policy.policyFilePath(), { force: true });
  settings.saveMcpServers([]);
});

test('BLOCK-221 默认策略=ask + 空 allow/block（全允许，行为不变）', () => {
  const p = policy.policyForServer('srv-a');
  assert.deepEqual(p, { trust: 'ask', allow: [], block: [] });
  assert.equal(policy.evaluateTool('srv-a', 'anything').allowed, true);
});

test('BLOCK-221 block 优先于 allow，allow 非空即白名单', () => {
  settings.saveMcpServers([{ id: 'srv-a', command: 'node', args: [] }]);
  const checked = policy.validatePatch('srv-a', { allow: ['read', 'write'], block: ['write'] }, {
    knownServerIds: new Set(['srv-a']),
  });
  assert.equal(checked.ok, true);
  policy.writeStore(checked.nextStore);

  assert.equal(policy.evaluateTool('srv-a', 'read').allowed, true);
  assert.equal(policy.evaluateTool('srv-a', 'write').allowed, false, 'block 优先');
  assert.equal(policy.evaluateTool('srv-a', 'list').allowed, false, '不在白名单');
  assert.equal(policy.evaluateTool('srv-a', 'list').reason, 'not_in_allow_list');
});

test('BLOCK-221 写侧 fail-closed：未知 server / 非法 trust / 非法名 / 越界', () => {
  settings.saveMcpServers([{ id: 'srv-a', command: 'node', args: [] }]);
  const known = new Set(['srv-a']);

  const missing = policy.validatePatch('srv-x', { trust: 'allow' }, { knownServerIds: known });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'server_not_found');

  const badTrust = policy.validatePatch('srv-a', { trust: 'yolo' }, { knownServerIds: known });
  assert.equal(badTrust.ok, false);
  assert.ok(badTrust.diagnostics.some((d) => d.code === 'trust_invalid'));

  const badName = policy.validatePatch('srv-a', { allow: ['bad name with spaces'] }, { knownServerIds: known });
  assert.equal(badName.ok, false);
  assert.ok(badName.diagnostics.some((d) => d.code === 'allow_invalid_name'));

  const tooMany = policy.validatePatch(
    'srv-a',
    { block: Array.from({ length: policy.MAX_LIST + 1 }, (_, i) => `t${i}`) },
    { knownServerIds: known },
  );
  assert.equal(tooMany.ok, false);
  assert.ok(tooMany.diagnostics.some((d) => d.code === 'block_too_many'));

  // 失败不落盘：store 仍为空
  assert.deepEqual(policy.readStore().servers, {});
});

test('BLOCK-221 已连接但清单外的工具只留 diagnostic，仍收（离线可预配）', () => {
  settings.saveMcpServers([{ id: 'srv-a', command: 'node', args: [] }]);
  const checked = policy.validatePatch('srv-a', { block: ['ghost-tool'] }, {
    knownServerIds: new Set(['srv-a']),
    connectedTools: ['real-tool'],
  });
  assert.equal(checked.ok, true);
  assert.ok(checked.diagnostics.some((d) => d.code === 'block_unknown_tool'));
  assert.deepEqual(checked.policy.block, ['ghost-tool']);
});

test('BLOCK-221 重复工具名去重（同一名字只留一条）', () => {
  settings.saveMcpServers([{ id: 'srv-a', command: 'node', args: [] }]);
  const checked = policy.validatePatch('srv-a', { allow: ['read', 'read', 'write'] }, {
    knownServerIds: new Set(['srv-a']),
  });
  assert.deepEqual(checked.policy.allow, ['read', 'write']);
});

test('BLOCK-221 坏 store 降级：既不放宽 allow，也不阻断连接', () => {
  fs.mkdirSync(path.dirname(policy.policyFilePath()), { recursive: true });
  fs.writeFileSync(policy.policyFilePath(), '{ not json', 'utf8');
  const store = policy.readStore();
  assert.deepEqual(store.servers, {});
  assert.equal(policy.evaluateTool('srv-a', 'anything', store).allowed, true);

  fs.writeFileSync(policy.policyFilePath(), JSON.stringify({ version: 1, servers: { 'srv-a': 'nope' } }), 'utf8');
  assert.deepEqual(policy.readStore().servers, {}, '形状错条目被剔除');
});

test('BLOCK-221 凭据脱敏：状态面只出 envKeys/envCount，绝不出 env 值', () => {
  const secret = 'sk-live-SECRET-221';
  settings.saveMcpServers([
    { id: 'srv-a', command: 'node', args: [], env: { API_TOKEN: secret }, autoConnect: false },
  ]);
  const row = manager.getStatuses().find((r) => r.id === 'srv-a');
  assert.ok(row, '行存在');
  assert.equal(JSON.stringify(row).includes(secret), false, '明文 token 不得出现在状态行');
  assert.deepEqual(row.envKeys, ['API_TOKEN']);
  assert.equal(row.envCount, 1);
  assert.equal('env' in row, false);
});

test('BLOCK-221 投影按服务级策略裁剪（block 无影、allow 白名单）', () => {
  settings.saveMcpServers([{ id: 'srv-a', command: 'node', args: [], autoConnect: false }]);
  // 用桩替换会话面：投影只依赖 getStatuses + listServerTools
  const originStatuses = manager.getStatuses;
  const originTools = manager.listServerTools;
  manager.getStatuses = () => [
    { id: 'srv-a', status: 'connected', command: 'node', args: [], envKeys: [], envCount: 0 },
  ];
  manager.listServerTools = () => ({ ok: true, tools: [{ name: 'read' }, { name: 'write' }, { name: 'list' }] });
  try {
    assert.deepEqual(projection.projectedToolNames().sort(), [
      'mcp_srv-a_list',
      'mcp_srv-a_read',
      'mcp_srv-a_write',
    ]);

    const checked = policy.validatePatch('srv-a', { allow: ['read', 'write'], block: ['write'] }, {
      knownServerIds: new Set(['srv-a']),
    });
    policy.writeStore(checked.nextStore);

    assert.deepEqual(projection.projectedToolNames(), ['mcp_srv-a_read']);
    assert.deepEqual(projection.projectedCountByServer(), { 'srv-a': 1 });
  } finally {
    manager.getStatuses = originStatuses;
    manager.listServerTools = originTools;
  }
});

test('BLOCK-221 摘要面：trust/allowCount/blockCount 与实际策略一致', () => {
  settings.saveMcpServers([{ id: 'srv-a', command: 'node', args: [] }]);
  const checked = policy.validatePatch('srv-a', { trust: 'allow', allow: ['read'], block: ['write'] }, {
    knownServerIds: new Set(['srv-a']),
  });
  policy.writeStore(checked.nextStore);
  const summary = policy.summaryFor('srv-a');
  assert.equal(summary.trust, 'allow');
  assert.equal(summary.allowCount, 1);
  assert.equal(summary.blockCount, 1);
  assert.deepEqual(summary.block, ['write']);
});
