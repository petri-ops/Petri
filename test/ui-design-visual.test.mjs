/**
 * UI-D3 (BLOCK-418) — 视觉语义门负测（6 类植入必红）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkFiles, verifyVisual, extractTokenDefinitions, countFallbacks, stripCssComments,
  WIP_CSS, CUSTOM_CSS, FALLBACK_SNAPSHOT, SELECTED_TOKENS, Z_TIER_FROZEN,
} from '../scripts/ui-design-visual.mjs';

const custom = (overrides = {}) => {
  const defs = [
    { name: '--petri-hover', value: '#f4f4f5', theme: 'light' },
    { name: '--petri-hover', value: 'rgba(1,2,3,0.07)', theme: 'dark' },
    { name: '--petri-surface-hover', value: 'var(--petri-hover)', theme: 'light' },
    { name: '--petri-surface-hover', value: 'var(--petri-hover)', theme: 'dark' },
    { name: '--petri-bg-hover', value: 'var(--petri-hover)', theme: 'light' },
    { name: '--petri-bg-hover', value: 'var(--petri-hover)', theme: 'dark' },
    { name: '--petri-bg-button-hover', value: 'var(--petri-hover)', theme: 'light' },
    { name: '--petri-bg-button-hover', value: 'var(--petri-hover)', theme: 'dark' },
    { name: '--petri-accent-hover', value: 'color-mix(in srgb, var(--petri-accent) 85%, #000)', theme: 'light' },
    { name: '--petri-accent-hover', value: 'color-mix(in srgb, var(--petri-accent) 85%, #000)', theme: 'dark' },
    { name: '--petri-surface-dim', value: '#f4f4f5', theme: 'light' },
    { name: '--petri-surface-dim', value: '#111a2e', theme: 'dark' },
    ...SELECTED_TOKENS.flatMap((n) => [{ name: n, value: 'var(--petri-accent)', theme: 'light' }, { name: n, value: 'var(--petri-accent)', theme: 'dark' }]),
  ];
  return new Map([[CUSTOM_CSS, defs], ...Object.entries(overrides).map(([k, v]) => [k, v])]);
};
const base = () => ({
  definitions: custom(),
  fallbacks: new Map(),
  doubleSemis: new Map(),
  bareZTiers: [],
  selectedConsumers: ['frontend/src/pages/window/command-center.module.css'],
  snapshot: {},
});

test('real tree passes visual semantics gate (gate:ui-visual)', () => {
  assert.deepEqual(checkFiles().problems, []);
});

test('extract / count 口径：注释不参与计数', () => {
  assert.equal(countFallbacks('/* var(--petri-x, #fff) */\n.a { color: var(--petri-y, #000); }'), 1);
  assert.equal((stripCssComments('/* ;;;; */\n.a{}').match(/;;/g) || []).length, 0);
  assert.deepEqual(extractTokenDefinitions('.a { --petri-hover: red; }').map((d) => d.name), ['--petri-hover']);
});

test('hover 别名自带字面量 / 真源缺明暗必红', () => {
  const defs = custom();
  const arr = defs.get(CUSTOM_CSS);
  arr.find((d) => d.name === '--petri-surface-hover' && d.theme === 'dark').value = 'rgba(1,2,3,0.09)';
  assert.ok(verifyVisual({ ...base(), definitions: defs }).some((x) => x.includes('自带颜色字面量')));
  const missing = custom();
  missing.set(CUSTOM_CSS, missing.get(CUSTOM_CSS).filter((d) => !(d.name === '--petri-hover' && d.theme === 'dark')));
  assert.ok(verifyVisual({ ...base(), definitions: missing }).some((x) => x.includes('hover 真源')));
});

test('selected 未成对 / 无真实消费必红', () => {
  const defs = custom();
  defs.set(CUSTOM_CSS, defs.get(CUSTOM_CSS).filter((d) => !(d.name === '--petri-selected-bg' && d.theme === 'dark')));
  assert.ok(verifyVisual({ ...base(), definitions: defs }).some((x) => x.includes('未明暗成对')));
  assert.ok(verifyVisual({ ...base(), selectedConsumers: [] }).some((x) => x.includes('无真实消费点')));
});

test('跨文件重复定义必红（surface-dim / selected）', () => {
  const defs = custom({ 'frontend/src/styles/global.css': [{ name: '--petri-surface-dim', value: '#f4f4f5', theme: 'light' }] });
  assert.ok(verifyVisual({ ...base(), definitions: defs }).some((x) => x.includes('跨文件重复定义 --petri-surface-dim')));
});

test('非 WIP ;; 残留 / 未登记裸 z（冻结清单外新增）/ fallback 超快照必红', () => {
  assert.ok(verifyVisual({ ...base(), doubleSemis: new Map([['a.css', 2]]) }).some((x) => x.includes('残留 2 处 ;;')));
  assert.ok(verifyVisual({ ...base(), bareZTiers: [{ file: 'a.css', value: 1000 }] }).some((x) => x.includes('裸 z-index 1000')));
  assert.ok(verifyVisual({ ...base(), snapshot: { 'a.css': 0 }, fallbacks: new Map([['frontend/src/a.css', 3]]) }).some((x) => x.includes('现值 3 > 冻结 0')));
});

test('WIP 文件显式登记 owner 与 fallback 快照（零触碰）', () => {
  assert.ok(WIP_CSS in {} === false);
  assert.ok(Object.keys(FALLBACK_SNAPSHOT).some((k) => WIP_CSS.endsWith(k)));
});

test('accent-hover 外溢到组件 CSS 必红（独立语义真源）', () => {
  const defs = custom({ 'frontend/src/components/a.module.css': [{ name: '--petri-accent-hover', value: '#fff', theme: 'light' }] });
  assert.ok(verifyVisual({ ...base(), definitions: defs }).some((x) => x.includes('外溢到')));
  assert.ok(verifyVisual({ ...base(), hoverAliases: ['--petri-surface-hover', '--petri-accent-hover'] }).some((x) => x.includes('误列为表面 hover 别名')));
});

test('裸 z 冻结清单只减：清单外新增 / 清单内超限必红', () => {
  assert.ok(Z_TIER_FROZEN.length >= 2);
  const outside = [{ file: 'frontend/src/components/a.module.css', value: 10 }];
  assert.ok(verifyVisual({ ...base(), bareZTiers: outside }).some((x) => x.includes('未在冻结清单登记')));
  const over = Array.from({ length: 3 }, () => ({ file: Z_TIER_FROZEN[0].file, value: Z_TIER_FROZEN[0].value }));
  assert.ok(verifyVisual({ ...base(), bareZTiers: over }).some((x) => x.includes('只减棘轮')));
});
