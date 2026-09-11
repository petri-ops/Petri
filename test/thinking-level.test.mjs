/**
 * thinking-level.test.mjs — BLOCK-81 P1 定向测试：思考档位 → 上游参数映射内核。
 *
 * 覆盖：档位归一化 / 标准档不发参（零行为变化）/ 能力门控（未声明 reasoning 不发）/
 * 三协议映射形状 / 未知协议诚实不发 / 去参重试的「未知参数」判据正反例。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  THINKING_LEVELS,
  normalizeThinkingLevel,
  thinkingParamsFor,
  isUnknownParameterError,
} = require('../core/shared-backend/llm-providers/thinking-level.js');

test('档位词表与归一化：只认三档，其余一律 null', () => {
  assert.deepEqual([...THINKING_LEVELS], ['off', 'standard', 'high']);
  assert.equal(normalizeThinkingLevel('off'), 'off');
  assert.equal(normalizeThinkingLevel(' HIGH '), 'high');
  assert.equal(normalizeThinkingLevel('standard'), 'standard');
  assert.equal(normalizeThinkingLevel('ultra'), null);
  assert.equal(normalizeThinkingLevel(''), null);
  assert.equal(normalizeThinkingLevel(undefined), null);
  assert.equal(normalizeThinkingLevel(3), null);
});

test('标准档（默认）不发任何参数——保证零行为变化', () => {
  const caps = ['chat', 'reasoning'];
  for (const protocol of ['openai-compatible', 'anthropic-messages', 'dashscope-native']) {
    assert.deepEqual(thinkingParamsFor({ level: 'standard', protocol, capabilities: caps }), {});
  }
  // 未指定档位同样不发
  assert.deepEqual(thinkingParamsFor({ protocol: 'openai-compatible', capabilities: caps }), {});
  assert.deepEqual(thinkingParamsFor(), {});
});

test('能力门控：未声明 reasoning 的渠道一律不发参', () => {
  const noReasoning = ['chat', 'streaming', 'tools'];
  for (const level of ['off', 'high']) {
    for (const protocol of ['openai-compatible', 'anthropic-messages', 'dashscope-native']) {
      assert.deepEqual(
        thinkingParamsFor({ level, protocol, capabilities: noReasoning }),
        {},
        `${protocol}/${level} 未声明 reasoning 应不发参`
      );
    }
  }
  // capabilities 缺失/非法形状同样不发
  assert.deepEqual(thinkingParamsFor({ level: 'high', protocol: 'openai-compatible' }), {});
  assert.deepEqual(thinkingParamsFor({ level: 'high', protocol: 'openai-compatible', capabilities: 'reasoning' }), {});
});

test('openai-compatible：high→reasoning_effort=high；off→minimal（协议无真关闭档）', () => {
  const caps = ['chat', 'reasoning'];
  assert.deepEqual(
    thinkingParamsFor({ level: 'high', protocol: 'openai-compatible', capabilities: caps }),
    { reasoning_effort: 'high' }
  );
  assert.deepEqual(
    thinkingParamsFor({ level: 'off', protocol: 'openai-compatible', capabilities: caps }),
    { reasoning_effort: 'minimal' }
  );
});

test('anthropic-messages：high→enabled+budget_tokens；off→disabled', () => {
  const caps = ['chat', 'reasoning'];
  assert.deepEqual(
    thinkingParamsFor({ level: 'high', protocol: 'anthropic-messages', capabilities: caps }),
    { thinking: { type: 'enabled', budget_tokens: 16000 } }
  );
  assert.deepEqual(
    thinkingParamsFor({ level: 'off', protocol: 'anthropic-messages', capabilities: caps }),
    { thinking: { type: 'disabled' } }
  );
});

test('dashscope-native：high→enable_thinking=true；off→false', () => {
  const caps = ['chat', 'reasoning'];
  assert.deepEqual(
    thinkingParamsFor({ level: 'high', protocol: 'dashscope-native', capabilities: caps }),
    { enable_thinking: true }
  );
  assert.deepEqual(
    thinkingParamsFor({ level: 'off', protocol: 'dashscope-native', capabilities: caps }),
    { enable_thinking: false }
  );
});

test('未知协议诚实不发参（宁可不支持也不猜参数名）', () => {
  const caps = ['chat', 'reasoning'];
  assert.deepEqual(thinkingParamsFor({ level: 'high', protocol: 'gemini-native', capabilities: caps }), {});
  assert.deepEqual(thinkingParamsFor({ level: 'high', protocol: undefined, capabilities: caps }), {});
});

test('去参重试判据：未知/非法参数文案命中，业务错误不误判', () => {
  // 正例：OpenAI / Anthropic / DashScope / 中文网关文案
  assert.equal(isUnknownParameterError('Unknown parameter: reasoning_effort'), true);
  assert.equal(isUnknownParameterError({ message: 'unrecognized field "thinking"' }), true);
  assert.equal(isUnknownParameterError({ error: { message: 'Unsupported parameter: enable_thinking' } }), true);
  assert.equal(isUnknownParameterError({ response: { data: { error: { message: 'invalid parameter: reasoning_effort' } } } }), true);
  assert.equal(isUnknownParameterError('请检查：未知参数 reasoning_effort'), true);

  // 反例：鉴权/额度/模型不存在/上下文超限等 —— 不得触发去参重试
  assert.equal(isUnknownParameterError('Invalid API-key provided.'), false);
  assert.equal(isUnknownParameterError('insufficient_quota'), false);
  assert.equal(isUnknownParameterError({ message: 'model deepseek-x not found' }), false);
  assert.equal(isUnknownParameterError('context_length_exceeded'), false);
  assert.equal(isUnknownParameterError(undefined), false);
  assert.equal(isUnknownParameterError(''), false);
  // 「invalid_request_error」类并不等同于参数名未知（避免误剥参数重试）
  assert.equal(isUnknownParameterError({ error: { type: 'invalid_request_error', message: 'messages: at least one message is required' } }), false);
});
