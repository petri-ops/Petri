/**
 * 补正 msg_eb9795b7323d：hiddenInset 融合下空白区 drag / tab+按钮 no-drag。
 * HK-01：可点元素（iconBtn/tabPill/tabClose/leftTools）在 no-drag 列表。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const css = fs.readFileSync(path.join(ROOT, 'frontend/src/components/desktop/TitleBar.module.css'), 'utf8');

function noDragSelectors() {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{\s*-webkit-app-region:\s*no-drag;/g)) {
    for (const sel of m[1].split(',')) out.push(sel.trim().replace(/^\./, ''));
  }
  return out;
}

test('HK-01-1：标题栏可点元素都在 no-drag（融合后按钮/ tab 可点）', () => {
  const selectors = noDragSelectors();
  for (const name of ['iconBtn', 'tabPill', 'tabPillMain', 'tabClose', 'leftTools']) {
    assert.ok(selectors.includes(name), `.${name} 缺 no-drag（hiddenInset 下会被 drag 吞点击）`);
  }
});

test('HK-01-2：header 空白区仍是 drag（可拖窗）', () => {
  const col = fs.readFileSync(path.join(ROOT, 'frontend/src/components/desktop/titlebar/ColumnizedTitleBar.module.css'), 'utf8');
  assert.match(col, /-webkit-app-region:\s*drag/);
});
