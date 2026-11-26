/**
 * 试用反馈⑪（owner msg_e5dee7523be8）：设置页返回/搜索边框柔化 + 左右分区可拖拽调宽。
 * HK-01 静态契约：边框用更淡 token、sidebar 宽度 state 化、resize handle 存在且有 min/max 约束。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const back = read('frontend/src/pages/global-page.module.css');
const search = read('frontend/src/components/desktop/DesktopSettingsPanel/sections/SettingsQuickwins.module.css');
const panel = read('frontend/src/components/desktop/DesktopSettingsPanel.tsx');
const redesign = read('frontend/src/components/desktop/settings-redesign.module.css');

function rule(css, selector) {
  const at = css.indexOf(selector);
  assert.notEqual(at, -1, `缺规则 ${selector}`);
  return css.slice(at, css.indexOf('}', at));
}

test('HK-01-1：返回按钮边框柔化（去硬边框或改更淡 token）', () => {
  const r = rule(back, '.backBtn {');
  assert.doesNotMatch(r, /border:\s*1px solid var\(--petri-border-card\)/);
  assert.match(r, /border:\s*0|border-color:\s*var\(--petri-border-subtle\)/);
});

test('HK-01-2：搜索框边框柔化（subtle 或仅 focus 显示）', () => {
  const r = rule(search, '.searchInput {');
  assert.doesNotMatch(r, /border:\s*1px solid var\(--petri-border-card\)/);
  assert.match(r, /border:\s*0|border:\s*1px solid var\(--petri-border-subtle\)/);
});

test('HK-01-3：设置 sidebar 宽度 state 化 + resize handle 挂载（含 min/max 约束）', () => {
  assert.match(panel, /sidebarWidth|settingsSidebarWidth/);
  assert.match(panel, /settings-resize-handle|settingsResizeHandle/);
  assert.match(panel, /Math\.max\(\s*200|Math\.min\(\s*480/);
});

test('HK-01-4：sidebar CSS 宽度不再写死（用内联 style/CSS 变量覆盖）', () => {
  const sidebar = rule(redesign, ":global(.petri-settings-sidebar) {");
  assert.doesNotMatch(sidebar, /flex:\s*0 0 264px/);
});
