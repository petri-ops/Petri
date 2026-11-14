/**
 * UI-D4 (BLOCK-419) — 无障碍门负测（5 类植入必红 + 亮度公式边界）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkFiles, verifyA11y, relativeLuminance, contrastRatio,
  computeContrastPairs, scanFocusGaps, stripCssComments,
  TOKEN_PALETTE, STATE_MATRIX, FOCUS_GAP_BASELINE, WCAG_AA_BODY, WCAG_AA_LARGE,
} from '../scripts/ui-design-a11y.mjs';

const customSource = () => [
  '--petri-text: #18181b;', '--petri-text-secondary: #3f3f46;',
  '--petri-text-tertiary: #71717a;', '--petri-text-muted: #6a6a73;',
  '--petri-text: #e6edf3;', '--petri-text-secondary: #b1bac4;',
  '--petri-text-tertiary: #8b98ad;', '--petri-text-muted: #8b98ad;',
].join('\n');
const stateMachine = () => ({ ariaBusy: 3, roleAlert: 94, roleStatus: 56, ariaLive: 19 });
const base = () => ({ customSource: customSource(), stateMachine: stateMachine(), focusGaps: new Map() });

test('real tree passes a11y gate (gate:ui-a11y)', () => {
  assert.deepEqual(checkFiles().problems, []);
});

test('WCAG 相对亮度与对比度公式边界', () => {
  assert.equal(relativeLuminance('#000000'), 0);
  assert.ok(Math.abs(relativeLuminance('#ffffff') - 1) < 1e-9);
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 1e-9);
  assert.ok(Math.abs(contrastRatio('#ffffff', '#ffffff') - 1) < 1e-9);
  assert.equal(relativeLuminance('not-a-color'), null);
  assert.equal(contrastRatio('#fff', '#fff'), null);
  assert.equal(WCAG_AA_BODY, 4.5);
  assert.equal(WCAG_AA_LARGE, 3.0);
});

test('对比度计算覆盖亮暗两套全部 32 对且数值有限', () => {
  const pairs = computeContrastPairs();
  assert.equal(pairs.length, 32);
  for (const p of pairs) assert.ok(Number.isFinite(p.ratio) && p.ratio >= 1 && p.ratio <= 21);
  // 已知正例：亮色主文字对白底 ≥ 4.5
  assert.ok(contrastRatio('#18181b', '#ffffff') >= 4.5);
});

test('植入八态空格必红', () => {
  const matrix = STATE_MATRIX.filter((r) => r.key !== 'input:loading');
  assert.ok(verifyA11y({ ...base(), stateMatrix: matrix }).some((x) => x.includes('八态矩阵应 32 格')));
  const blank = STATE_MATRIX.map((r) => r.key === 'button:error' ? { ...r, criterion: '' } : r);
  assert.ok(verifyA11y({ ...base(), stateMatrix: blank }).some((x) => x.includes('八态空格')));
});

test('植入 focus 缺口（新增文件/新增声明）必红', () => {
  const many = new Map(Array.from({ length: FOCUS_GAP_BASELINE.files + 1 }, (_, i) => [`a${i}.css`, 1]));
  assert.ok(verifyA11y({ ...base(), focusGaps: many }).some((x) => x.includes('focus 缺口文件')));
  const over = new Map([['a.css', FOCUS_GAP_BASELINE.declarations + 1]]);
  assert.ok(verifyA11y({ ...base(), focusGaps: over }).some((x) => x.includes('focus 缺口声明')));
});

test('token 对账表篡改 / 阈值放宽 / 状态机证据缺失必红', () => {
  const bad = structuredClone(TOKEN_PALETTE);
  bad.light.text.text = '#000000';
  assert.ok(verifyA11y({ ...base(), palette: bad }).some((x) => x.includes('token 对账表漂移')));
  assert.ok(verifyA11y({ ...base(), bodyThreshold: 3.0 }).some((x) => x.includes('阈值被放宽')));
  assert.ok(verifyA11y({ ...base(), stateMachine: { ...stateMachine(), ariaBusy: 0 } }).some((x) => x.includes('状态机证据缺失')));
});

test('focus 缺口扫描：注释里的 outline:none 不计、WIP 文件只读登记', () => {
  const fixtures = new Map([
    ['a.css', '/* .x { outline: none } */\n.y { outline: none; }'],
    ['b.css', '.z:focus-visible { outline: 2px solid red; }\n.w { outline: none; }'],
    ['frontend/src/pages/project-workspace.module.css', '.q { outline: none; }'],
  ]);
  const gaps = scanFocusGaps(fixtures);
  assert.equal(gaps.get('a.css'), 1);
  assert.equal(gaps.has('b.css'), false);
  assert.equal(gaps.has('frontend/src/pages/project-workspace.module.css'), false);
  assert.equal((stripCssComments('/* ;; */').match(/;;/g) || []).length, 0);
});
