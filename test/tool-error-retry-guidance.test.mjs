/**
 * conv_25806ab0-fa4 错误分析（owner msg_2cce0f69e256）机械修复项：
 * 该会话中 web_access_disabled 连续 5 次——模型反复重试同一"配置类不可重试"错误。
 * HK-01：web_* 禁用错误必须明确告知模型「不要重试」（配置类错误，重试无意义）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const web = fs.readFileSync(path.join(ROOT, 'core/petri-server/agent-tools/web-tools.js'), 'utf8');

test('HK-01-1：web_access_disabled 错误提示含「不要重试/重复调用」指令', () => {
  const hits = [...web.matchAll(/message:\s*'([^']*联网能力未开启[^']*)'/g)].map((m) => m[1]);
  assert.ok(hits.length >= 1, 'web_* 禁用错误提示必须存在');
  for (const msg of hits) {
    assert.match(msg, /不要重试|不要重复调用/);
  }
});

test('HK-01-2：错误码仍是 web_access_disabled（不变契约）', () => {
  assert.match(web, /code:\s*'web_access_disabled'/);
});
