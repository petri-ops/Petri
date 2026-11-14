/**
 * UI-D2 (BLOCK-417) — 断点单一真源门负测。
 * 5 类植入必红：未登记 CSS 阈值 / JS 裸阈值 / 767 残留 / TS 常量漂移 / 对齐值缺失。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  checkFiles, verifyBreakpoints, extractCssThresholds, extractJsBareThresholds,
  REGISTERED_THRESHOLDS, MOBILE_ALIGNED_PX, COMPACT_ALIGNED_PX, BREAKPOINTS_TS,
} from '../scripts/ui-design-breakpoints.mjs';

const root = new URL('../', import.meta.url);
const tsSource = () => fs.readFileSync(new URL(BREAKPOINTS_TS, root), 'utf8');
const base = () => ({ byFile: new Map(), jsBare: [], tsSource: tsSource() });

test('real tree passes breakpoint reconciliation (gate:ui-breakpoints)', () => {
  assert.deepEqual(checkFiles().problems, []);
});

test('extractCssThresholds / extractJsBareThresholds 口径', () => {
  assert.deepEqual(extractCssThresholds('@media (max-width: 768px) {}\n@container (min-width: 520px) {}'), [520, 768]);
  assert.deepEqual(extractJsBareThresholds("matchMedia('(max-width: 767px)')"), [767]);
  assert.deepEqual(extractJsBareThresholds('matchMedia(MOBILE_MAX_WIDTH_QUERY)'), []);
});

test('植入未登记 CSS 阈值必红', () => {
  const p = verifyBreakpoints({ ...base(), byFile: new Map([['frontend/src/a.css', [9999]]]) });
  assert.ok(p.some((x) => x.includes('未登记 CSS 阈值 9999px')));
});

test('植入 JS 裸阈值必红（必须引用单一真源）', () => {
  const p = verifyBreakpoints({ ...base(), jsBare: [{ file: 'frontend/src/hooks/x.ts', px: 767 }] });
  assert.ok(p.some((x) => x.includes('JS 裸阈值 767px')));
});

test('767 残留 / 常量漂移 / 对齐值缺失必红', () => {
  assert.ok(verifyBreakpoints({ ...base(), registered: [...REGISTERED_THRESHOLDS, 767] }).some((x) => x.includes('767px 残留')));
  assert.ok(verifyBreakpoints({ ...base(), tsSource: 'MOBILE_BREAKPOINT_PX = 767;\nCOMPACT_BREAKPOINT_PX = 960;' }).some((x) => x.includes('MOBILE_BREAKPOINT_PX')));
  assert.ok(verifyBreakpoints({ ...base(), registered: REGISTERED_THRESHOLDS.filter((v) => v !== MOBILE_ALIGNED_PX) }).some((x) => x.includes('对齐阈值 768')));
  assert.ok(verifyBreakpoints({ ...base(), compactAligned: 1234 }).some((x) => x.includes('对齐阈值 1234')));
});

test('WIP 文件阈值只读登记，不替 owner 设约束', () => {
  const p = verifyBreakpoints({ ...base(), byFile: new Map([['frontend/src/pages/project-workspace.module.css', [700, 860, 960]]]) });
  assert.deepEqual(p, []);
  assert.equal(MOBILE_ALIGNED_PX, 768);
  assert.equal(COMPACT_ALIGNED_PX, 960);
});
