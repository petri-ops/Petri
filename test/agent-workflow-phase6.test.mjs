// agent-workflow-phase6.test.mjs — Phase 6 integration tests: op=status + op=next
// Run: node --test test/agent-workflow-phase6.test.mjs
// Tests run_tool(op=status) and run_tool(op=next) against real DB + workflow functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R_SERVER = resolve(__dirname, '..', 'core', 'r-server');
const req = createRequire(import.meta.url);

const db = req(R_SERVER + '/db.js');
const learning = req(R_SERVER + '/agent-tools/learning.js');

const CTX = { userId: 'phase6-user', projectId: 'phase6-project' };

test('op=plan returns a workflow plan that can be passed to op=status', async () => {
  const planned = await learning.tool_run_tool({ op: 'plan', templateId: 'bulk-rna-core' }, CTX);
  assert.equal(planned.ok, true);
  assert.ok(planned.plan, 'plan 应返回 plan 对象');
  assert.ok(Array.isArray(planned.plan.steps), 'plan.steps 应为数组');
  assert.equal(planned.plan.agentWorkflowPlanVersion, 1);
});

test('op=status returns projected plan without auto-executing anything', async () => {
  const planned = await learning.tool_run_tool({ op: 'plan', templateId: 'bulk-rna-core' }, CTX);
  const status = await learning.tool_run_tool({ op: 'status', workflowPlan: planned.plan }, CTX);
  assert.equal(status.ok, true);
  assert.ok(status.plan, 'status 应返回 plan');
  assert.ok(Array.isArray(status.plan.steps), 'steps 应为数组');
  assert.equal(status.plan.agentWorkflowPlanVersion, 1);
  assert.ok(typeof status.terminal === 'boolean', 'terminal 应为 boolean');
  assert.ok(typeof status.recoverable === 'boolean', 'recoverable 应为 boolean');
  assert.ok(Array.isArray(status.readyStepIds), 'readyStepIds 应为数组');
  assert.ok(Array.isArray(status.nextActions), 'nextActions 应为数组');
  assert.ok(typeof status.stepCount === 'number', 'stepCount 应为数字');
  assert.ok(typeof status.completedCount === 'number', 'completedCount 应为数字');
});

test('op=status returns empty jobs array when no toolJobIds are bound', async () => {
  const planned = await learning.tool_run_tool({ op: 'plan', templateId: 'bulk-rna-core' }, CTX);
  const status = await learning.tool_run_tool({ op: 'status', workflowPlan: planned.plan }, CTX);
  assert.deepEqual(status.jobs, [], '没有绑定 job 时 jobs 应为空数组');
});

test('op=status fails gracefully with missing workflowPlan', async () => {
  const status = await learning.tool_run_tool({ op: 'status' }, CTX);
  assert.equal(status.ok, false);
  assert.equal(status.error, 'missing_workflow_plan');
});

test('op=next returns nextSteps derived from plan projection', async () => {
  const planned = await learning.tool_run_tool({ op: 'plan', templateId: 'bulk-rna-core' }, CTX);
  const next = await learning.tool_run_tool({ op: 'next', workflowPlan: planned.plan }, CTX);
  assert.equal(next.ok, true);
  assert.ok(Array.isArray(next.nextSteps), 'nextSteps 应为数组');
  assert.ok(typeof next.planStatus === 'string', 'planStatus 应为 string');
  assert.ok(typeof next.terminal === 'boolean', 'terminal 应为 boolean');
  assert.ok(Array.isArray(next.nextActions), 'nextActions 应为数组');
});

test('op=next fails gracefully with missing workflowPlan', async () => {
  const next = await learning.tool_run_tool({ op: 'next' }, CTX);
  assert.equal(next.ok, false);
  assert.equal(next.error, 'missing_workflow_plan');
});

test('op=status + next reflect real DB job state after tool run', async () => {
  // 1. Plan
  const planned = await learning.tool_run_tool({ op: 'plan', templateId: 'bulk-rna-core' }, CTX);
  const differentialStep = planned.plan.steps.find((s) => s.id === 'differential');
  assert.ok(differentialStep, '应有 differential 步骤');

  // 2. Create completed job producing the verified deg_table artifact
  const job = db.createToolJob({
    toolId: 'deseq2',
    userId: CTX.userId,
    projectId: CTX.projectId,
    status: 'completed',
    params: {},
    name: 'differential',
  });
  db.updateToolJob(job.id, {
    status: 'completed',
    resultJson: {
      artifactTruth: { status: 'valid', validCount: 2 },
      artifacts: [
        { id: 'deg_table', name: 'deg.csv', path: '/results/deg.csv', type: 'table' },
      ],
    },
    completedAt: Date.now(),
  });

  // Bind deg_table to volcano
  const bound = await learning.tool_run_tool({
    op: 'bind_artifact',
    workflowPlan: planned.plan,
    fromToolJobId: job.id,
    fromStepId: 'differential',
    toStepId: 'volcano',
    inputId: 'deg_table',
    artifactId: 'deg_table',
  }, CTX);
  assert.equal(bound.ok, true, 'bind_artifact(volcano) 应成功');

  // Bind the same verified DEG artifact to enrichment
  const bound2 = await learning.tool_run_tool({
    op: 'bind_artifact',
    workflowPlan: bound.plan,
    fromToolJobId: job.id,
    fromStepId: 'differential',
    toStepId: 'enrichment',
    inputId: 'deg_table',
    artifactId: 'deg_table',
  }, CTX);
  assert.equal(bound2.ok, true, 'bind_artifact(enrichment) 应成功');

  // 3. Update bound plan step toolJobId to reflect the job
  const updatedPlan = {
    ...bound2.plan,
    steps: bound2.plan.steps.map((s) =>
      s.id === 'differential' ? { ...s, toolJobId: job.id } : s
    ),
  };

  // 4. status should show differential as complete
  const status = await learning.tool_run_tool({ op: 'status', workflowPlan: updatedPlan }, CTX);
  assert.equal(status.ok, true);
  const completedSteps = status.plan.steps.filter((s) => s.status === 'complete');
  assert.ok(completedSteps.some((s) => s.id === 'differential'), 'differential 应为 complete');

  // 5. next should show volcano as ready (dependency satisfied, maps to plugin tool)
  const next = await learning.tool_run_tool({ op: 'next', workflowPlan: updatedPlan }, CTX);
  assert.equal(next.ok, true);
  const nextIds = next.nextSteps.map((s) => s.stepId);
  assert.ok(nextIds.includes('volcano'), 'volcano 应在 nextSteps');
  // 'enrichment' 原映射到已移除的单细胞 step 工具；工作流稳定后将重指向插件工具，
  // 届时恢复该断言。当前 step 引擎已下线，不再要求 enrichment 就绪。

  // Cleanup
  const sqlite = db.getDatabase();
  sqlite.prepare('DELETE FROM tool_jobs WHERE id=?').run(job.id);
});

test('op=status shows waiting_for_confirmation for pending-ack jobs', async () => {
  // Create a job with ack_status=pending
  const job = db.createToolJob({
    toolId: 'deseq2',
    userId: CTX.userId,
    projectId: CTX.projectId,
    status: 'pending',
    params: {},
    name: 'deseq2-pending',
  });
  db.setToolJobApproval(job.id, 'ack_phase6_test', Date.now() + 300_000);

  const planned = await learning.tool_run_tool({ op: 'plan', templateId: 'bulk-rna-core' }, CTX);
  const planWithJob = {
    ...planned.plan,
    steps: planned.plan.steps.map((s) =>
      s.id === 'differential' ? { ...s, toolJobId: job.id } : s
    ),
  };

  const status = await learning.tool_run_tool({ op: 'status', workflowPlan: planWithJob }, CTX);
  assert.equal(status.ok, true);
  const diffStep = status.plan.steps.find((s) => s.id === 'differential');
  assert.equal(diffStep.status, 'waiting_for_confirmation', 'pending-ack job 应映射到 waiting_for_confirmation');
  assert.ok(status.nextActions.some((a) => a.id === 'confirm_differential'), '应有 confirm action');

  // Cleanup
  const sqlite = db.getDatabase();
  sqlite.prepare('DELETE FROM tool_jobs WHERE id=?').run(job.id);
});

test('op=next returns empty nextSteps when plan is terminal', async () => {
  const planned = await learning.tool_run_tool({ op: 'plan', templateId: 'bulk-rna-core' }, CTX);

  // Make all steps complete
  const allCompletePlan = {
    ...planned.plan,
    status: 'complete',
    steps: planned.plan.steps.map((s) => ({ ...s, status: 'complete' })),
  };

  const next = await learning.tool_run_tool({ op: 'next', workflowPlan: allCompletePlan }, CTX);
  assert.equal(next.ok, true);
  assert.deepEqual(next.nextSteps, [], 'terminal plan 的 nextSteps 应为空');
  assert.equal(next.terminal, true);
});

test('op=status returns harnessState on jobs when available', async () => {
  const job = db.createToolJob({
    toolId: 'deseq2',
    userId: CTX.userId,
    projectId: CTX.projectId,
    status: 'completed',
    params: {},
  });
  db.updateToolJob(job.id, {
    status: 'completed',
    resultJson: { artifactTruth: { status: 'valid', validCount: 1 }, artifacts: [] },
    completedAt: Date.now(),
  });

  const planned = await learning.tool_run_tool({ op: 'plan', templateId: 'bulk-rna-core' }, CTX);
  const planWithJob = {
    ...planned.plan,
    steps: planned.plan.steps.map((s) =>
      s.id === 'differential' ? { ...s, toolJobId: job.id } : s
    ),
  };

  const status = await learning.tool_run_tool({ op: 'status', workflowPlan: planWithJob }, CTX);
  assert.equal(status.ok, true);
  const differentialJob = status.jobs.find((j) => j.stepId === 'differential');
  assert.ok(differentialJob, 'differential job 应在 jobs 列表');
  assert.ok(differentialJob.harnessState, 'job 应包含 harnessState');
  assert.equal(differentialJob.harnessState.harnessWorkflowStateVersion, 1);
  assert.equal(differentialJob.harnessState.jobId, job.id);

  const sqlite = db.getDatabase();
  sqlite.prepare('DELETE FROM tool_jobs WHERE id=?').run(job.id);
});
