/**
 * M7（BLOCK-433）总收口逐件终态门 · HK-01 防假绿负测。
 * 从蓝图机械解析 70+12 ID；植入篡改验证门必红；不改生产文件、不放宽基线。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLedger, adjudicateLedger, parseBlueprintIds } from '../scripts/m-blueprint-m7-final.mjs';

test('M7 蓝图 ID 机械解析：70 发现 + 12 差距，无缺号', () => {
  const ids = parseBlueprintIds();
  assert.equal(ids.findings.length, 70);
  assert.equal(ids.gaps.length, 12);
  assert.equal(new Set(ids.findings).size, 70);
  assert.equal(new Set(ids.gaps).size, 12);
});

test('M7 门基线：逐件终态全绿、零 in_progress、计数可复算', () => {
  const ledger = buildLedger();
  const verdict = adjudicateLedger(ledger);
  assert.equal(verdict.ok, true, JSON.stringify(verdict.issues));
  assert.equal(ledger.totals.items, 82);
  assert.equal(Object.values(ledger.counts).reduce((a, b) => a + b, 0), 82);
  assert.equal(ledger.items.some((x) => x.terminal === 'in_progress'), false);
  assert.ok(ledger.items.every((x) => x.evidence && x.note));
});

test('植入 in_progress → 必红（零 in_progress 契约）', () => {
  const l = buildLedger();
  const first = Object.getOwnPropertyDescriptor(l.items, 0).value;
  Object.defineProperty(l.items, 0, { value: { ...first, terminal: 'in_progress' }, writable: true, enumerable: true, configurable: true });
  const partial = Object.getOwnPropertyDescriptor(l.counts, 'done-partial').value;
  Object.defineProperty(l.counts, 'done-partial', { value: partial - 1, writable: true, enumerable: true, configurable: true });
  const out = adjudicateLedger(l);
  assert.equal(out.ok, false);
  assert.ok(out.issues.some((i) => i.includes('IN_PROGRESS') || i.includes('INVALID_TERMINAL')));
});

test('植入「少一条发现」→ FINDINGS_COUNT_NOT_70 必红', () => {
  const l = buildLedger();
  l.totals = { ...l.totals, findings: 69 };
  assert.ok(adjudicateLedger(l).issues.some((i) => i.includes('FINDINGS_COUNT_NOT_70')));
});

test('植入「U/E/V/W 项写成 verified」→ EXTERNAL_ANSWERED_BY_AGENT 必红', () => {
  const l = buildLedger();
  const idx = l.items.findIndex((x) => x.terminal === 'pending_human_eye');
  const item = Object.getOwnPropertyDescriptor(l.items, idx).value;
  Object.defineProperty(l.items, idx, {
    value: { ...item, note: 'verified 全绿，Agent 已代答' },
    writable: true, enumerable: true, configurable: true,
  });
  assert.ok(adjudicateLedger(l).issues.some((i) => i.includes('EXTERNAL_ANSWERED_BY_AGENT')));
});

test('植入「十一维少一维 / 升平降不合计」→ 必红', () => {
  const l = buildLedger();
  const a = { ...l, dimensions: l.dimensions.slice(0, 10) };
  assert.ok(adjudicateLedger(a).issues.some((i) => i.includes('DIMENSION_COUNT_NOT_11')));
  const b = { ...l, dimensionSummary: { ...l.dimensionSummary, rises: 99 } };
  assert.ok(adjudicateLedger(b).issues.some((i) => i.includes('DIMENSION_DELTA_SUM_DRIFT')));
});

test('十一维第八列不回溯改第七列，且非 verified 声明', () => {
  const l = buildLedger();
  assert.equal(l.dimensions.length, 11);
  assert.ok(l.dimensions.every((d) => d.col7 !== undefined && d.col8 !== undefined && d.anchor));
  assert.ok(l.dimensions.every((d) => !/verified/.test(d.delta)));
  assert.equal(l.dimensionSummary.rises + l.dimensionSummary.flats + l.dimensionSummary.drops, 11);
});
