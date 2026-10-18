/**
 * BLOCK-204（runlist W5）— MCP 逐工具策略契约测。
 *
 * 钉四件事：
 *  ① **未配置 = 零行为变化**：`DEFAULTS`（启用 / 60s / auto）与接线前的硬编码值逐字相同，
 *     基线测（block204-mcp-tool-policy-baseline）把这三个数冻结；
 *  ② **策略真的被执行**：停用 ⇒ 不投影；上限可配；`contractMode` 改的是喂给四档判定的合同输入；
 *     `timeoutMs` 真的传给 `callServerTool`（不是只存在文件里）；
 *  ③ **unknown-tool 只拒该条**：写侧对"当前投影 ∪ 已有策略"之外的新名字报 400，但既有条目
 *     即使 server 断连仍可改/删（否则离线就改不了策略）；
 *  ④ 落点走 W4b 的数据根单源；读侧坏文件 fail-open。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b204-tool-policy-'));
process.env.PETRI_LOCAL_DATA_DIR = dir;

const policy = require(path.join(ROOT, 'core/petri-server/helpers/mcp-tool-policy.js'));
const manager = require(path.join(ROOT, 'core/petri-server/mcp/client-manager.js'));
const projection = require(path.join(ROOT, 'core/petri-server/agent-tools/mcp-projection.js'));

/** 把 manager 伪装成"已连接两个工具"（CJS 导出对象可替换，测试专用）。 */
function stubConnected(tools) {
  const original = {
    getStatuses: manager.getStatuses,
    listServerTools: manager.listServerTools,
    callServerTool: manager.callServerTool,
  };
  manager.getStatuses = () => [{ id: 'fs', status: 'connected' }];
  manager.listServerTools = () => ({ ok: true, tools });
  const calls = [];
  manager.callServerTool = async (id, toolName, args, options) => {
    calls.push({ id, toolName, args, options });
    return { ok: true, result: { content: [{ type: 'text', text: 'ok' }] } };
  };
  return {
    calls,
    restore() {
      manager.getStatuses = original.getStatuses;
      manager.listServerTools = original.listServerTools;
      manager.callServerTool = original.callServerTool;
    },
  };
}

const TOOLS = [
  { name: 'read_file', description: '读文件', annotations: { readOnlyHint: true } },
  { name: 'write_file', description: '写文件' },
];

test('BLOCK-204 — 未配置 = 零行为变化：两个工具都投影，合同走 readOnlyHint 推导', () => {
  const stub = stubConnected(TOOLS);
  try {
    assert.deepEqual(projection.projectedToolNames().sort(), ['mcp_fs_read_file', 'mcp_fs_write_file']);
    const readEntry = projection.getMcpToolEntry('mcp_fs_read_file');
    const writeEntry = projection.getMcpToolEntry('mcp_fs_write_file');
    assert.equal(readEntry.contract.sideEffect, 'none', 'readOnlyHint=true 仍是只读族（BLOCK-157 CAP-1 未变）');
    assert.equal(readEntry.contract.riskTier, 'R1');
    assert.equal(writeEntry.contract.sideEffect, 'execution', '未标注仍是保守 execution/R2');
    assert.equal(writeEntry.contract.riskTier, 'R2');
  } finally {
    stub.restore();
  }
});

test('BLOCK-204 — 停用真的不投影；上限真的可配', () => {
  const stub = stubConnected(TOOLS);
  try {
    const saved = policy.writeStore({
      projectionLimit: 40,
      tools: [{ tool: 'mcp_fs_write_file', enabled: false }],
    });
    assert.equal(saved.ok, true);
    assert.deepEqual(projection.projectedToolNames(), ['mcp_fs_read_file'], '停用的工具不得出现在模型工具面');

    policy.writeStore({ projectionLimit: 1, tools: [] });
    assert.equal(projection.projectedToolNames().length, 1, '上限 1 时只投影一个');
    assert.equal(policy.projectionLimit(), 1);
  } finally {
    stub.restore();
    policy.resetToolPolicies();
  }
});

test('BLOCK-204 — contractMode 覆盖只改合同输入：read-only 降档 / mutating 升保守', () => {
  const stub = stubConnected(TOOLS);
  try {
    policy.writeStore({
      tools: [
        { tool: 'mcp_fs_write_file', contractMode: 'read-only' },
        { tool: 'mcp_fs_read_file', contractMode: 'mutating' },
      ],
    });
    const writeEntry = projection.getMcpToolEntry('mcp_fs_write_file');
    const readEntry = projection.getMcpToolEntry('mcp_fs_read_file');
    assert.equal(writeEntry.contract.sideEffect, 'none', 'mutating 工具被显式声明为只读 ⇒ 改写的工具可进 read/plan 档');
    assert.equal(writeEntry.contract.riskTier, 'R1');
    assert.equal(readEntry.contract.sideEffect, 'execution', '只读工具被显式声明为改写 ⇒ 退回保守档');
    assert.equal(readEntry.contract.riskTier, 'R2');
  } finally {
    stub.restore();
    policy.resetToolPolicies();
  }
});

test('BLOCK-204 — 逐工具超时真的传到 callServerTool（不是只躺在文件里）', async () => {
  const stub = stubConnected(TOOLS);
  try {
    policy.writeStore({ tools: [{ tool: 'mcp_fs_read_file', timeoutMs: 5000 }] });
    const entry = projection.getMcpToolEntry('mcp_fs_read_file');
    const result = await entry.handler({ path: 'a.txt' });
    assert.equal(result.ok, true);
    assert.equal(stub.calls.length, 1);
    assert.deepEqual(stub.calls[0].options, { timeoutMs: 5000 }, '策略里的超时必须作为 options 传下去');

    // 未配置的工具走缺省（不传数值 ⇒ client-manager 用自己的 60s）
    const other = projection.getMcpToolEntry('mcp_fs_write_file');
    await other.handler({});
    assert.equal(stub.calls[1].options.timeoutMs, 60000);
  } finally {
    stub.restore();
    policy.resetToolPolicies();
  }
});

test('BLOCK-204 — unknown-tool 只拒该条：新名字 400，既有条目断连也能改', () => {
  const stub = stubConnected(TOOLS);
  try {
    const rejected = policy.validatePatch(
      { tools: [{ tool: 'mcp_fs_read_file', enabled: false }, { tool: 'mcp_fs_typo', enabled: false }] },
      projection.projectedToolNames(),
    );
    assert.equal(rejected.ok, false);
    assert.ok(rejected.diagnostics.some((d) => d.path === 'mcp_fs_typo' && d.code === 'not-allowed'));
    assert.equal(rejected.diagnostics.length, 1, '只报那一条，不连带合法条目');

    // 已有条目 + 空投影（server 断连）仍可编辑
    policy.writeStore({ tools: [{ tool: 'mcp_fs_read_file', enabled: false }] });
    const offline = policy.validatePatch({ tools: [{ tool: 'mcp_fs_read_file', enabled: true }] }, []);
    assert.equal(offline.ok, true, '断连时既有条目必须仍可改（否则离线改不了策略）');
  } finally {
    stub.restore();
    policy.resetToolPolicies();
  }
});

test('BLOCK-204 — 读侧宽容 + 落点走数据根单源', () => {
  assert.equal(policy.policyFilePath(), path.join(dir, 'mcp-tool-policy.json'));
  fs.writeFileSync(policy.policyFilePath(), '{not json', 'utf8');
  const store = policy.readStore();
  assert.equal(store.projectionLimit, policy.DEFAULT_PROJECTION_LIMIT, '坏文件 fail-open 到默认上限');
  assert.deepEqual(store.tools, []);
  assert.deepEqual(policy.policyFor('mcp_fs_read_file'), { ...policy.DEFAULTS }, '未配置的工具 = DEFAULTS');
});
