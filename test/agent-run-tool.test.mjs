// agent-led Task 1 测试：run_tool 跑完写 tool_jobs 记录，返回 toolJobId
// 运行：cd desktop-app && node --test test/agent-run-tool.test.mjs
// live 测试：RUN_AGENT_LIVE=1 node --test test/agent-run-tool.test.mjs（需本地 R + volcano-plot 插件）
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';

const path = { join };
const __dirname = dirname(fileURLToPath(import.meta.url));
const R_SERVER = resolve(__dirname, '..', 'core', 'biof3-server');
const req = createRequire(import.meta.url);
const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-agent-run-tool-'));
process.env.BIOF3_DB_PATH = path.join(TEST_DB_DIR, 'biof3.db');

// db.js 是 CJS，用 createRequire 拿到 module.exports 的具名函数（await import 只能拿 default）

// BLOCK-49 加映清债 —— 应用全量 migrations（原仅设 DB 路径未建表）
{
  const Database = req(R_SERVER + '/node_modules/better-sqlite3');
  const boot = new Database(process.env.BIOF3_DB_PATH);
  const migrationsDir = resolve(__dirname, '..', 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(migrationsDir + '/' + f, 'utf8'));
  }
  boot.close();
}

const db = req(R_SERVER + '/db.js');
const { buildAuthoritativeWorkflowGraph } = req(resolve(__dirname, '..', 'core', 'shared-backend', 'result-workflow-graph.js'));
const { computeExecutionProvenanceHash } = req(resolve(__dirname, '..', 'core', 'shared-backend', 'execution-provenance.js'));
// 单测绕过 server.js 启动；显式复用真实启动路径的 Plan 表初始化，避免依赖开发机旧 SQLite。
req(R_SERVER + '/ai-bridge.js');
const registry = req(R_SERVER + '/mcp/registry.js');
const { callTool, _test } = registry;

after(() => {
  try {
    db.db.close();
  } catch {}
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

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

test('updateToolJobParams 持久化 workflow recovery 审计', async () => {
  const job = db.createToolJob({ toolId: 'test-tool-recovery', params: { top_n: 10 }, status: 'failed' });
  const updated = db.updateToolJobParams(job.id, {
    top_n: 10,
    __harnessRecovery: [{ id: 'recovery_1', actionId: 'retry_run' }],
  });
  assert.equal(updated.params.top_n, 10);
  assert.equal(updated.params.__harnessRecovery[0].actionId, 'retry_run');
});

test('P5 Workflow Truth query is not truncated by the 200-row UI listing limit', () => {
  const projectId = `p_workflow_truth_${Date.now()}`;
  const outputHash = 'a'.repeat(64);
  let rootJob = null;
  let childJob = null;
  for (let index = 0; index < 205; index += 1) {
    const job = db.createToolJob({
      toolId: index === 0 ? 'deseq2' : index === 204 ? 'go-kegg' : 'unrelated-job',
      projectId,
      params: { index },
      status: 'completed',
    });
    db.db.prepare('UPDATE tool_jobs SET created_at = ? WHERE id = ?').run(index, job.id);
    if (index === 0) rootJob = job;
    if (index === 204) childJob = job;
  }
  const rootProvenance = {
    executionProvenanceVersion: 1,
    projectId,
    toolJobId: rootJob.id,
    inputs: [],
    artifacts: [{ id: 'deg_table', sha256: outputHash }],
  };
  rootProvenance.provenanceHash = computeExecutionProvenanceHash(rootProvenance);
  db.updateToolJob(rootJob.id, {
    status: 'completed',
    resultJson: {
      artifactTruth: { status: 'valid', blocking: false },
      executionProvenance: rootProvenance,
    },
  });
  const childProvenance = {
    executionProvenanceVersion: 1,
    projectId,
    toolJobId: childJob.id,
    inputs: [{
      id: 'deg_table',
      sha256: outputHash,
      lineage: {
        lineageVersion: 1,
        kind: 'artifact',
        sourceRevisionId: 'rev_workflow_root',
        sourceToolJobId: rootJob.id,
        sourceArtifactId: 'deg_table',
        sourceOutputHash: outputHash,
        materializationHash: outputHash,
      },
    }],
    artifacts: [{ id: 'go_bp_results', sha256: 'd'.repeat(64) }],
  };
  childProvenance.provenanceHash = computeExecutionProvenanceHash(childProvenance);
  db.updateToolJob(childJob.id, {
    status: 'completed',
    resultJson: {
      artifactTruth: { status: 'valid', blocking: false },
      executionProvenance: childProvenance,
    },
  });

  const uiRows = db.listProjectToolJobs(projectId);
  const workflowRows = db.listProjectToolJobsForWorkflow(projectId);
  assert.equal(uiRows.length, 200);
  assert.equal(workflowRows.length, 205);
  assert.equal(uiRows.some((row) => row.params.index === 0), false);
  assert.equal(workflowRows[0].params.index, 0);
  assert.deepEqual(workflowRows.map((row) => row.params.index), Array.from({ length: 205 }, (_, index) => index));

  const graph = buildAuthoritativeWorkflowGraph({
    projectId,
    sourceToolJobId: rootJob.id,
    jobs: workflowRows,
    requiredToolJobIds: [childJob.id],
    repository: {
      getRevision: (revisionId) => revisionId === 'rev_workflow_root'
        ? {
          revisionId,
          projectId,
          toolJobId: rootJob.id,
          artifactId: 'deg_table',
          outputHash,
        }
        : null,
      getSelection: () => null,
    },
  });
  assert.equal(graph.ok, true);
  assert.deepEqual(graph.workflowPlan.steps.map((step) => step.toolJobId), [rootJob.id, childJob.id]);
});

// === Harness execution context（非 live，默认跑）===

test('MCP run_tool execution context 映射本地 jobDir 到 canonical workDir', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-mcp-context-'));
  const jobDir = path.join(root, 'mcp-tool-jobs', 'mcp_1');
  const outputDir = path.join(jobDir, 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  const { context, canonicalizePath } = _test.createMcpExecutionContext({
    jobDir,
    outputDir,
    runtime: 'r',
    runtimeCommand: '/opt/R/bin/Rscript',
    localRoot: root,
    canonicalRoot: '/work/biof3',
  });

  assert.equal(context.adapter.kind, 'local');
  assert.equal(context.runtime, 'r');
  assert.equal(context.runtimeReady.ready, true);
  assert.equal(context.workDir, jobDir);
  assert.equal(context.canonicalWorkDir, '/work/biof3/mcp-tool-jobs/mcp_1');
  assert.equal(context.canonicalOutputDir, '/work/biof3/mcp-tool-jobs/mcp_1/output');
  assert.equal(canonicalizePath(path.join(outputDir, 'plot.png')), '/work/biof3/mcp-tool-jobs/mcp_1/output/plot.png');
});

test('MCP artifact summary 带 canonicalPath，供后续 Agent/平台抽象稳定引用', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-mcp-artifacts-'));
  const resultDir = path.join(root, 'mcp-tool-jobs', 'mcp_2', 'output');
  fs.mkdirSync(resultDir, { recursive: true });

  const canonicalizePath = (value) =>
    _test.canonicalizePath(value, { localRoot: root, canonicalRoot: '/work/biof3' });
  const artifacts = _test.normalizeArtifacts({
    manifestItems: [{ id: 'plot', name: 'volcano.png', type: 'plot', label: 'Volcano Plot' }],
    outFiles: ['volcano.png', 'table.csv'],
    resultDir,
    canonicalizePath,
  });

  assert.equal(artifacts.length, 2);
  assert.equal(artifacts[0].path, path.join(resultDir, 'volcano.png'));
  assert.equal(artifacts[0].canonicalPath, '/work/biof3/mcp-tool-jobs/mcp_2/output/volcano.png');
  assert.equal(artifacts[1].type, 'table');
  assert.equal(artifacts[1].canonicalPath, '/work/biof3/mcp-tool-jobs/mcp_2/output/table.csv');
});

test('MCP file-input staging contains plugin ids and rejects reserved control filenames', () => {
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-mcp-input-stage-'));
  const safe = _test.resolveStagedInputPath(jobDir, 'expr_matrix', '/uploads/source.csv');
  assert.deepEqual(safe, {
    ok: true,
    name: 'expr_matrix.csv',
    stagedPath: path.join(jobDir, 'expr_matrix.csv'),
  });
  for (const inputId of ['../outside', 'nested/input', 'nested\\input', '.', '..']) {
    assert.equal(_test.resolveStagedInputPath(jobDir, inputId, '/uploads/source.csv').ok, false, inputId);
  }
  assert.deepEqual(
    _test.resolveStagedInputPath(jobDir, 'manifest', '/uploads/source.json'),
    { ok: false, error: 'plugin_input_name_reserved' },
  );
});

test('MCP existing tool_job rejects user/project/conversation/tool identity drift before execution', async () => {
  const builtInDir = resolve(__dirname, '..', 'resources', 'built-in-plugins', 'volcano-plot');
  globalThis._biof3Plugins = new Map();
  globalThis._biof3Plugins.set('volcano-plot', {
    id: 'volcano-plot',
    version: '1.0.0',
    language: 'r',
    pluginDir: builtInDir,
    scriptPath: path.join(builtInDir, 'scripts'),
  });
  const job = db.createToolJob({
    toolId: 'volcano-plot',
    userId: 'mcp-owner',
    projectId: 'mcp-project',
    conversationId: 'mcp-conversation-a',
    params: { deg_table: '/tmp/does-not-run.csv' },
    status: 'failed',
  });
  try {
    for (const opts of [
      { userId: 'mcp-other', projectId: 'mcp-project', conversationId: 'mcp-conversation-a' },
      { userId: 'mcp-owner', projectId: 'mcp-other', conversationId: 'mcp-conversation-a' },
      { userId: 'mcp-owner', projectId: 'mcp-project', conversationId: 'mcp-conversation-b' },
      { userId: 'mcp-owner', projectId: 'mcp-project', conversationId: 'mcp-conversation-a', toolJobId: job.id },
    ]) {
      const result = await callTool(
        opts.toolJobId ? 'go-kegg' : 'volcano-plot',
        { deg_table: '/tmp/does-not-run.csv' },
        { ...opts, toolJobId: job.id },
      );
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /tool_job 身份校验失败/);
    }
    assert.equal(db.getToolJob(job.id).status, 'failed');
  } finally {
    db.getDatabase().prepare('DELETE FROM tool_jobs WHERE id=?').run(job.id);
    globalThis._biof3Plugins = new Map();
  }
});

test('MCP plugin execution fails closed when a new tool_job cannot be persisted', async () => {
  const builtInDir = resolve(__dirname, '..', 'resources', 'built-in-plugins', 'volcano-plot');
  globalThis._biof3Plugins = new Map();
  globalThis._biof3Plugins.set('volcano-plot', {
    id: 'volcano-plot',
    version: '1.0.0',
    language: 'r',
    pluginDir: builtInDir,
    scriptPath: path.join(builtInDir, 'scripts'),
  });
  const originalCreateToolJob = db.createToolJob;
  db.createToolJob = () => { throw new Error('injected_persistence_failure'); };
  try {
    const result = await callTool('volcano-plot', {
      deg_table: '/tmp/does-not-run.csv',
    }, {
      userId: 'mcp-owner',
      projectId: 'mcp-project',
      conversationId: 'mcp-conversation',
    });
    assert.equal(result.isError, true);
    assert.equal(result.toolJobId, undefined);
    assert.match(result.content[0].text, /tool_job 持久化校验失败/);
  } finally {
    db.createToolJob = originalCreateToolJob;
    globalThis._biof3Plugins = new Map();
  }
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
  const sqlite = db.getDatabase();
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
  const sqlite = db.getDatabase();
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
