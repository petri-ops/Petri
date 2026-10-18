/**
 * BLOCK-204（W5）— 拆前基线（**先冻结再改**，BLOCK-92/199/200 先例）。
 *
 * 这份冻结的是接线前的三件事实，任何一件变了都说明"零行为变化"的承诺被打破：
 *  ① 未配置工具的默认策略 = 启用 / 60000ms / auto；
 *  ② 投影上限默认 40（原 `MAX_PROJECTED_TOOLS` 硬编码值）；
 *  ③ `auto` 模式下合同派生逐字等于 BLOCK-157 CAP-1：`readOnlyHint===true` → retrieval/none/R1，
 *     否则 → action/execution/R2。
 *
 * 另含一条 HTTP 面契约：`PUT /api/mcp/tool-policy` 的 unknown-tool 必须是 **400 + diagnostics**，
 * 不能冒 500、也不能静默吞掉。
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b204-baseline-'));
process.env.PETRI_LOCAL_DATA_DIR = dir;

const policy = require(path.join(ROOT, 'core/petri-server/helpers/mcp-tool-policy.js'));
const manager = require(path.join(ROOT, 'core/petri-server/mcp/client-manager.js'));
const projection = require(path.join(ROOT, 'core/petri-server/agent-tools/mcp-projection.js'));

test('BLOCK-204 基线 — 未配置 = 启用 / 60s / auto（零行为变化）', () => {
  assert.deepEqual({ ...policy.DEFAULTS }, { enabled: true, timeoutMs: 60_000, contractMode: 'auto' });
});

test('BLOCK-204 基线 — 投影上限默认 40（原 MAX_PROJECTED_TOOLS 硬编码值）', () => {
  assert.equal(policy.DEFAULT_PROJECTION_LIMIT, 40);
  assert.equal(projection.MAX_PROJECTED_TOOLS, 40);
});

test('BLOCK-204 基线 — auto 模式的合同派生逐字等于 CAP-1', () => {
  const readOnly = projection.mcpToolContract({ annotations: { readOnlyHint: true } }, 'auto');
  assert.deepEqual(
    { category: readOnly.category, sideEffect: readOnly.sideEffect, riskTier: readOnly.riskTier, resources: readOnly.resources },
    { category: 'retrieval', sideEffect: 'none', riskTier: 'R1', resources: ['mcp.server'] },
  );
  const mutating = projection.mcpToolContract({}, 'auto');
  assert.deepEqual(
    { category: mutating.category, sideEffect: mutating.sideEffect, riskTier: mutating.riskTier },
    { category: 'action', sideEffect: 'execution', riskTier: 'R2' },
  );
});

test('BLOCK-204 — HTTP 写面：unknown-tool → 400 + diagnostics；合法写入 200', async () => {
  const original = {
    getStatuses: manager.getStatuses,
    listServerTools: manager.listServerTools,
  };
  manager.getStatuses = () => [{ id: 'fs', status: 'connected' }];
  manager.listServerTools = () => ({ ok: true, tools: [{ name: 'read_file' }] });

  const express = require('express');
  const app = express();
  require(path.join(ROOT, 'core/petri-server/routes/mcp-client.js')).registerMcpClientRoutes(app);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const got = await (await fetch(`${base}/api/mcp/tool-policy`)).json();
    assert.equal(got.status, 'ok');
    assert.equal(got.projectionLimit, 40);
    assert.deepEqual(got.projectedTools, ['mcp_fs_read_file']);

    const rejected = await fetch(`${base}/api/mcp/tool-policy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tools: [{ tool: 'mcp_fs_typo' }] }),
    });
    assert.equal(rejected.status, 400, 'unknown-tool 必须 400，不得冒 500/静默');
    const rejectedBody = await rejected.json();
    assert.equal(rejectedBody.error, 'tool_policy_rejected');
    assert.ok(rejectedBody.diagnostics.some((d) => d.path === 'mcp_fs_typo'));

    const accepted = await fetch(`${base}/api/mcp/tool-policy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectionLimit: 12, tools: [{ tool: 'mcp_fs_read_file', enabled: false, timeoutMs: 5000 }] }),
    });
    assert.equal(accepted.status, 200);
    const acceptedBody = await accepted.json();
    assert.equal(acceptedBody.projectionLimit, 12);
    assert.equal(policy.policyFor('mcp_fs_read_file').enabled, false);
    assert.equal(policy.policyFor('mcp_fs_read_file').timeoutMs, 5000);
  } finally {
    manager.getStatuses = original.getStatuses;
    manager.listServerTools = original.listServerTools;
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
