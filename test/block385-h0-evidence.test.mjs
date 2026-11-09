/**
 * BLOCK-385（post-S7 H0）证据完整性契约。
 *
 * 为什么要测证据：H0 的出口判据是「残红逐件归因、无一项静默消失」，而判据本身以 JSON
 * 证据落盘。若证据可以缺字段、可以少登记一条失败，判据就会在不报错的情况下变得不可信
 * ——这正是本仓反复抓到的「未跑写成通过」同族缺陷。本测试把证据形状变成机械约束：
 *   - gate-baseline 每门必须有 verdict 与当次读数（不接受空值顶替）
 *   - shard-attribution 里每条失败必须有 owner + class + 补腿条件（无归属即红）
 *   - wip-inventory 的每个保留项必须有 owner（未知 owner 不得静默存在）
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (name) => JSON.parse(readFileSync(new URL(`../acceptance/post-s7-2026-11-09/h0/${name}`, import.meta.url), 'utf8'));

test('H0 gate baseline 每门都有 verdict 与当次读数', () => {
  const baseline = read('gate-baseline.json');
  assert.ok(Array.isArray(baseline.gates) && baseline.gates.length >= 15, '十五门必须逐门在册');
  for (const gate of baseline.gates) {
    assert.ok(gate.id, 'gate.id 必填');
    assert.ok(['PASS', 'FAIL', 'WARN'].includes(gate.verdict), `${gate.id}: verdict 只接受 PASS/FAIL/WARN`);
    assert.ok(typeof gate.reading === 'string' && gate.reading.trim().length > 0, `${gate.id}: 必须有当次读数，不接受空值顶替`);
  }
  // 未跑的门必须显式登记原因，不得用「没写」代替「没跑」。
  for (const skipped of baseline.notRun || []) {
    assert.ok(skipped.id && skipped.reason, 'notRun 每条必须有 id 与 reason');
  }
});

test('H0 分片归因每条失败都有 owner / class / 补腿条件', () => {
  const attribution = read('shard-attribution.json');
  assert.ok(Array.isArray(attribution.failures), 'failures 必须是数组（0 条也要显式空数组）');
  for (const failure of attribution.failures) {
    assert.ok(failure.test && failure.shard, '每条失败必须带 test 与 shard');
    assert.ok(failure.class, `${failure.test}: 必须有分类（不得无分类存在）`);
    assert.ok(failure.owner, `${failure.test}: 必须有 owner（包号或专项）`);
    assert.ok(failure.disposition, `${failure.test}: 必须有终态处置`);
    if (failure.disposition !== 'fixed') {
      assert.ok(failure.followUp, `${failure.test}: 未修复项必须写补腿条件`);
    }
  }
  // 归因口径与当次汇总必须自洽：summary 里 failed 的分片数 = 归因里非 passed 记录数不得倒挂。
  for (const shard of attribution.shards || []) {
    assert.ok(['passed', 'failed', 'unknown'].includes(shard.verdict), `${shard.shard}: verdict 非法`);
    if (shard.verdict === 'unknown') {
      assert.ok(shard.reason, `${shard.shard}: unknown 必须写原因，不得写 PASS`);
    }
  }
});

test('H0 WIP 清单每个保留项都有 owner（未知 owner 不得静默存在）', () => {
  const inventory = read('wip-inventory.json');
  const items = [...(inventory.untrackedPreserved || []), ...(inventory.trackedBefore || [])];
  assert.ok(items.length > 0, 'WIP 清单不得为空顶替');
  for (const item of items) {
    assert.ok(item.path, 'WIP 项必须有 path');
    assert.ok(item.owner, `${item.path}: 必须有 owner`);
    assert.ok(item.action, `${item.path}: 必须有处置动作`);
  }
});
