import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  openAIToAnthropicRequest,
  anthropicToOpenAIRequest,
  openAIToAnthropicResponse,
  anthropicToOpenAIResponse,
} = require('../core/shared-backend/llm-providers/protocol-conversion.js');
const {
  OpenAIStreamAggregator,
  AnthropicStreamAggregator,
} = require('../core/shared-backend/llm-providers/stream-aggregate.js');
const { normalizeUsage } = require('../core/shared-backend/llm-providers/protocol-usage.js');
const { CircuitBreaker, shouldRetry } = require('../core/shared-backend/llm-providers/provider-reliability.js');

test('OpenAI request converts system, tools, tool calls, and tool results to Anthropic', () => {
  const converted = openAIToAnthropicRequest({
    model: 'model-a',
    messages: [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'question' },
      {
        role: 'assistant',
        content: 'checking',
        tool_calls: [{ id: 'call-1', function: { name: 'lookup', arguments: '{"id":1}' } }],
      },
      { role: 'tool', tool_call_id: 'call-1', content: 'result' },
    ],
    tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
    tool_choice: 'auto',
  });
  assert.equal(converted.system, 'system');
  assert.equal(converted.messages[1].content[0].type, 'text');
  assert.equal(converted.messages[1].content[1].type, 'tool_use');
  assert.deepEqual(converted.messages[1].content[1].input, { id: 1 });
  assert.equal(converted.messages[2].content[0].type, 'tool_result');
  assert.equal(converted.tools[0].name, 'lookup');
  assert.deepEqual(converted.tool_choice, { type: 'auto' });
});

test('Anthropic request converts vision, tool use, and tool result to OpenAI', () => {
  const converted = anthropicToOpenAIRequest({
    model: 'model-b',
    system: [{ type: 'text', text: 'system' }],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'see' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'read', input: { path: 'x' } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'done' }],
      },
    ],
  });
  assert.equal(converted.messages[0].role, 'system');
  assert.equal(converted.messages[1].content[1].type, 'image_url');
  assert.equal(converted.messages[2].tool_calls[0].function.name, 'read');
  assert.equal(converted.messages[3].role, 'tool');
});

test('non-streaming responses preserve text, tool calls, finish reason, and usage', () => {
  const anthropic = openAIToAnthropicResponse({
    id: 'one',
    choices: [{
      message: {
        content: 'working',
        tool_calls: [{ id: 'call-1', function: { name: 'run', arguments: '{"x":2}' } }],
      },
      finish_reason: 'tool_calls',
    }],
    usage: { prompt_tokens: 10, completion_tokens: 4 },
  }, 'requested');
  assert.equal(anthropic.stop_reason, 'tool_use');
  assert.equal(anthropic.content[1].name, 'run');

  const openai = anthropicToOpenAIResponse(anthropic, 'requested');
  assert.equal(openai.choices[0].finish_reason, 'tool_calls');
  assert.equal(openai.choices[0].message.tool_calls[0].function.arguments, '{"x":2}');
  assert.equal(openai.usage.total_tokens, 14);
});

test('OpenAI SSE aggregator reassembles split content, tool calls, and usage', () => {
  const aggregator = new OpenAIStreamAggregator('model');
  const stream =
    `data: ${JSON.stringify({ id: 'x', choices: [{ delta: { content: 'hel' } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'lo', tool_calls: [{ index: 0, id: 'c', function: { name: 'run', arguments: '{"x":' } }] } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] }, finish_reason: 'tool_calls' }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } })}\n\n` +
    'data: [DONE]\n\n';
  aggregator.feed(stream.slice(0, 90));
  aggregator.feed(stream.slice(90));
  const result = aggregator.getResult();
  assert.equal(result.choices[0].message.content, 'hello');
  assert.equal(result.choices[0].message.tool_calls[0].function.arguments, '{"x":1}');
  assert.equal(result.usage.total_tokens, 5);
});

test('Anthropic SSE aggregator reassembles text, tool JSON, and usage', () => {
  const aggregator = new AnthropicStreamAggregator();
  const frames = [
    ['message_start', { type: 'message_start', message: { id: 'm', model: 'claude', usage: { input_tokens: 5 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't', name: 'run', input: {} } }],
    ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"x":1}' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 1 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } }],
  ].map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  aggregator.feed(frames.slice(0, 120));
  aggregator.feed(frames.slice(120));
  const result = aggregator.getResult();
  assert.equal(result.content[0].text, 'hello');
  assert.deepEqual(result.content[1].input, { x: 1 });
  assert.equal(result.stop_reason, 'tool_use');
  assert.equal(result.usage.output_tokens, 3);
});

test('usage normalization covers cache fields', () => {
  assert.deepEqual(
    normalizeUsage({ prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } }),
    { input: 10, output: 2, cacheRead: 4, cacheCreation: 0 }
  );
});

test('retry classification and circuit breaker remain policy primitives, not automatic failover', () => {
  assert.equal(shouldRetry(429), true);
  assert.equal(shouldRetry(503), true);
  assert.equal(shouldRetry(400), false);
  let now = 1000;
  const breaker = new CircuitBreaker({ failThreshold: 2, cooldownMs: 50, now: () => now });
  breaker.recordFailure('profile');
  assert.equal(breaker.isOpen('profile'), false);
  breaker.recordFailure('profile');
  assert.equal(breaker.isOpen('profile'), true);
  now = 1051;
  assert.equal(breaker.isOpen('profile'), false);
});
