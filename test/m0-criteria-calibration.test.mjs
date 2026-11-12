/**
 * HK-01 红绿先行 · M0 判据校准契约（BLOCK-426）
 *
 * 本文件先于 scripts/m-blueprint-m0-criteria.mjs 写入：首跑必红（模块缺席/实现缺失），
 * 随后最小实现转绿。红→绿两轮输出摘要随 M0 收口笔录留痕。
 *
 * 覆盖：M0-4 front-matter 状态对账门（植入「阶段包 completed 而蓝图 planned」必红）、
 *       M0-5 gap-ledger 只读视图（计数可复算 / owner 保留 / 零 in_progress / 90↔93 矛盾暴露）、
 *       M0-3 读数对账（门数篡改必红）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adjudicateBlueprintStatus,
  summarizeGapLedgers,
  reconcileReadings,
  L7_DECLARED_TOTAL,
} from '../scripts/m-blueprint-m0-criteria.mjs';

const mkDoc = (id, status, kind = 'work-package', tags = []) => ({ id, status, kind, tags });

test('M0-4 植入：阶段包全 completed 而 living-plan 仍 planned → 必红', () => {
  const docs = [
    mkDoc('BLOCK-404', 'completed', 'work-package', ['post-k7']),
    mkDoc('BLOCK-405', 'completed', 'work-package', ['post-k7']),
    mkDoc('POST-K7-BLUEPRINT', 'planned', 'living-plan', ['post-k7']),
  ];
  const out = adjudicateBlueprintStatus(docs, { programs: { 'post-k7': 'POST-K7-BLUEPRINT' } });
  assert.equal(out.ok, false, '植入的 stale planned 蓝图必须判红');
  assert.ok(out.issues.some((i) => i.code === 'BLUEPRINT_STATUS_STALE'));
});

test('M0-4 一致态：阶段包全 completed 且蓝图 completed → 绿', () => {
  const docs = [
    mkDoc('BLOCK-404', 'completed', 'work-package', ['post-k7']),
    mkDoc('POST-K7-BLUEPRINT', 'completed', 'living-plan', ['post-k7']),
  ];
  const out = adjudicateBlueprintStatus(docs, { programs: { 'post-k7': 'POST-K7-BLUEPRINT' } });
  assert.equal(out.ok, true, JSON.stringify(out.issues));
});

test('M0-4 阶段进行中：蓝图 planned 且阶段包含 active → 不误报', () => {
  const docs = [
    mkDoc('BLOCK-426', 'active', 'work-package', ['m-blueprint']),
    mkDoc('M-BLUEPRINT', 'planned', 'living-plan', ['m-blueprint']),
  ];
  const out = adjudicateBlueprintStatus(docs, { programs: { 'm-blueprint': 'M-BLUEPRINT' } });
  assert.equal(out.ok, true, '进行中程序的 planned/active 组合不得误报');
});

test('M0-5 四套 ledger 汇总：逐件计数可复算且 owner/终态保留', () => {
  const view = summarizeGapLedgers({
    l7: {
      _about: '第五轮 90 条发现逐件终态台账',
      statuses: { done: 64, 'done-partial': 19, pending_user_ruling: 2, 'retain-with-reason': 5, pending_human_eye: 1, 'external-blocked': 2 },
      items: Array.from({ length: 93 }, (_, i) => ({ id: `L-${i}`, status: 'done', owner: 'BLOCK-404', evidence: 'acceptance/' })),
    },
    h7: { gaps: [{ id: 'B-01', status: 'done', owner: 'BLOCK-385' }], summary: { total: 1 } },
    k7: { gaps: [{ id: 'K-01', terminal: 'done', owner: 'BLOCK-396' }], terminalCounts: { done: 1 } },
    d5: { findings: [{ id: 'IA-P1-a', terminal: 'done', package: 'BLOCK-416' }], summary: { total: 1 } },
  });
  assert.equal(view.ok, true, JSON.stringify(view.issues));
  assert.equal(view.sources.l7.computedTotal, 93);
  assert.equal(view.sources.l7.declaredTotal, L7_DECLARED_TOTAL);
  assert.equal(view.sources.l7.countDiscrepancy, 93 - L7_DECLARED_TOTAL, '90↔93 矛盾必须暴露而非静默');
  assert.equal(view.totalItems, 96);
  assert.ok(view.items.every((it) => it.owner && it.terminal && it.source));
  assert.equal(view.inProgress, 0);
});

test('M0-5 植入 in_progress → 必红（零 in_progress 契约）', () => {
  const view = summarizeGapLedgers({
    l7: { _about: '90', statuses: { done: 1 }, items: [{ id: 'L-1', status: 'in_progress', owner: 'X' }] },
    h7: { gaps: [], summary: { total: 0 } },
    k7: { gaps: [], terminalCounts: {} },
    d5: { findings: [], summary: { total: 0 } },
  });
  assert.equal(view.ok, false, 'in_progress 必须判红');
  assert.ok(view.issues.some((i) => i.code === 'LEDGER_IN_PROGRESS'));
});

test('M0-5 植入缺 owner → 必红（逐件保留 owner）', () => {
  const view = summarizeGapLedgers({
    l7: { _about: '90', statuses: { done: 1 }, items: [{ id: 'L-1', status: 'done' }] },
    h7: { gaps: [], summary: { total: 0 } },
    k7: { gaps: [], terminalCounts: {} },
    d5: { findings: [], summary: { total: 0 } },
  });
  assert.equal(view.ok, false);
  assert.ok(view.issues.some((i) => i.code === 'LEDGER_OWNER_MISSING'));
});

test('M0-3 读数对账：当次现取一致 → 绿；篡改门数 → 必红', () => {
  const readings = {
    closeout: { blockingGates: 16, reportOnlyGates: 1 },
    registry: { total: 569, activeWorkPackages: 1 },
    impactMap: { rules: 42 },
  };
  const measured = { closeoutBlockingGates: 16, registryTotal: 569, impactMapRules: 42 };
  assert.equal(reconcileReadings(readings, measured).ok, true);
  const bad = reconcileReadings(readings, { ...measured, closeoutBlockingGates: 19 });
  assert.equal(bad.ok, false, '手抄门数与现读取数不一致必须判红');
  assert.ok(bad.issues.some((i) => i.code === 'READING_DRIFT'));
});
