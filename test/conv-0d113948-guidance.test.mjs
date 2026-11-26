/**
 * conv_0d113948-4a2 错误分析机械修复项：read_image 超时（100.9s 瞬态失败）后
 * 模型先缩图重试 6 次才成功——错误文本当时只说「timeout 请求超时」，无瞬态/重试指引。
 * HK-01：vision_failed 且错误为 timeout 时，必须给「瞬态可重试 + 缩小图片/拆局部」指引；
 * 错误码 vision_failed 契约不变。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const vision = fs.readFileSync(path.join(ROOT, 'core/petri-server/agent-tools/vision-tools.js'), 'utf8');

test('HK-01-1：vision 超时错误给瞬态可重试 + 缩小图片/拆局部指引', () => {
  const block = vision.slice(vision.indexOf("error: 'vision_failed'"), vision.indexOf("error: 'vision_failed'") + 600);
  assert.ok(block.length > 0, 'vision_failed 分支必须存在');
  assert.match(block, /timeout/);
  assert.match(block, /瞬态/);
  assert.match(block, /可重试/);
  assert.match(block, /缩小|拆局部/);
});

test('HK-01-2：vision_failed 错误码契约不变', () => {
  assert.match(vision, /error:\s*'vision_failed'/);
});
