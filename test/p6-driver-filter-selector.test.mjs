/**
 * P6 table_scroll 筛选控件 selector 对齐（2026-11-23）— HK-01 契约（纯源码，不跑 Electron）。
 *
 * 卡点：改 pack 声明后 table_load 已过（原生 viewer），但 table_scroll 的
 * measureFilterFeedback 报 filter_controls_missing。根因：driver selector 用
 * select[aria-label="筛选字段"] / input[aria-label="筛选内容"]，产品实际是
 * `筛选字段 1` / `筛选条件 1`（带序号，限定 role=group aria-label=表格筛选）。
 *
 * 本票仅改 harness selector，不改产品筛选 UI/逻辑。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRIVER = path.join(ROOT, 'scripts', 'g0-rs-p6-electron-pressure-driver.cjs');
const VIEWER = path.join(ROOT, 'frontend', 'src', 'components', 'result-studio', 'ScientificInteractionViewer.tsx');
const src = () => fs.readFileSync(DRIVER, 'utf8');

test('filter selector 用产品真实 aria-label（筛选字段 1 / 筛选条件 1 带序号）', () => {
  const s = src();
  const def = s.search(/async function measureFilterFeedback\s*\(/);
  assert.ok(def >= 0, '须存在 measureFilterFeedback');
  const body = s.slice(def, def + 1100);
  assert.match(body, /aria-label\^="筛选字段"/, 'field select 须用前缀匹配 筛选字段 N');
  assert.match(body, /aria-label\^="筛选条件"/, 'value input 须用前缀匹配 筛选条件 N');
  assert.doesNotMatch(body, /aria-label="筛选内容"/, '不得用产品不存在的 筛选内容');
});

test('filter selector 限定表格筛选 group 容器（避免误捕其他控件）', () => {
  const s = src();
  const def = s.search(/async function measureFilterFeedback\s*\(/);
  const body = s.slice(def, def + 1100);
  assert.match(body, /aria-label="表格筛选"/, '须限定 role=group[aria-label=表格筛选] 容器');
});

test('产品筛选 UI 契约未改（红线：不改产品筛选 DOM/逻辑）', () => {
  const viewer = fs.readFileSync(VIEWER, 'utf8');
  assert.match(viewer, /aria-label=\{`筛选字段 \$\{index \+ 1\}`\}/, '产品 field select aria-label 未改');
  assert.match(viewer, /aria-label=\{`筛选条件 \$\{index \+ 1\}`\}/, '产品 value input aria-label 未改');
  assert.match(viewer, /role="group" aria-label="表格筛选"/, '产品筛选 group 未改');
  assert.match(viewer, /添加筛选条件/, '产品添加筛选按钮未改');
});
