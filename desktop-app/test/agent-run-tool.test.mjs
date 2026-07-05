// agent-led Task 1 测试：run_tool 跑完写 tool_jobs 记录，返回 toolJobId
// 运行：cd desktop-app && node --test test/agent-run-tool.test.mjs
// live 测试：RUN_AGENT_LIVE=1 node --test test/agent-run-tool.test.mjs（需本地 R + volcano-plot 插件）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';

const path = { join };
const __dirname = dirname(fileURLToPath(import.meta.url));
const R_SERVER = resolve(__dirname, '..', '..', 'r-server');
const req = createRequire(import.meta.url);

// db.js 是 CJS，用 createRequire 拿到 module.exports 的具名函数（await import 只能拿 default）
const db = req(R_SERVER + '/db.js');
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

// === plan step 关联 toolJobId 联动（非 live，默认跑）===

test('syncPlanStepStatusFromToolJob 把绑定的 step 变 done', async () => {
  const plans = req(R_SERVER + '/helpers/plans.js');
  // 造 plan + 1 个 step（直接用 db.js 的 sqlite）
  const sqlite = db.getSqliteForLegacyModules();
  const planId = 'testplan_' + Date.now();
  sqlite
    .prepare(
      'INSERT INTO copilot_plans (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(planId, 'test-user', 'test plan', 'active', new Date().toISOString(), new Date().toISOString());
  sqlite
    .prepare(
      'INSERT INTO copilot_plan_steps (plan_id, n, title, status, ts) VALUES (?, ?, ?, ?, ?)'
    )
    .run(planId, 1, '跑 volcano-plot', 'pending', new Date().toISOString());

  // 造 tool_job，绑到 step
  const job = db.createToolJob({ toolId: 'volcano-plot', status: 'running' });
  sqlite
    .prepare('UPDATE copilot_plan_steps SET tool_job_id=? WHERE plan_id=? AND n=?')
    .run(job.id, planId, 1);

  // tool_job 完成 → 同步 step
  db.updateToolJob(job.id, { status: 'completed', resultJson: { ok: true }, completedAt: Date.now() });
  plans.syncPlanStepStatusFromToolJob(job.id, 'completed');

  // step 应变 done
  const step = sqlite
    .prepare('SELECT status, result FROM copilot_plan_steps WHERE plan_id=? AND n=?')
    .get(planId, 1);
  assert.equal(step.status, 'done', 'step 应被同步为 done');
  assert.match(step.result, /任务完成/, 'step result 应为"任务完成"');

  // 清理
  sqlite.prepare('DELETE FROM copilot_plan_steps WHERE plan_id=?').run(planId);
  sqlite.prepare('DELETE FROM copilot_plans WHERE id=?').run(planId);
  sqlite.prepare('DELETE FROM tool_jobs WHERE id=?').run(job.id);
});

test('syncPlanStepStatusFromToolJob failed 分支写错误信息', async () => {
  const plans = req(R_SERVER + '/helpers/plans.js');
  const sqlite = db.getSqliteForLegacyModules();
  const planId = 'testplan2_' + Date.now();
  sqlite
    .prepare(
      'INSERT INTO copilot_plans (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(planId, 'test-user', 'test plan 2', 'active', new Date().toISOString(), new Date().toISOString());
  sqlite
    .prepare(
      'INSERT INTO copilot_plan_steps (plan_id, n, title, status, ts) VALUES (?, ?, ?, ?, ?)'
    )
    .run(planId, 1, '跑 deseq2', 'running', new Date().toISOString());

  const job = db.createToolJob({ toolId: 'deseq2', status: 'running' });
  sqlite
    .prepare('UPDATE copilot_plan_steps SET tool_job_id=? WHERE plan_id=? AND n=?')
    .run(job.id, planId, 1);

  const errText = 'DESeq2 包未安装';
  db.updateToolJob(job.id, { status: 'failed', error: errText, completedAt: Date.now() });
  plans.syncPlanStepStatusFromToolJob(job.id, 'failed', errText);

  const step = sqlite
    .prepare('SELECT status, result FROM copilot_plan_steps WHERE plan_id=? AND n=?')
    .get(planId, 1);
  assert.equal(step.status, 'failed', 'step 应被同步为 failed');
  assert.match(step.result, /任务失败.*DESeq2 包未安装/, 'step result 应含错误信息');

  // 清理
  sqlite.prepare('DELETE FROM copilot_plan_steps WHERE plan_id=?').run(planId);
  sqlite.prepare('DELETE FROM copilot_plans WHERE id=?').run(planId);
  sqlite.prepare('DELETE FROM tool_jobs WHERE id=?').run(job.id);
});
