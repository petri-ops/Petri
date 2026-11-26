/**
 * owner 双裁决（msg_b2c65cbb4890）：背景分区 B + 身份标识 A 的 HK-01 静态契约。
 * B：左右栏 tint color-mix 派生、中栏纯 --petri-bg-surface、零新 token；
 * A：agent avatar 用 petri 品牌缩略（Icon name）、用户侧 user 不动、Icon 有 petri mark。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const css = read('frontend/src/pages/project-workspace.module.css');
const row = read('frontend/src/components/copilot/SimpleChat/SimpleChatMessageRow.tsx');
const icon = read('frontend/src/components/icons/Icon.tsx');

function rule(selector) {
  const at = css.indexOf(selector);
  assert.notEqual(at, -1, `缺规则 ${selector}`);
  return css.slice(at, css.indexOf('}', at));
}

test('HK-01-B1：左/右栏用既有 token 的 color-mix tint（不新增 token、非硬编码色）', () => {
  const left = rule('.leftCol {');
  const right = rule('.rightCol {');
  assert.match(left, /background:\s*color-mix\(/);
  assert.match(right, /background:\s*color-mix\(/);
  for (const block of [left, right]) {
    assert.match(block, /var\(--petri-bg-surface\)/);
    assert.doesNotMatch(block, /#[0-9a-fA-F]{3,6}/);
  }
});

test('HK-01-B2：中栏纯主底完全不动（消息气泡/卡片可读性零风险）', () => {
  const center = rule('.centerCol {');
  assert.match(center, /background:\s*var\(--petri-bg-surface\)/);
  assert.doesNotMatch(center, /color-mix|gradient/);
});

test('HK-01-A1：agent avatar 用 petri 品牌缩略、用户侧 user 不变', () => {
  assert.match(row, /m\.role === 'user' \? \(\s*<Icon name="user"/);
  assert.match(row, /<Icon name="petri"/);
  assert.doesNotMatch(row, /<Icon name="cpu"/);
});

test('HK-01-A2：Icon 组件含 petri mark（自有内联 SVG、currentColor 随暗色主题）', () => {
  assert.match(icon, /\| 'petri'/);
  assert.match(icon, /petri:\s*\(/);
  assert.match(icon, /stroke="currentColor"/);
});
