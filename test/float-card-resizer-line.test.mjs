/**
 * 试用反馈⑥（owner msg_baec84bd5c5a）：摘要浮卡左缘灰色竖线清理——
 * 保拖拽（10px 命中区 + col-resize），常态不可见，hover 极淡反馈供发现性。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const css = fs.readFileSync(
  path.join(ROOT, 'frontend/src/components/workspace-panels/FloatCardResizer.module.css'), 'utf8',
);

function blockOf(selector) {
  const i = css.indexOf(selector);
  assert.notEqual(i, -1, `CSS 缺少 ${selector}`);
  return css.slice(i, css.indexOf('}', i));
}

test('HK-01-1：拖拽命中区保留（10px + col-resize + touch-action）', () => {
  const handle = blockOf('.handle {');
  assert.match(handle, /width:\s*10px/);
  assert.match(handle, /cursor:\s*col-resize/);
  assert.match(handle, /touch-action:\s*none/);
});

test('HK-01-2：常驻灰线移除——::after 常态 transparent（旧 text-tertiary 22% 灰线删除）', () => {
  const after = blockOf('.handle::after');
  assert.match(after, /background:\s*transparent/);
  assert.doesNotMatch(after, /text-tertiary\s+22%/);
});

test('HK-01-3：hover 给极淡可见反馈供发现性（暗色 token 兼容、不写死色）', () => {
  assert.match(css, /\.handle:hover::after/);
  const hover = css.slice(css.indexOf('.handle:hover::after'), css.indexOf('.handle:hover::after') + 200);
  assert.match(hover, /var\(--petri-/);
});
