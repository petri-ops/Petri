/**
 * BLOCK-163 W3 P8（MDL-3）— anthropic vision 原生轨协议转换契约。
 *
 * 钉住：openAIContentToAnthropic 对 image_url parts 的两路转换——
 * ①data URL → base64 source（BLOCK-155 内联链直通 anthropic 渠道）；
 * ②http(s) URL → source:{type:'url'}（Anthropic API 原生支持 URL source，
 *   此前被静默丢弃）；③非图片/坏 URL 不产出 image 块；④混合 text+image 顺序保持。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const conversion = require(path.join(ROOT, 'core/shared-backend/llm-providers/protocol-conversion.js'));

test('BLOCK-163 MDL-3 data URL → base64 image source（BLOCK-155 内联链直通）', () => {
  const body = {
    model: 'claude-3-5-sonnet-20241022',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '这张图里是什么？' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
      ],
    }],
  };
  const out = conversion.openAIToAnthropicRequest(body);
  assert.equal(out.messages.length, 1);
  const blocks = out.messages[0].content;
  assert.ok(Array.isArray(blocks), '多 part content 应转 blocks');
  assert.equal(blocks[0].type, 'text');
  assert.deepEqual(blocks[1], {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
  });
});

test('BLOCK-163 MDL-3 http(s) URL → source:{type:"url"}（原生 URL source，不再静默丢弃）', () => {
  const body = {
    model: 'claude-3-5-sonnet-20241022',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'https://example.com/fig.png' } },
      ],
    }],
  };
  const out = conversion.openAIToAnthropicRequest(body);
  const blocks = out.messages[0].content;
  assert.deepEqual(blocks, [{
    type: 'image',
    source: { type: 'url', url: 'https://example.com/fig.png' },
  }]);
});

test('BLOCK-163 MDL-3 非 http(s)/data 的坏 URL 不产出 image 块（fail-soft）', () => {
  const body = {
    model: 'claude-3-5-sonnet-20241022',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'file:///etc/passwd' } },
        { type: 'text', text: '保留文本' },
      ],
    }],
  };
  const out = conversion.openAIToAnthropicRequest(body);
  const blocks = out.messages[0].content;
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'text');
});

test('BLOCK-163 MDL-3 纯文本消息保持字符串内容（零扰动回归）', () => {
  const out = conversion.openAIToAnthropicRequest({
    messages: [{ role: 'user', content: '纯文本' }],
  });
  assert.equal(out.messages[0].content, '纯文本');
});
