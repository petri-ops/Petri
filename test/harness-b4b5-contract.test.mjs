// HK-01 static contract — harness 隐形体验优化队列 2 / B4 focus + B5 dead CSS.
// 纯 Node 静态断言（零依赖）：frontend 的 vitest/vite 本机未安装，静态 CSS 契约走 node --test。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'src');
const read = (rel) => fs.readFileSync(path.join(srcRoot, rel), 'utf8');

const welcomeCss = read('pages/welcome.module.css');
const welcomeTsx = read('pages/welcome.tsx');
const boundaryCss = read('components/RouteErrorBoundary.module.css');
const customCss = read('styles/custom.css');
const tokenTest = read('styles/theme-token-contract.test.ts');

const FOCUS_RULE = 'outline: 2px solid var(--petri-accent)';
const INTERACTIVE = [
  'chip',
  'pickerTrigger',
  'projectSearch',
  'projectRow',
  'panelAction',
  'actionInput',
  'actionBack',
  'actionPrimary',
  'dirSuggestion',
];

describe('B4 keyboard focus-visible (HK-01 static contract)', () => {
  it('welcome 首屏实际使用的交互类全部有 :focus-visible', () => {
    const used = new Set([...welcomeTsx.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
    for (const cls of INTERACTIVE) {
      assert.equal(used.has(cls), true, `welcome.tsx must use styles.${cls}`);
      assert.match(welcomeCss, new RegExp(`\\.${cls}:focus-visible`), `.${cls}:focus-visible missing`);
    }
  });

  it('welcome 两处 outline:none 输入框用 :focus-visible 还原焦点环', () => {
    for (const cls of ['projectSearch', 'actionInput']) {
      assert.match(welcomeCss, new RegExp(`\\.${cls}\\s*\\{[^}]*outline:\\s*none`), `.${cls} outline:none missing`);
      assert.match(welcomeCss, new RegExp(`\\.${cls}:focus-visible`), `.${cls}:focus-visible missing`);
    }
  });

  it('RouteErrorBoundary 两个按钮有作用域内 :focus-visible', () => {
    assert.match(boundaryCss, /\.actions\s+button:focus-visible/);
    assert.ok(boundaryCss.includes(FOCUS_RULE), 'focus ring must use --petri-accent token');
  });

  it('焦点环走主题 token、无动效（reduced-motion 兜底不被破坏）', () => {
    const bodies = [
      ...welcomeCss.matchAll(/\.[\w-]+:focus-visible\s*\{([^}]*)\}/g),
      ...boundaryCss.matchAll(/:focus-visible\s*\{([^}]*)\}/g),
    ].map((m) => m[1]);
    assert.ok(bodies.length > 0, 'at least one focus-visible rule body');
    for (const body of bodies) {
      assert.ok(body.includes(FOCUS_RULE), 'token 化 outline');
      assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, '禁裸色');
      assert.doesNotMatch(body, /transition|animation/, '禁动效');
    }
  });
});

describe('B5 dead CSS cleanup (HK-01 static contract)', () => {
  it('custom.css 零 .run-modal / .navbar 死选择器', () => {
    assert.doesNotMatch(customCss, /\.run-modal\b/);
    for (const sel of [
      '.navbar__items--right',
      '.navbar__search-input',
      '.navbar__brand',
      '.navbar__title',
      '.navbar-separator',
      '.navbar__inner',
    ]) {
      assert.equal(customCss.includes(sel), false, `${sel} still present`);
    }
  });

  it('已删 CSS 文件零复生；WorkbenchEmpty.module.css 因 token 契约引用保留', () => {
    for (const rel of ['components/auth/LoginModal.css', 'components/ui/PageHeader.css']) {
      assert.equal(fs.existsSync(path.join(srcRoot, rel)), false, `${rel} should stay deleted`);
    }
    assert.equal(fs.existsSync(path.join(srcRoot, 'components/ui/WorkbenchEmpty.module.css')), true);
    assert.ok(tokenTest.includes('components/ui/WorkbenchEmpty.module.css'));
  });
});
