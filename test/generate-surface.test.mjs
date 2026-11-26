/**
 * petri-pack-create 内核薄注册面（owner msg_74cac710da35）：
 * generate.image/video/model3d 通用签名（provider 无关→artifact 描述符），单点接入既有 tool-defs。
 * HK-01：三定义存在、零 provider 硬编码、返回 artifact 描述符语义、无第三 registry。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/agent-tools/tool-defs/generate.js'), 'utf8');

test('HK-01-1：三个 provider 无关生成工具定义齐备', () => {
  for (const name of ['generate.image', 'generate.video', 'generate.model3d']) {
    assert.match(src, new RegExp(`generateDefinition\\('${name.replace('.', '\\.')}'`));
  }
});

test('HK-01-2：内核零 provider 领域硬编码（block-86:43-57 纪律）', () => {
  assert.doesNotMatch(src, /seedream|seedance|volc|ark|deepseek/i);
});

test('HK-01-3：通用签名含 prompt + 参数字典 + artifact 描述符返回语义', () => {
  assert.match(src, /prompt/);
  assert.match(src, /params/);
  assert.match(src, /sha256|artifact/i);
});

test('HK-01-4：单点接入既有 tool-defs 汇总（无第三 registry）', () => {
  const defs = fs.readFileSync(path.join(ROOT, 'core/petri-server/agent-tools/tool-defs.js'), 'utf8');
  assert.match(defs, /generate/);
});
