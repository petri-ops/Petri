/**
 * 试用反馈④后续（owner msg_890b2d097359）：CDP 实证 z=4000 全屏透明瞬态层吞掉 z=1000 右键菜单点击。
 * HK-01：右键菜单层级提升到全局最高浮层档（--petri-z-toast=10000），高于任何瞬态层。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const left = fs.readFileSync(path.join(ROOT, 'frontend/src/components/workspace-panels/LeftPanel.tsx'), 'utf8');

function menuStyle() {
  const at = left.indexOf("role=\"menu\"");
  assert.ok(at > -1, '右键菜单 role=menu 缺失');
  return left.slice(at, left.indexOf('>', at));
}

test('HK-01-1：右键菜单 z-index 用全局最高浮层档 toast（10000），不再用 dropdown(1000)', () => {
  const style = menuStyle();
  assert.match(style, /zIndex:\s*'var\(--petri-z-toast\)'/);
  assert.doesNotMatch(style, /--petri-z-dropdown/);
});

test('HK-01-2：token 阶梯确认 toast(10000) > overlay(4000) 瞬态层', () => {
  const css = fs.readFileSync(path.join(ROOT, 'frontend/src/styles/custom.css'), 'utf8');
  const toast = Number(css.match(/--petri-z-toast:\s*(\d+)/)?.[1]);
  const overlay = Number(css.match(/--petri-z-overlay:\s*(\d+)/)?.[1]);
  assert.ok(toast > overlay, `toast(${toast}) 必须高于 overlay(${overlay})`);
});

test('HK-01-3：关闭层保持 overlay 档（避免菜单比关闭层低导致点击被吞）', () => {
  const style = left.slice(left.indexOf('关闭会话菜单') - 260, left.indexOf('关闭会话菜单'));
  assert.match(style, /--petri-z-overlay/);
});
