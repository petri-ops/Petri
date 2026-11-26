/**
 * 右侧栏审计（owner msg_26327e7a3def）无争议项：工具菜单四组呈现，入口不丢。
 * HK-01：15 core + 2 host 全在菜单、分组覆盖全部、组内顺序不变、渲染含组标题。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const registry = read('frontend/src/lib/workSurface/registry.ts');
const title = read('frontend/src/pages/project-workspace/useWorkspaceTitleBar.ts');
const render = read('frontend/src/components/desktop/titlebar/TitleBarRightZone.tsx');
const css = read('frontend/src/components/desktop/titlebar/ColumnizedTitleBar.module.css');

test('HK-01-1：四组定义覆盖所有 core 面板 + 2 host 项', () => {
  assert.match(title, /MENU_GROUPS/);
  const ids = [...registry.matchAll(/coreSurface\('(\w+)'/g)].map((m) => m[1]);
  assert.ok(ids.length >= 15, `core 面板应 ≥15（实际 ${ids.length}）`);
  for (const group of ['主工作区', '分析治理', '审计证据', '环境入口']) {
    assert.match(title, new RegExp(group));
  }
});

test('HK-01-2：菜单项带 group 字段且 host 项有组', () => {
  assert.match(title, /\.map\(\(item\) => \(\{ \.\.\.item, group: menuGroupFor\(item\.id\) \}\)/);
  assert.match(title, /'host:terminal', 'host:side-chat'/);
});

test('HK-01-3：渲染层按组插入标题、不丢任何 menuitem', () => {
  assert.match(render, /item\.group/);
  assert.match(render, /toolMenuGroupTitle/);
  assert.match(render, /key=\{item\.id\}/);
});

test('HK-01-4：组标题样式有定义（不裸写）', () => {
  assert.match(css, /\.toolMenuGroupTitle/);
});
