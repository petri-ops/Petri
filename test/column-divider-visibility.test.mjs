/**
 * 试用反馈⑤（owner msg_c1bb714f36ce）：左中/中右分隔线样式统一——
 * 两处共用 .resizeHandleV::after，旧规则 color-mix(border 62%) × opacity .72 实机仅 ~7% 不透明度，
 * 过淡看不清。HK-01：接缝必须用可见的 --petri-border-strong 且不得再叠极低透明度。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const css = fs.readFileSync(path.join(ROOT, 'frontend/src/pages/project-workspace.module.css'), 'utf8');

function blockOf(selector) {
  const i = css.indexOf(selector);
  assert.notEqual(i, -1, `CSS 缺少 ${selector}`);
  return css.slice(i, css.indexOf('}', i));
}

test('HK-01-1：接缝 ::after 用可见的 --petri-border-strong（两栏统一真源）', () => {
  const block = blockOf('.resizeHandleV::after');
  assert.match(block, /background:\s*var\(--petri-border-strong\)/);
});

test('HK-01-2：接缝不得再叠极低 opacity（旧 .72 实机仅 ~7% 可见度）', () => {
  const block = blockOf('.resizeHandleV::after');
  assert.doesNotMatch(block, /opacity:\s*0?\.[0-6]/);
});

test('HK-01-3：暗色 token 双套已定义（不写死色值、暗色兼容）', () => {
  const custom = fs.readFileSync(path.join(ROOT, 'frontend/src/styles/custom.css'), 'utf8');
  assert.match(custom, /--petri-border-strong:\s*#d4d4d8/);
  assert.match(custom, /--petri-border-strong:\s*#324466/);
});
