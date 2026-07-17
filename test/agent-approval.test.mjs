// agent-led 阶段2 Task3 测试：重操作 run_tool 强制确认
// 运行：cd desktop-app && node --test test/agent-approval.test.mjs
// 验证：HEAVY_TOOLS 首次 run 返回 needApproval → ack(approve) → 重调 ackToken 续跑
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R_SERVER = resolve(__dirname, '..', 'core', 'r-server');
const req = createRequire(import.meta.url);

const db = req(R_SERVER + '/db.js');
const { tool_run_tool } = req(R_SERVER + '/agent-tools/plan-ui-tools.js');
// 直接 require learning.js 拿 tool_run_tool（它在那里定义并导出）
const learning = req(R_SERVER + '/agent-tools/learning.js');
const { dispatchTool, inferExecutionPolicy } = req(R_SERVER + '/agent-tools/index.js');

const CTX = { userId: 'local-user' };

test('只读检查请求禁止 run，但允许 list', async () => {
  const policy = inferExecutionPolicy([
    {
      role: 'user',
      content: '请检查当前项目中的文件，先不要执行任何分析，只告诉我关键列和下一步。',
    },
  ]);
  assert.equal(policy.allowExecution, false);

  const listed = await dispatchTool('run_tool', { op: 'list' }, { ...CTX, ...policy });
  assert.equal(listed.ok, true);

  const blocked = await dispatchTool(
    'run_tool',
    { op: 'run', toolId: 'deseq2', params: { padj_cutoff: 0.05 } },
    { ...CTX, allowExecution: policy.allowExecution, executionPolicyReason: policy.reason },
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'execution_not_allowed');
});

test('明确确认续跑不被只读关键词误拦截', () => {
  const policy = inferExecutionPolicy([
    {
      role: 'user',
      content: '用户已确认开始（ackToken=ack_9959ea82-9dc）。请重调 run_tool 续跑该重操作。',
    },
  ]);
  assert.equal(policy.allowExecution, true);
});

test('deseq2 首次 run 返回 needApproval + ackToken', async () => {
  // 用 deseq2（在 HEAVY_TOOLS 白名单）
  const r = await learning.tool_run_tool(
    { op: 'run', toolId: 'deseq2', params: { counts: '/fake/counts.csv' } },
    CTX
  );
  assert.equal(r.ok, true);
  assert.equal(r.needApproval, true, '应返回 needApproval=true');
  assert.ok(r.ackToken, '应返回 ackToken');
  assert.ok(r.toolJobId, '应建 tool_jobs 记录');

  // DB 里 ack_status 应为 pending
  const job = db.getToolJob(r.toolJobId);
  assert.equal(job.ack_status, 'pending');
  assert.equal(job.ack_token, r.ackToken);
  assert.ok(job.ack_expires_at > Date.now(), 'ack_expires_at 应在未来');

  // 清理
  const sqlite = db.getDatabase();
  sqlite.prepare('DELETE FROM tool_jobs WHERE id=?').run(r.toolJobId);
});

test('ack(approve) 后 ack_status 变 approved', async () => {
  const r = await learning.tool_run_tool(
    { op: 'run', toolId: 'deseq2', params: {} },
    CTX
  );
  const job = db.ackToolJob(r.ackToken, true);
  assert.equal(job.ack_status, 'approved');

  const sqlite = db.getDatabase();
  sqlite.prepare('DELETE FROM tool_jobs WHERE id=?').run(r.toolJobId);
});

test('ack(reject) 后重调 ackToken 返回 user_rejected', async () => {
  const r = await learning.tool_run_tool(
    { op: 'run', toolId: 'deseq2', params: {} },
    CTX
  );
  db.ackToolJob(r.ackToken, false);
  const r2 = await learning.tool_run_tool(
    { op: 'run', toolId: 'deseq2', params: {}, ackToken: r.ackToken },
    CTX
  );
  assert.equal(r2.ok, false);
  assert.equal(r2.error, 'user_rejected');

  const sqlite = db.getDatabase();
  sqlite.prepare('DELETE FROM tool_jobs WHERE id=?').run(r.toolJobId);
});

test('volcano-plot（非重操作）不拦截，直接跑', async () => {
  // volcano-plot 不在 HEAVY_TOOLS，不应返回 needApproval
  // 注：这里只验证不拦截，不真跑 R（callTool 会跑 R，但 volcano-plot 不在白名单走 _executeRunTool）
  // 用一个不存在的 toolId 触发 callTool 失败，但确认没返回 needApproval
  const r = await learning.tool_run_tool(
    { op: 'run', toolId: 'volcano-plot', params: { deg_table: '/nonexistent.csv' } },
    CTX
  );
  assert.equal(r.needApproval, undefined, 'volcano-plot 不应触发确认拦截');
  // 跑会失败（文件不存在），但 ok=false 且 error 是 tool_failed，不是 needApproval
  assert.equal(r.ok, false);
  assert.notEqual(r.error, 'approval_invalid');
});

test('未注册的重工具不会生成待确认 tool_job', async () => {
  // ml-classifier 在 HEAVY_TOOLS 白名单里，但未打包成 built-in 插件（不可发现），
  // 因此走 callTool 应直接 unknown_tool，跑前不落 ack_status='pending' 的 tool_job。
  // （wgcna 曾用于此断言，Stage 3 打包成 built-in 插件后已可发现，故换成仍未注册的重工具）
  const sqlite = db.getDatabase();
  const countJobs = sqlite.prepare("SELECT COUNT(*) AS count FROM tool_jobs WHERE tool_id='ml-classifier'");
  const before = countJobs.get().count;
  const r = await learning.tool_run_tool(
    { op: 'run', toolId: 'ml-classifier', params: {} },
    CTX
  );
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unknown_tool');
  assert.equal(countJobs.get().count, before);
});

test('已移除的单细胞步骤不会生成待确认 tool_job', async () => {
  const sqlite = db.getDatabase();
  const countJobs = sqlite.prepare("SELECT COUNT(*) AS count FROM tool_jobs WHERE tool_id='doublet'");
  const before = countJobs.get().count;
  const r = await learning.tool_run_tool(
    { op: 'run', toolId: 'doublet', params: { inputFile: '/tmp/input.rds' } },
    CTX,
  );
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unknown_tool');
  assert.equal(countJobs.get().count, before);
});

test('Agent 可以获取只规划不自动执行的标准分析计划', async () => {
  const listed = await learning.tool_run_tool({ op: 'list' }, CTX);
  assert.ok(listed.workflowTemplates.some((item) => item.id === 'bulk-rna-core'));
  const planned = await learning.tool_run_tool(
    {
      op: 'plan',
      templateId: 'bulk-rna-core',
      initialInputs: { counts: '/data/counts.csv', coldata: '/data/groups.csv' },
    },
    CTX,
  );
  assert.equal(planned.ok, true);
  assert.equal(planned.plan.autoExecute, false);
  assert.equal(planned.plan.executionPolicy, 'agent_led_existing_tools');
  assert.equal(planned.plan.steps[0].inputs.counts, '/data/counts.csv');
});

test('Agent 只能把真实 tool_job 中已验证的 artifact 绑定到下游', async () => {
  const planned = await learning.tool_run_tool(
    { op: 'plan', templateId: 'bulk-rna-core' },
    CTX,
  );
  const job = db.createToolJob({
    toolId: 'deseq2',
    userId: CTX.userId,
    status: 'completed',
    params: {},
  });
  db.updateToolJob(job.id, {
    status: 'completed',
    resultJson: {
      artifactTruth: { status: 'valid', validCount: 1 },
      artifacts: [
        { id: 'deg_table', name: 'deg.csv', path: '/results/deg.csv', type: 'table' },
      ],
    },
    completedAt: Date.now(),
  });
  const bound = await learning.tool_run_tool(
    {
      op: 'bind_artifact',
      workflowPlan: planned.plan,
      fromToolJobId: job.id,
      fromStepId: 'differential',
      toStepId: 'volcano',
      inputId: 'deg_table',
      artifactId: 'deg_table',
    },
    CTX,
  );
  assert.equal(bound.ok, true);
  assert.equal(bound.plan.steps.find((step) => step.id === 'volcano').inputs.deg_table, '/results/deg.csv');
  assert.equal(bound.plan.lineage[0].fromToolJobId, job.id);
  const sqlite = db.getDatabase();
  sqlite.prepare('DELETE FROM tool_jobs WHERE id=?').run(job.id);
});
