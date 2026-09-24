/**
 * 「子智能体汇报收敛」+「终态对账」+「自动计划意图恢复」三包契约（2026-09-21 用户裁决）。
 *
 * 包一 汇报收敛：spawn 工具描述含汇报契约（父侧）；agent-runner 按 kind 注入
 *   子侧（只回传所辖要点）与父侧（不逐个转述、统一汇总）纪律。
 * 包二 终态对账：computeReconciliationNotice 纯函数（失败子任务 vs 全完成清单）
 *   + agent-runner 终态接线（reconciliation_notice + agent_status 用户可见面）。
 * 包三 自动计划意图恢复：detectAutoPlanIntent 纯函数（block60 测试向量 1:1）
 *   + agent-runner 接线（未显式开启时自动套用计划模式纪律）。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const runnerSrc = require('node:fs').readFileSync(
  path.join(root, 'core', 'biof3-server', 'agent-runner.js'), 'utf8'
);
const { detectAutoPlanIntent, latestUserText } = require(
  path.join(root, 'core', 'biof3-server', 'helpers', 'plan-intent.js')
);
const { computeReconciliationNotice } = require(
  path.join(root, 'core', 'biof3-server', 'helpers', 'agent-reconciliation.js')
);

// ---------- 包一：汇报收敛 ----------

test('包一 汇报收敛 — spawn_agent 工具描述携带父侧汇报契约', () => {
  const defs = require(path.join(root, 'core', 'biof3-server', 'agent-tools', 'tool-defs', 'agent-orchestration.js'));
  const spawn = defs.find((d) => d.function && d.function.name === 'spawn_agent');
  assert.ok(spawn, 'spawn_agent 定义在位');
  assert.match(spawn.function.description, /汇报契约/);
  assert.match(spawn.function.description, /只回传其所辖部分的核对要点/);
  assert.match(spawn.function.description, /不要在正文中逐个转述/);
});

test('包一 汇报收敛 — agent-runner 按 kind 注入子/父两侧纪律（源码契约）', () => {
  assert.match(runnerSrc, /=== 汇报契约 ===/);
  assert.match(runnerSrc, /只回传你所辖部分的核对要点/);
  assert.match(runnerSrc, /=== 子智能体结果汇报纪律 ===/);
  assert.match(runnerSrc, /不要在正文里逐个复述子智能体的结果/);
  assert.match(runnerSrc, /统一汇总/);
  // 分支条件：子侧 kind === 'subagent'（汇报契约分支先于其文案出现）
  const branchIdx = runnerSrc.indexOf("if (kind === 'subagent') {");
  const contractIdx = runnerSrc.indexOf("=== 汇报契约 ===");
  assert.ok(branchIdx > -1 && contractIdx > branchIdx, '汇报契约分支与文案在位且次序正确');
});

// ---------- 包二：终态对账 ----------

test('包二 终态对账 — 失败子任务 × 全完成清单 → 提示；其余情形 → null', () => {
  const todosAllDone = [{ status: 'completed' }, { status: 'completed' }, { status: 'completed' }];
  const todosPartial = [{ status: 'completed' }, { status: 'pending' }];
  const childrenMixed = [{ status: 'completed' }, { status: 'failed' }, { status: 'completed' }];
  const childrenAllDone = [{ status: 'completed' }, { status: 'completed' }];

  const notice = computeReconciliationNotice(todosAllDone, childrenMixed);
  assert.ok(notice, '失败子任务+全完成清单 → 判未对账');
  assert.equal(notice.kind, 'failed_children_vs_completed_checklist');
  assert.equal(notice.failedCount, 1);
  assert.equal(notice.cancelledCount, 0);
  assert.equal(notice.totalCount, 3);
  assert.match(notice.message, /对账提示：1\/3 个子智能体未正常完成/);

  // v1.5 — cancelled 同为未清
  const withCancelled = computeReconciliationNotice(
    todosAllDone,
    [{ status: 'completed' }, { status: 'cancelled' }]
  );
  assert.ok(withCancelled, '被取消子任务也判未对账');
  assert.equal(withCancelled.cancelledCount, 1);
  assert.match(withCancelled.message, /取消 1/);

  assert.equal(computeReconciliationNotice(todosAllDone, childrenAllDone), null, '全完成无失败 → 一致');
  assert.equal(computeReconciliationNotice(todosPartial, childrenMixed), null, '清单未全完成 → 不判');
  assert.equal(computeReconciliationNotice([], childrenMixed), null, '空清单 → 不判');
  assert.equal(computeReconciliationNotice(todosAllDone, []), null, '无子任务 → 不判');
});

test('包二 终态对账 — agent-runner 终态接线（源码契约）', () => {
  assert.match(runnerSrc, /reconciliation_notice/);
  assert.match(runnerSrc, /computeReconciliationNotice\(/);
  assert.match(runnerSrc, /phase: 'reconciliation'/);
  // 仅主任务对账（子任务不做）
  assert.match(runnerSrc, /if \(kind !== 'subagent'\) \{[^]*?computeReconciliationNotice/);
});

// ---------- 包三：自动计划意图恢复 ----------

test('包三 自动计划 — 计划意图触发（block60 向量 1:1）', () => {
  for (const text of [
    '先别执行，给我个计划',
    '先出个方案再动手',
    '不要直接执行，先规划一下步骤',
    '只讨论思路，先做个计划',
    '先规划这次的差异分析怎么做',
  ]) {
    assert.equal(detectAutoPlanIntent(text), true, `应触发: ${text}`);
  }
});

test('包三 自动计划 — 执行类短指令不触发', () => {
  for (const text of [
    '直接跑 deseq2',
    '开始执行吧',
    '马上执行这个分析',
    '直接执行 volcano-plot 重新出图',
  ]) {
    assert.equal(detectAutoPlanIntent(text), false, `不应触发: ${text}`);
  }
});

test('包三 自动计划 — 执行词压制计划词 + 空输入', () => {
  assert.equal(detectAutoPlanIntent('先做个计划，然后直接执行'), false);
  assert.equal(detectAutoPlanIntent('帮我看看这个数据的质量情况'), false);
  assert.equal(detectAutoPlanIntent(''), false);
  assert.equal(detectAutoPlanIntent(null), false);
});

test('包三 自动计划 — latestUserText 取最近一条用户消息', () => {
  const msgs = [
    { role: 'user', content: '第一条' },
    { role: 'assistant', content: '回复' },
    { role: 'user', content: '先出个方案再动手' },
  ];
  assert.equal(latestUserText(msgs), '先出个方案再动手');
  assert.equal(latestUserText([]), '');
  assert.equal(latestUserText(null), '');
});

test('包三 自动计划 — agent-runner 接线（源码契约：显式优先、自动其后、注入在 PLAN 段之前）', () => {
  assert.match(runnerSrc, /detectAutoPlanIntent\(latestUserText\(messages\)\)/);
  assert.match(runnerSrc, /const planModeActive = planModeExplicit \|\| planModeAuto;/);
  const autoIdx = runnerSrc.indexOf('const planModeAuto =');
  const injectIdx = runnerSrc.indexOf('if (planModeActive) {');
  assert.ok(autoIdx > -1 && injectIdx > autoIdx, '自动判定在计划模式注入之前');
});

// ---------- BLOCK-120 v2：条目级归属（todo 条目 ↔ 子任务 linkage） ----------

const TODO_ALL_DONE_V2 = [
  { id: '1', content: '盘点数据集质量', status: 'completed' },
  { id: '2', content: '跑 deseq2 差异分析', status: 'completed' },
  { id: '3', content: '整理报告', status: 'completed' },
];

test('BLOCK-120 v2 — 失败子任务带 todoRefs 且条目已 completed → item_level_mismatch 点名条目', () => {
  const children = [
    { taskId: 'child-a', status: 'completed', params: { todoRefs: ['1'] } },
    { taskId: 'child-b', status: 'failed', params: { todoRefs: ['2'] } },
    { taskId: 'child-c', status: 'completed', params: { todoRefs: ['3'] } },
  ];
  const notice = computeReconciliationNotice(TODO_ALL_DONE_V2, children);
  assert.ok(notice, '条目级失真应出提示');
  assert.equal(notice.kind, 'item_level_mismatch');
  assert.equal(notice.failedCount, 1);
  assert.deepEqual(
    notice.items.map((i) => ({ itemId: i.itemId, childStatus: i.childStatus })),
    [{ itemId: '2', childStatus: 'failed' }]
  );
  assert.equal(notice.items[0].content, '跑 deseq2 差异分析');
  assert.match(notice.message, /跑 deseq2 差异分析/, 'message 点名条目内容');
  assert.match(notice.message, /失败/);
});

test('BLOCK-120 v2 — 取消子任务同样触发条目级归属（v1.5 口径延伸）', () => {
  const children = [{ taskId: 'child-x', status: 'cancelled', params: { todoRefs: ['1'] } }];
  const notice = computeReconciliationNotice(TODO_ALL_DONE_V2, children);
  assert.ok(notice);
  assert.equal(notice.kind, 'item_level_mismatch');
  assert.equal(notice.items[0].childStatus, 'cancelled');
  assert.match(notice.message, /被取消/);
});

test('BLOCK-120 v2 — 无 linkage（子任务无 todoRefs）→ 回退 v1 粗粒度 kind（向后兼容）', () => {
  const children = [{ taskId: 'child-a', status: 'failed', params: {} }];
  const notice = computeReconciliationNotice(TODO_ALL_DONE_V2, children);
  assert.ok(notice);
  assert.equal(notice.kind, 'failed_children_vs_completed_checklist');
  assert.equal(notice.items, undefined);
});

test('BLOCK-120 v2 — linked 子任务正常完成 / refs 指向非完成条目 → 不出提示或仅 v1 兜底', () => {
  // linked 但子任务正常 → 无失真
  const clean = [{ taskId: 'child-a', status: 'completed', params: { todoRefs: ['1'] } }];
  assert.equal(computeReconciliationNotice(TODO_ALL_DONE_V2, clean), null);
  // ref 指向的条目未标记 completed（清单非全 completed）→ v1 门即不出提示
  const partialList = [
    { id: '1', status: 'completed' },
    { id: '2', status: 'pending' },
  ];
  assert.equal(computeReconciliationNotice(partialList, [{ taskId: 'x', status: 'failed', params: { todoRefs: ['2'] } }]), null);
  // ref 指向清单中不存在的 id（派发侧应已丢弃，防御性再兜底）→ 无条目级命中
  const ghost = [{ taskId: 'x', status: 'failed', params: { todoRefs: ['ghost'] } }];
  const n = computeReconciliationNotice(TODO_ALL_DONE_V2, ghost);
  assert.equal(n.kind, 'failed_children_vs_completed_checklist', '回退 v1 粗粒度');
});
