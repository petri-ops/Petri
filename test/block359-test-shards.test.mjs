import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildShardPlan } from '../scripts/test-all-shards.mjs';

/**
 * BLOCK-359（W0-9）— 全量测试三段分片的确定性契约。
 *
 * 背景：test:all:workspace 一次性跑全量曾 ~40 分钟被 SIGTERM（exit 143，无完成证据）。
 * 分片脚本把全量拆 node-core / frontend / node-long 三段有界执行（dev-task-runner，
 * 超时 verdict=unknown 不得写 PASS）。本契约钉住分片计划的确定性：
 *   - node-long 分类只收「真实进程/端到端」形态（live/e2e/soak/perf-probe/startup-perf）；
 *   - 普通单测不得漏进 node-long（防分片语义漂移稀释 node-core）；
 *   - 三个分片键恒在（缺段=汇总不完整）。
 */

test('block359 shards: 计划三段恒在且 node-long 分类确定', () => {
  const plan = buildShardPlan();
  assert.deepEqual(Object.keys(plan).sort(), ['frontend', 'node-core', 'node-long']);
  assert.equal(plan.frontend.kind, 'vitest');
  assert.equal(plan['node-core'].kind, 'node-batch');
  assert.equal(plan['node-long'].kind, 'node-batch');
});

test('block359 shards: node-long 只收真实进程/端到端形态测试', () => {
  const plan = buildShardPlan();
  const long = plan['node-long'].files;
  for (const f of long) {
    assert.match(f, /(live|e2e|soak)([-.])|perf-probe|startup-perf/, `${f} 应属长时/实机域`);
  }
  // 抽样反例：普通契约测试绝不允许因文件名巧合漏进 node-long
  const core = plan['node-core'].files;
  assert.ok(core.includes('block350-perf-gate.test.mjs'), 'perf-gate 契约测试属 node-core（非采集器）');
  assert.ok(core.includes('tool-activity-labels.test.mjs'));
  assert.ok(!core.some((f) => /mcp-bin-e2e|p4r-live/.test(f)), 'e2e/live 文件必须留在 node-long');
});

test('block359 shards: node-core ∪ node-long 等于 test/ 全量且无交集', () => {
  const plan = buildShardPlan();
  const core = new Set(plan['node-core'].files);
  const long = plan['node-long'].files;
  for (const f of long) assert.ok(!core.has(f), `${f} 双归属`);
  const all = fs.readdirSync(new URL('../test/', import.meta.url))
    .filter((f) => f.endsWith('.test.mjs') || f.endsWith('.test.cjs')).length;
  assert.equal(core.size + long.length, all, 'node-core ∪ node-long 应等于 test/ 全量');
});
