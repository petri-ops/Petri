// agent-led Task 1 测试：run_tool 跑完写 tool_jobs 记录，返回 toolJobId
// 运行：cd desktop-app && node --test test/agent-run-tool.test.mjs
// live 测试：RUN_AGENT_LIVE=1 node --test test/agent-run-tool.test.mjs（需本地 R + volcano-plot 插件）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const path = { join };
const __dirname = dirname(fileURLToPath(import.meta.url));
const R_SERVER = resolve(__dirname, '..', '..', 'r-server');

// db.js 默认走 SQLite（无 DATABASE_URL），桌面版同款，无需 PG
const db = await import(R_SERVER + '/db.js');
const { callTool } = await import(resolve(__dirname, '..', 'src', 'mcp-tool-registry.js'));

// === DB 层单测：createToolJob/updateToolJob/getToolJob（非 live，默认跑）===

test('createToolJob 写入 + getToolJob 查到', async () => {
  const job = db.createToolJob({ toolId: 'test-tool', params: { a: 1 }, status: 'running' });
  assert.ok(job.id, '应返回带 id 的记录');
  assert.equal(job.tool_id, 'test-tool');
  assert.equal(job.status, 'running');
  assert.deepEqual(job.params, { a: 1 });

  const fetched = db.getToolJob(job.id);
  assert.equal(fetched.id, job.id);
  assert.equal(fetched.tool_id, 'test-tool');
});

test('updateToolJob 更新状态 + resultJson', async () => {
  const job = db.createToolJob({ toolId: 'test-tool-2', status: 'running' });
  const updated = db.updateToolJob(job.id, {
    status: 'completed',
    resultJson: { outputs: ['x.png'] },
    completedAt: Date.now(),
  });
  assert.equal(updated.status, 'completed');
  assert.deepEqual(updated.result, { outputs: ['x.png'] });
  assert.ok(updated.completed_at, 'completed_at 应有值');
});

test('updateToolJob 失败分支写 error', async () => {
  const job = db.createToolJob({ toolId: 'test-tool-3', status: 'running' });
  const updated = db.updateToolJob(job.id, {
    status: 'failed',
    error: 'R 脚本崩溃',
    completedAt: Date.now(),
  });
  assert.equal(updated.status, 'failed');
  assert.equal(updated.error, 'R 脚本崩溃');
});

// === callTool 端到端：跑完返回 toolJobId（live，需 R）===

const RUN_LIVE = process.env.RUN_AGENT_LIVE === '1';
test('callTool 跑通 volcano-plot 返回 toolJobId（live）', { skip: !RUN_LIVE }, async () => {
  const builtInDir = resolve(__dirname, '..', 'resources', 'built-in-plugins', 'volcano-plot');
  const demoCsv = path.join(builtInDir, 'demo-data', 'demo_deg.csv');
  globalThis._biof3Plugins = new Map();
  globalThis._biof3Plugins.set('volcano-plot', {
    id: 'volcano-plot',
    version: '1.0.0',
    language: 'r',
    pluginDir: builtInDir,
    scriptPath: path.join(builtInDir, 'scripts'),
  });
  try {
    const result = await callTool('volcano-plot', {
      deg_table: demoCsv,
      fc_threshold: 1,
      pval_threshold: 1.3,
      top_n: 10,
    });
    assert.equal(result.isError, false, `应成功，实际: ${result.content[0].text}`);
    // Task 1 核心断言：返回 toolJobId
    assert.ok(result.toolJobId, 'callTool 应返回 toolJobId');
    // DB 里能查到该记录，且状态 completed
    const job = db.getToolJob(result.toolJobId);
    assert.ok(job, `tool_jobs 表应能查到 ${result.toolJobId}`);
    assert.equal(job.status, 'completed');
    assert.ok(job.result, 'result_json 应有值');
  } finally {
    globalThis._biof3Plugins = new Map();
  }
});
