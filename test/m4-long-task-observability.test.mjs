/**
 * M4（BLOCK-430）评测与可观测行为契约 · HK-01 红绿先行。
 * 首跑实现未落盘 → ERR_MODULE_NOT_FOUND 必红；实现后 → 全绿。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXTURE_MIN_TURNS,
  generateFixture,
  verifyFixture,
  adjudicateLongTaskBaseline,
  createTraceProjection,
  createUsageLedger,
  adjudicateUserPerceivedPerf,
  planWindowedRender,
} from '../core/petri-server/agent-tools/long-task-observability.js';

test('M4-1 fixture ≥1000 轮合成，零出网零 Provider，manifest 可复算', () => {
  assert.ok(FIXTURE_MIN_TURNS >= 1000);
  const fx = generateFixture({ turns: 1000, seed: 42 });
  assert.equal(fx.manifest.turnCount, 1000);
  assert.equal(fx.manifest.messageCount, 2000);
  assert.ok(fx.manifest.partCount >= 2000);
  assert.equal(fx.manifest.provider, 'mock');
  assert.equal(fx.manifest.network, false);
  assert.equal(verifyFixture(fx).ok, true);
});

test('M4-1 fixture 篡改计数必红（manifest 对账）', () => {
  const fx = generateFixture({ turns: 1000, seed: 7 });
  assert.equal(verifyFixture({ ...fx, manifest: { ...fx.manifest, messageCount: 1 } }).ok, false);
  assert.equal(verifyFixture(fx).ok, true, '同 seed 可复现');
});

test('M4-2 长任务基线：成功率 / 完成度 / 跨恢复一致性', () => {
  const runs = [
    { success: true, completion: 1, resumeConsistent: true },
    { success: true, completion: 0.9, resumeConsistent: true },
    { success: false, completion: 0.4, resumeConsistent: false },
  ];
  const out = adjudicateLongTaskBaseline(runs);
  assert.ok(Math.abs(out.successRate - 2 / 3) < 1e-9);
  assert.ok(Math.abs(out.avgCompletion - 2.3 / 3) < 1e-9);
  assert.equal(out.resumeConsistency, 2 / 3);
  assert.equal(out.claimStableLongTask, false, '无当次真实任务证据不得宣称稳定完成长任务');
});

test('M4-3 traceId 贯穿五类节点并可持久化投影（跨重启可查）', () => {
  const t = createTraceProjection({ traceId: 'tr-1' });
  for (const kind of ['main_loop', 'subagent', 'background', 'retry', 'tool']) {
    t.append({ kind, name: `${kind}-1`, costMs: 3 });
  }
  const snap = t.persist();
  const restored = createTraceProjection({ persisted: snap });
  assert.equal(restored.count, 5);
  assert.ok(restored.byKind('tool').length === 1);
  assert.ok(restored.spans.every((s) => s.traceId === 'tr-1'));
});

test('M4-4 usage 三层事实表 + 价格表落配置 + 失败请求也记账', () => {
  const u = createUsageLedger({ prices: { 'mock-model': { input: 1, output: 2 } } });
  u.record({ layer: 'model', model: 'mock-model', inputTokens: 100, outputTokens: 50 });
  u.record({ layer: 'turn', inputTokens: 0, outputTokens: 0 });
  u.record({ layer: 'tool', name: 'workspace_read', bytes: 20 });
  u.recordFailed({ model: 'mock-model', reason: 'provider_timeout' });
  assert.equal(u.byLayer('model').length, 2, '失败请求也进 model 层');
  assert.equal(u.byLayer('turn').length, 1);
  assert.equal(u.byLayer('tool').length, 1);
  assert.ok(u.totalCostCny > 0, '价格表配置生效，成本可计量');
  assert.ok(u.events.some((e) => e.type === 'model_request_failed'));
});

test('M4-5 用户可感性能门：植入 400+ 节点必红', () => {
  const ok = adjudicateUserPerceivedPerf({ domNodes: 300, scrollP50Ms: 12, scrollP95Ms: 20, firstPaintMs: 800, exportMs: 2000 });
  assert.equal(ok.ok, true);
  const bad = adjudicateUserPerceivedPerf({ domNodes: 401, scrollP50Ms: 12, scrollP95Ms: 20, firstPaintMs: 800, exportMs: 2000 });
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.some((i) => i.code === 'DOM_NODE_BUDGET_EXCEEDED'));
});

test('M4-5 长列表窗口化（零新依赖）：只渲染可见窗口', () => {
  const w = planWindowedRender({ totalItems: 10000, viewportItems: 20, scrollIndex: 500 });
  assert.ok(w.rendered.length <= 24, 'overscan 有界');
  assert.equal(w.rendered[0].index >= 498, true);
  assert.equal(w.totalItems, 10000);
});
