/**
 * UI-737 修复包追加（owner msg_aaad9b13c360）：空输出自动重试一次 + 如实标注。
 * HK-01：①提取不误用 reasoning 当正文；②retryOnce 仅在空输出时重试一次；③重试成功/仍空都如实标注。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractOptimizedText,
  retryOnEmptyOutput,
} from '../core/petri-server/helpers/prompt-enhance-retry.js';

test('HK-01-1：正文提取不把 reasoning 当答案（思考≠答案）', () => {
  assert.equal(extractOptimizedText({ choices: [{ message: { content: '优化后的提示词' } }] }), '优化后的提示词');
  assert.equal(extractOptimizedText({ choices: [{ message: { content: '', reasoning_content: '我需要思考一下…' } }] }), '');
  assert.equal(extractOptimizedText({ content: '' }), '');
});

test('HK-01-2：非空结果不重试（一次调用、无 retry 标注）', async () => {
  let calls = 0;
  const r = await retryOnEmptyOutput(async () => { calls += 1; return { choices: [{ message: { content: '正文' } }] }; });
  assert.equal(calls, 1);
  assert.deepEqual(r, { result: { choices: [{ message: { content: '正文' } }] }, retried: false, empty: false });
});

test('HK-01-3：空输出自动重试一次；重试拿到正文→成功且 retried=true', async () => {
  let calls = 0;
  const r = await retryOnEmptyOutput(async () => {
    calls += 1;
    return calls === 1
      ? { choices: [{ message: { content: '', reasoning_content: '思考中' } }] }
      : { content: '重试后的正文' };
  });
  assert.equal(calls, 2);
  assert.equal(extractOptimizedText(r.result), '重试后的正文');
  assert.equal(r.retried, true);
  assert.equal(r.empty, false);
});

test('HK-01-4：两次都空→如实标注 empty=true（不冒充成功）', async () => {
  let calls = 0;
  const r = await retryOnEmptyOutput(async () => { calls += 1; return { content: '' }; });
  assert.equal(calls, 2);
  assert.equal(r.retried, true);
  assert.equal(r.empty, true);
});
