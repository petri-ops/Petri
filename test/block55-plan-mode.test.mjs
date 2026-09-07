import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R_SERVER = resolve(__dirname, '..', 'core', 'biof3-server');
const require = createRequire(import.meta.url);

// 与 block49-spawn-agent-tools.test.mjs 同一自举手法：临时 DB（src/migrations 全量），
// BIOF3_DB_PATH 必须在 require db.js 前生效。
{
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const Database = require(R_SERVER + '/node_modules/better-sqlite3');
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-block55-db-'));
  const boot = new Database(path.join(tempDbDir, 'biof3.db'));
  const migrationsDir = resolve(__dirname, '..', 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  // 计划基础表 + BLOCK-55 additive DDL（与 ai-bridge 运行时迁移同一事实源）
  const planLifecycle = require('../core/biof3-server/helpers/plan-lifecycle.js');
  planLifecycle.ensurePlanBaseSchema(boot);
  planLifecycle.ensureBlock55PlanSchema(boot);
  boot.close();
  process.env.BIOF3_DB_PATH = path.join(tempDbDir, 'biof3.db');
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch {}
  });
}

const { decideAgentToolCall } = require('../core/biof3-server/agent-tools/agent-tool-policy.js');
const { getToolContract } = require('../core/biof3-server/agent-tools/registry.js');
const { tool_plan } = require('../core/biof3-server/agent-tools/plan-ui-tools.js');
const { approvePlanDraft, applyPlanRevision } = require('../core/biof3-server/helpers/plan-lifecycle.js');
const dbMod = require('../core/biof3-server/db.js');
const adb = dbMod.getAsyncDatabase();

const USER = 'u_block55';
const CTX = { userId: USER, conversationId: 'conv_b55' };

function contractOf(name) {
  const c = getToolContract(name);
  assert.ok(c, `contract missing for ${name}`);
  return c;
}

// ---------- P1：policy 层 plan 模式工具收编 ----------

test('plan 模式下有副作用工具被拒（plan_mode_active）', () => {
  for (const name of ['workspace_write', 'run_tool', 'spawn_agent']) {
    const args = name === 'run_tool' ? { op: 'run', toolId: 'x', params: {} } : name === 'workspace_write' ? { relativePath: 'work/a.txt', content: 'x' } : { task: 'x' };
    const d = decideAgentToolCall({ name, args, ctx: { planMode: true, accessMode: 'full' }, contract: contractOf(name) });
    assert.equal(d.decision, 'deny', `${name} 应被拒`);
    assert.equal(d.error, 'plan_mode_active', `${name} 错误码应为 plan_mode_active`);
  }
});

test('plan 模式下 plan 工具与只读工具放行', () => {
  const d1 = decideAgentToolCall({ name: 'plan', args: { op: 'create', title: 't', steps: [{ title: 's' }] }, ctx: { planMode: true, accessMode: 'full' }, contract: contractOf('plan') });
  assert.equal(d1.decision, 'allow', 'plan 工具是计划模式被授权主体');
  const d2 = decideAgentToolCall({ name: 'plan', args: { op: 'list' }, ctx: { planMode: true }, contract: contractOf('plan') });
  assert.equal(d2.decision, 'allow');
  const d3 = decideAgentToolCall({ name: 'workspace_read', args: { relativePath: 'work/a.txt' }, ctx: { planMode: true, accessMode: 'full' }, contract: contractOf('workspace_read') });
  assert.equal(d3.decision, 'allow', '只读探索保留');
  const d4 = decideAgentToolCall({ name: 'run_tool', args: { op: 'list' }, ctx: { planMode: true }, contract: contractOf('run_tool') });
  assert.equal(d4.decision, 'allow', 'run_tool 只读 op 保留');
});

test('无 planMode 时零行为变化（full 模式放行写工具）', () => {
  const d = decideAgentToolCall({ name: 'workspace_write', args: { relativePath: 'work/a.txt', content: 'x' }, ctx: { accessMode: 'full' }, contract: contractOf('workspace_write') });
  assert.equal(d.decision, 'allow');
});

// ---------- UI-303：accessMode='plan' 第四档（计划模式并入档位菜单） ----------

test("accessMode='plan' 档位等效 planMode：mutating 拒绝 + plan/只读放行（即使漏传 planMode 标志）", () => {
  for (const name of ['workspace_write', 'run_tool', 'spawn_agent']) {
    const args = name === 'run_tool' ? { op: 'run', toolId: 'x', params: {} } : name === 'workspace_write' ? { relativePath: 'work/a.txt', content: 'x' } : { task: 'x' };
    const d = decideAgentToolCall({ name, args, ctx: { accessMode: 'plan' }, contract: contractOf(name) });
    assert.equal(d.decision, 'deny', `${name} 应被拒`);
    assert.equal(d.error, 'plan_mode_active', `${name} 错误码应为 plan_mode_active`);
  }
  const d1 = decideAgentToolCall({ name: 'plan', args: { op: 'create', title: 't', steps: [{ title: 's' }] }, ctx: { accessMode: 'plan' }, contract: contractOf('plan') });
  assert.equal(d1.decision, 'allow', 'plan 工具是计划档位被授权主体');
  const d2 = decideAgentToolCall({ name: 'workspace_read', args: { relativePath: 'work/a.txt' }, ctx: { accessMode: 'plan' }, contract: contractOf('workspace_read') });
  assert.equal(d2.decision, 'allow', '只读探索保留');
});

test('UI-303 — PLAN_MODE_PROMPT_SECTION 共享常量导出且两条 agent 路径同源', () => {
  const { PLAN_MODE_PROMPT_SECTION } = require('../core/biof3-server/helpers/plans.js');
  assert.match(PLAN_MODE_PROMPT_SECTION, /=== 计划模式（Spec 门）===/);
  assert.match(PLAN_MODE_PROMPT_SECTION, /plan\(op="create"/);
});

// ---------- P1：draft 创建 + spec_md ----------

test('draft 创建：status=draft + spec_md 落库 + 步骤含 assignee', async () => {
  const r = await tool_plan({
    op: 'create',
    title: 'PBMC 分析方案',
    goal: '标准 PBMC 质控聚类注释',
    draft: true,
    specMd: '# 目标\n对 PBMC 做标准分析\n# 验收标准\nUMAP 有注释',
    steps: [
      { title: 'QC 过滤', hint: 'nFeature>200', assignee: 'subagent' },
      { title: '聚类与注释' },
    ],
  }, CTX);
  assert.ok(r.planId);
  assert.equal(r.status, 'draft');
  const detail = await tool_plan({ op: 'get', planId: r.planId }, CTX);
  assert.equal(detail.status, 'draft');
  assert.match(detail.spec_md, /PBMC 做标准分析/);
  assert.equal(detail.steps[0].assignee, 'subagent');
  assert.equal(detail.steps[1].assignee, null);
});

test('update_spec：draft 可改，active 拒绝', async () => {
  const created = await tool_plan({
    op: 'create', title: 't1', draft: true, specMd: 'v1',
    steps: [{ title: 's1' }],
  }, CTX);
  const upd = await tool_plan({ op: 'update_spec', planId: created.planId, specMd: 'v2 更新' }, CTX);
  assert.equal(upd.ok, true);
  const detail = await tool_plan({ op: 'get', planId: created.planId }, CTX);
  assert.match(detail.spec_md, /v2 更新/);

  const active = await tool_plan({ op: 'create', title: 't2', steps: [{ title: 's' }] }, CTX);
  const denied = await tool_plan({ op: 'update_spec', planId: active.planId, specMd: 'x' }, CTX);
  assert.equal(denied.error, 'plan_not_draft');
});

test('非 draft 创建零行为变化（status=active，回归）', async () => {
  const r = await tool_plan({ op: 'create', title: 'legacy', steps: [{ title: 's' }] }, CTX);
  assert.equal(r.status, 'active');
  const detail = await tool_plan({ op: 'get', planId: r.planId }, CTX);
  assert.equal(detail.status, 'active');
  assert.equal(detail.spec_md, null);
});

// ---------- P1：批准三选一 ----------

test('批准三选一：execute/execute-fresh 转 approved，keep-planning 不动，非 draft 拒绝', async () => {
  const p = await tool_plan({ op: 'create', title: 'p', draft: true, specMd: 's', steps: [{ title: 'a' }, { title: 'b', assignee: 'subagent' }] }, CTX);

  const keep = await approvePlanDraft(adb, USER, p.planId, 'keep-planning');
  assert.equal(keep.ok, true);
  assert.equal(keep.plan.status, 'draft', 'keep-planning 状态不动');

  const bad = await approvePlanDraft(adb, USER, p.planId, 'nonsense');
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'invalid_action');

  const fresh = await approvePlanDraft(adb, USER, p.planId, 'execute-fresh');
  assert.equal(fresh.ok, true);
  assert.equal(fresh.plan.status, 'approved');
  assert.equal(fresh.plan.steps.length, 2);

  const again = await approvePlanDraft(adb, USER, p.planId, 'execute');
  assert.equal(again.ok, false);
  assert.equal(again.error, 'plan_not_draft');

  const missing = await approvePlanDraft(adb, USER, 'plan_nope', 'execute');
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'plan_not_found');
});

// ---------- P2：assignee 步骤执行语义的模型侧契约（spawn/wait 由 BLOCK-49 覆盖） ----------

test('assignee 步骤经 update_step 正常回写（分派执行结果落库）', async () => {
  const p = await tool_plan({
    op: 'create', title: 'disp', draft: true, specMd: 's',
    steps: [{ title: 'QC', assignee: 'subagent' }, { title: '注释' }],
  }, CTX);
  const approved = await approvePlanDraft(adb, USER, p.planId, 'execute');
  assert.equal(approved.plan.status, 'approved');
  const done = await tool_plan({
    op: 'update_step', planId: p.planId, stepN: 1,
    stepStatus: 'done', stepResult: 'subagent 摘要：QC 完成 2700 细胞',
  }, CTX);
  assert.equal(done.ok, true);
  const detail = await tool_plan({ op: 'get', planId: p.planId }, CTX);
  assert.equal(detail.steps[0].status, 'done');
  assert.match(detail.steps[0].result, /subagent 摘要/);
});

// ---------- P3：replan 修订案 ----------

test('propose_revision + 批准替换：步骤整体替换，done 保留，历史可查，不可重复应用', async () => {
  const p = await tool_plan({
    op: 'create', title: 'replan', draft: true, specMd: 's',
    steps: [{ title: 's1' }, { title: 's2' }, { title: 's3' }],
  }, CTX);
  await approvePlanDraft(adb, USER, p.planId, 'execute');
  await tool_plan({ op: 'update_step', planId: p.planId, stepN: 1, stepStatus: 'done', stepResult: 'ok' }, CTX);
  await tool_plan({ op: 'update_step', planId: p.planId, stepN: 2, stepStatus: 'failed', stepResult: 'boom' }, CTX);

  const prop = await tool_plan({
    op: 'propose_revision', planId: p.planId, reason: 's2 数据形状不符，改用 v2 流程',
    steps: [
      { n: 1, title: 's1', status: 'done', result: 'ok' },
      { n: 2, title: 's2-v2', hint: '替换失败步骤' },
      { n: 3, title: 's3' },
      { n: 4, title: '新增校验', assignee: 'subagent' },
    ],
  }, CTX);
  assert.equal(prop.ok, true);
  assert.equal(prop.revisionNo, 1);

  const applied = await applyPlanRevision(adb, USER, p.planId, 1);
  assert.equal(applied.ok, true);
  assert.equal(applied.plan.steps.length, 4);
  assert.equal(applied.plan.steps[0].status, 'done', '已完成步骤保留');
  assert.equal(applied.plan.steps[1].title, 's2-v2');
  assert.equal(applied.plan.steps[3].assignee, 'subagent');

  const again = await applyPlanRevision(adb, USER, p.planId, 1);
  assert.equal(again.ok, false);
  assert.equal(again.error, 'revision_not_proposed');

  const nope = await applyPlanRevision(adb, USER, p.planId, 99);
  assert.equal(nope.ok, false);
  assert.equal(nope.error, 'revision_not_found');

  const revs = await adb.prepare('SELECT rev_no, status, reason FROM copilot_plan_revisions WHERE plan_id=? ORDER BY rev_no').all(p.planId);
  assert.equal(revs.length, 1);
  assert.equal(revs[0].status, 'applied');
  assert.match(revs[0].reason, /v2 流程/);
});

test('propose_revision 对 draft 计划拒绝（draft 走 update_spec）', async () => {
  const p = await tool_plan({ op: 'create', title: 'd', draft: true, specMd: 's', steps: [{ title: 'a' }] }, CTX);
  const r = await tool_plan({ op: 'propose_revision', planId: p.planId, steps: [{ title: 'b' }] }, CTX);
  assert.equal(r.error, 'plan_is_draft');
});
