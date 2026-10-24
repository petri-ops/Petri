// BLOCK-251 — 计划反馈接线守卫。
// PlanApprovalCard 的第二参数（feedback）必须原样传给 usePlanApprovalFlow.handlePlanApprove；
// 此前宿主写成 (action) => handlePlanApprove(action)，卡片单测与 hook 单测都绿，
// 端到端意见却在宿主这一行被丢掉（BLOCK-251 实机抓真）。
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../frontend/src/components/copilot/SimpleChat.tsx', import.meta.url), 'utf8');

test('PlanApprovalCard onApprove forwards feedback options to handlePlanApprove', () => {
  assert.match(
    source,
    /<PlanApprovalCard[\s\S]*?onApprove=\{\(action,\s*options\)\s*=>\s*void handlePlanApprove\(action,\s*options\)\}/,
    'SimpleChat 必须在 PlanApprovalCard 的 onApprove 中转发第二参数（计划调整意见）'
  );
  assert.doesNotMatch(
    source,
    /<PlanApprovalCard[\s\S]*?onApprove=\{\(action\)\s*=>\s*void handlePlanApprove\(action\)\}/,
    '不允许丢掉 PlanApprovalCard 的 feedback 参数'
  );
});
