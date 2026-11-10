/**
 * BLOCK-394 23 条 Agent 侧逐件交付台账契约：无静默消失、无冒 verified。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance/post-s7-2026-11-09/h7/gap-ledger.json'), 'utf8'));
const AGENT = ledger.gaps.filter((g) => g.agentSideOutcome);

test('23 条逐件有终态 / 交付 / 证据（无静默消失）', () => {
  assert.equal(AGENT.length, 23);
  for (const g of AGENT) {
    assert.ok(['completed', 'completed-with-declared-exception'].includes(g.agentSideOutcome), g.id);
    assert.ok(g.agentSideDelivery && g.agentSideDelivery.length > 20, `${g.id} 缺交付说明`);
    assert.ok(g.agentSideEvidence && g.agentSideEvidence.length > 5, `${g.id} 缺证据`);
  }
  assert.equal(ledger.agentSideProgram.completed + ledger.agentSideProgram.completedWithDeclaredException, 23);
});

test('人眼主类 4 / 凭据 1 / 用户裁决 1 / 已完成 5 不在本包范围（未被改写）', () => {
  const outside = ledger.gaps.filter((g) => !g.agentSideOutcome);
  assert.equal(outside.length, 11);
  assert.equal(outside.filter((g) => g.blocker === 'human_eye').length, 4);
  assert.equal(outside.filter((g) => g.blocker === 'credential').length, 1);
  assert.equal(outside.filter((g) => g.blocker === 'user_decision').length, 1);
  assert.equal(outside.filter((g) => g.blocker === 'none').length, 5);
});

test('挂起项必须明说原因、不冒 verified；status 以最新一轮交付为准', () => {
  // 两轮字段：agentSideOutcome（一轮）→ round2Outcome（二轮）后者优先。
  // 二轮把 B-11/B-18 推到 completed，status 随之变 done，不能让一轮的 except 标签僵化。
  const latest = (g) => g.round2Outcome || g.agentSideOutcome;
  for (const g of AGENT) {
    assert.ok(['completed', 'completed-with-declared-exception'].includes(latest(g)), g.id);
    if (latest(g) === 'completed') assert.equal(g.status, 'done', g.id + ' 完成应为 done');
    else {
      assert.equal(g.status, 'done-partial', g.id + ' 挂起项不得标 done');
      const text = g.agentSideDelivery + ' ' + (g.round2Delivery || '');
      assert.ok(/挂起|需|仍|不代答|另立|独立|如实|未|待人眼|待裁决|路径差异/.test(text), g.id + ' 未写明挂起边界');
    }
  }
  assert.ok(AGENT.some((g) => latest(g) === 'completed'), '必须有真完成项');
  assert.ok(AGENT.some((g) => latest(g) === 'completed-with-declared-exception'), '必须有如实挂起项');
});

test('计数机械汇总，负测：删一条即红', () => {
  const counts = {};
  for (const g of ledger.gaps) counts[g.status] = (counts[g.status] || 0) + 1;
  assert.deepEqual(counts, ledger.summary.counts);
  const dropped = ledger.gaps.filter((g) => g.id !== 'B-24');
  const recount = {}; for (const g of dropped) recount[g.status] = (recount[g.status] || 0) + 1;
  assert.notDeepEqual(recount, ledger.summary.counts);
});
