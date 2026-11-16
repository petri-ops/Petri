/**
 * BLOCK-454 P5 — DeepSeek Responses 协议 adapter（POST /responses）。
 *
 * 契约源（findings UNVERIFIED 项补抓，2026-11-17 官方 create-response 页 VERIFIED）：
 *   请求：model / input(string|item[]：message(function_call/_output|reasoning|web_search_call)…
 *         content 块 input_text|input_image(image_url|file_id 互斥)|input_file(file_id,user only)|reasoning_text) /
 *         instructions / reasoning{effort:none|low|high|max}（minimal→low，medium/xhigh→high）/
 *         max_output_tokens（**不是** max_tokens）/ temperature/top_p / text.format /
 *         tools[](function 展平 {type,name,description,parameters}|custom|web_search(v4-pro)|deepseek_web_search|deepseek_read_url) /
 *         tool_choice / safety_check{level} / title{enabled}。
 *   响应：id / object:"response" / status(in_progress|completed|incomplete|failed) / error{code,message} /
 *         incomplete_details.reason(max_output_tokens|content_filter) /
 *         output[](message(content=[output_text])|reasoning(reasoning_text)|function_call|web_search_call(kind/action.sources…)) /
 *         title / usage(input_tokens…, output_tokens…, safety_tokens, total_tokens, server_tool_use)。
 *   流式：event + sequence_number，**无 [DONE]**；response.created→…→output_text.delta→…→completed/incomplete/failed。
 *
 * 投影契约：thinking→reasoning_content、tool_use→tool_calls、citations(web_search_call sources)→deepseekResponses、
 *           refusal(content_filter)→finish_reason——四类内容**投影不丢**；safety_check 仅透传，不替换本地治理。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const providers = require('../core/shared-backend/llm-providers/index.js');
const {
  openAIToResponsesRequest,
  responsesToOpenAIResponse,
} = require('../core/shared-backend/llm-providers/responses.js');
const { thinkingParamsFor } = require('../core/shared-backend/llm-providers/thinking-level.js');

const REASONING_CAPS = ['chat', 'streaming', 'tools', 'reasoning'];

// ---------- 0) 注册与协议映射 ----------

test('P5-0 — provider 注册：deepseek-responses 在册；inferProtocol→responses；thinking 映射', () => {
  assert.ok(providers.getProvider('deepseek-responses'), 'deepseek-responses 必须已注册');
  const { inferProtocol } = require('../core/shared-backend/llm-providers/model-profile.js');
  assert.equal(inferProtocol('deepseek-responses'), 'responses');
  // 中性档位 → Responses 请求参数（单一映射点，off/standard/high）
  assert.deepEqual(
    thinkingParamsFor({ level: 'off', protocol: 'responses', capabilities: REASONING_CAPS }),
    { reasoning: { effort: 'none' } },
    'off → reasoning.effort=none（显式关闭）',
  );
  assert.deepEqual(thinkingParamsFor({ level: 'standard', protocol: 'responses', capabilities: REASONING_CAPS }), {});
  assert.deepEqual(
    thinkingParamsFor({ level: 'high', protocol: 'responses', capabilities: REASONING_CAPS }),
    { reasoning: { effort: 'max' } },
    'high → 最强调参数（Responses 上限=max）',
  );
  // 既有三协议映射不被本改动触碰（BLOCK-200 冻结面）
  assert.deepEqual(
    thinkingParamsFor({ level: 'high', protocol: 'openai-compatible', capabilities: REASONING_CAPS }),
    { reasoning_effort: 'high' },
  );
});

// ---------- 1) 请求转换 ----------

test('P5-1 — 请求形态：messages→input items（input_text）+ max_tokens→max_output_tokens', () => {
  const req = openAIToResponsesRequest({
    model: 'deepseek-flash',
    messages: [
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '你好' },
      { role: 'user', content: [{ type: 'text', text: '看图' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
    ],
    max_tokens: 2048,
    temperature: 0.7,
  });
  assert.equal(req.model, 'deepseek-flash');
  assert.equal(req.max_output_tokens, 2048, 'Responses 参数名是 max_output_tokens（逐字契约）');
  assert.equal(req.max_tokens, undefined, '不得透传 Chat 形参数名');
  assert.equal(req.temperature, 0.7);
  assert.equal(req.input.length, 3);
  assert.deepEqual(req.input[0].content, [{ type: 'input_text', text: '你是助手' }]);
  assert.deepEqual(req.input[1].content, [{ type: 'input_text', text: '你好' }]);
  assert.deepEqual(req.input[2].content, [
    { type: 'input_text', text: '看图' },
    { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
  ]);
});

test('P5-2 — 工具历史：assistant tool_calls→function_call items、tool 角色→function_call_output', () => {
  const req = openAIToResponsesRequest({
    model: 'deepseek-flash',
    messages: [
      { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"q":"x"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: '搜索结果' },
    ],
  });
  assert.deepEqual(req.input[0], { type: 'function_call', call_id: 'call_1', name: 'web_search', arguments: '{"q":"x"}' });
  assert.deepEqual(req.input[1], { type: 'function_call_output', call_id: 'call_1', output: '搜索结果' });
});

test('P5-3 — tools 展平（OpenAI 嵌套 function→Responses 扁平）+ 内联工具/safety_check/title 透传不替换本地治理', () => {
  const req = openAIToResponsesRequest({
    model: 'deepseek-flash',
    messages: [{ role: 'user', content: 'x' }],
    tools: [
      { type: 'function', function: { name: 'my_fn', description: 'd', parameters: { type: 'object' } } },
      { type: 'deepseek_web_search' },
      { type: 'deepseek_read_url' },
    ],
    safety_check: { level: 'high' },
    title: { enabled: true },
  });
  assert.deepEqual(req.tools[0], { type: 'function', name: 'my_fn', description: 'd', parameters: { type: 'object' } }, 'function 必须展平');
  assert.deepEqual(req.tools[1], { type: 'deepseek_web_search' }, '内联工具原样透传');
  assert.deepEqual(req.tools[2], { type: 'deepseek_read_url' });
  assert.deepEqual(req.safety_check, { level: 'high' }, 'safety_check 透传（仅参数级，不替换本地审批/治理链）');
  assert.deepEqual(req.title, { enabled: true }, 'title 透传');
});

// ---------- 2) 响应归一（投影不丢） ----------

const SAMPLE_RESPONSE = {
  id: 'resp_1',
  object: 'response',
  created_at: 1,
  status: 'completed',
  model: 'deepseek-flash',
  output: [
    { type: 'reasoning', content: [{ type: 'reasoning_text', text: '先想想' }] },
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: '答案是 42', annotations: [] }],
    },
    {
      type: 'web_search_call',
      kind: 'search',
      action: { sources: [{ title: '来源一', snippet: 's', site_name: 'example.com', site_icon: '', published_at: '' }] },
    },
    { type: 'function_call', call_id: 'call_9', name: 'get_weather', arguments: '{"city":"北京"}' },
  ],
  title: { enabled: true, title: '会话标题' },
  usage: {
    input_tokens: 10,
    input_tokens_details: { cached_tokens: 4 },
    output_tokens: 5,
    output_tokens_details: { reasoning_tokens: 3 },
    total_tokens: 15,
    server_tool_use: { tool_search: 1, tool_fetch: 0, tool_image_search: 0 },
  },
};

test('P5-4 — 响应归一：thinking/tool_use/citations 三投影不丢 + usage 映射 + details 保留', () => {
  const out = responsesToOpenAIResponse(SAMPLE_RESPONSE, 'deepseek-flash');
  assert.equal(out.error, undefined, JSON.stringify(out));
  assert.equal(out.object, 'chat.completion');
  assert.equal(out.choices.length, 1);
  const msg = out.choices[0].message;
  assert.equal(msg.content, '答案是 42');
  assert.equal(msg.reasoning_content, '先想想', 'thinking → reasoning_content（投影不丢）');
  assert.equal(out.choices[0].finish_reason, 'tool_calls', 'function_call 在场 → finish_reason=tool_calls');
  assert.deepEqual(msg.tool_calls, [{ id: 'call_9', type: 'function', function: { name: 'get_weather', arguments: '{"city":"北京"}' } }]);
  // citations：web_search_call sources 投影（P3-a 来源可审计；item.action.sources 逐字保留）
  assert.equal(out.deepseekResponses.webSearchCalls.length, 1);
  assert.deepEqual(out.deepseekResponses.webSearchCalls[0].action.sources, SAMPLE_RESPONSE.output[2].action.sources);
  assert.equal(out.deepseekResponses.webSearchCalls[0].kind, 'search');
  assert.equal(out.deepseekResponses.title, SAMPLE_RESPONSE.title, 'title 投影保留');
  assert.deepEqual(out.usage, {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
    input_tokens_details: { cached_tokens: 4 },
    output_tokens_details: { reasoning_tokens: 3 },
    server_tool_use: { tool_search: 1, tool_fetch: 0, tool_image_search: 0 },
  }, 'usage 映射到 OpenAI 形且 details/server_tool_use 保留（计费可审计）');
});

test('P5-5 — refusal 投影：incomplete+content_filter → finish_reason=content_filter（不丢）', () => {
  const out = responsesToOpenAIResponse({
    id: 'resp_2', object: 'response', status: 'incomplete',
    incomplete_details: { reason: 'content_filter' },
    output: [{ type: 'message', role: 'assistant', content: [] }],
    usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
  }, 'deepseek-flash');
  assert.equal(out.choices[0].finish_reason, 'content_filter', 'refusal 投影不丢');
  const outLen = responsesToOpenAIResponse({
    id: 'resp_3', object: 'response', status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '截断' }] }],
    usage: { input_tokens: 1, output_tokens: 9, total_tokens: 10 },
  }, 'deepseek-flash');
  assert.equal(outLen.choices[0].finish_reason, 'length');
});

test('P5-6 — status=failed → 诚实 error 信封（code/message 上抛）', () => {
  const out = responsesToOpenAIResponse({
    id: 'resp_4', object: 'response', status: 'failed',
    error: { code: 'server_error', message: 'boom' },
    output: [], usage: {},
  }, 'deepseek-flash');
  assert.equal(out.error, 'api_error');
  assert.equal(out.message, 'boom');
});

// ---------- 3) adapter 端到端（mock fetch） ----------

test('P5-7 — adapter chat：POST {baseUrl}/responses + Bearer + 归一信封；HTTP 401 诚实映射', async () => {
  const provider = providers.getProvider('deepseek-responses');
  const sent = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => SAMPLE_RESPONSE,
      text: async () => JSON.stringify(SAMPLE_RESPONSE),
      headers: new Map(),
    };
  };
  try {
    const out = await provider.chat('sk-x', {
      model: 'deepseek-flash',
      messages: [{ role: 'user', content: '你好' }],
    }, {}, { baseUrl: 'https://api.deepseek.com' });
    assert.equal(out.error, undefined, JSON.stringify(out));
    assert.equal(sent[0].url, 'https://api.deepseek.com/responses');
    assert.equal(sent[0].init.headers.authorization, 'Bearer sk-x');
    const body = JSON.parse(sent[0].init.body);
    assert.equal(body.model, 'deepseek-flash');
    assert.deepEqual(body.input[0].content, [{ type: 'input_text', text: '你好' }]);
    assert.equal(out.choices[0].message.content, '答案是 42');
    // 401 → 诚实错误
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }), text: async () => '{}' });
    const err = await provider.chat('sk-bad', { model: 'deepseek-flash', messages: [{ role: 'user', content: 'x' }] }, {}, { baseUrl: 'https://api.deepseek.com' });
    assert.equal(err.error, 'http_error');
    assert.equal(err.status, 401);
    assert.equal(err.retryable, false, '401 不可重试（配置面）');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('P5-8 — 流式：SSE 事件（无 [DONE]）→ content_delta 聚合 + completed usage；未知事件不猜不炸', async () => {
  const provider = providers.getProvider('deepseek-responses');
  const sse = [
    'event: response.created',
    'data: {"id":"r1","object":"response","status":"in_progress","output":[]}',
    '',
    'event: response.output_text.delta',
    'data: {"delta":"你"}',
    '',
    'event: response.output_text.delta',
    'data: {"delta":"好"}',
    '',
    'event: response.output_item.added',
    'data: {"item":{"type":"message"}}',
    '',
    'event: response.completed',
    `data: ${JSON.stringify(SAMPLE_RESPONSE)}`,
    '',
  ].join('\n');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (!globalThis.fetch._done) {
            globalThis.fetch._done = true;
            return { done: false, value: new TextEncoder().encode(sse) };
          }
          return { done: true, value: undefined };
        },
      }),
    },
    headers: new Map(),
  });
  const events = [];
  try {
    const agg = await provider.chatStream('sk-x', {
      model: 'deepseek-flash',
      messages: [{ role: 'user', content: '你好' }],
    }, {}, (e) => events.push(e), { baseUrl: 'https://api.deepseek.com' });
    const deltas = events.filter((e) => e.type === 'content_delta');
    assert.equal(deltas.length, 2, `两个 delta: ${JSON.stringify(events.map((e) => e.type))}`);
    assert.deepEqual(deltas.map((d) => d.content), ['你', '好']);
    assert.equal(events.some((e) => e.type === 'done' && e.usage), true, 'completed → done + usage');
    assert.equal(agg.choices[0].message.content, '答案是 42', '聚合信封来自 completed 载荷');
    assert.equal(agg.choices[0].message.reasoning_content, '先想想', '聚合不丢 thinking');
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.fetch._done;
  }
});
