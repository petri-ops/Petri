/**
 * BLOCK-454 P2 — deepseek-search adapter（通用 web_search 窄口的第二个 adapter）。
 *
 * 契约源：docs/block-454-endpoint-contract-findings.md §2 Search 行（VERIFIED）：
 *   POST https://api.deepseek.com/v1/tools/search，Bearer 鉴权；
 *   body {query(1-128 字符必填), count(1-50 默认 10), need_content(默认 false), ...}；
 *   响应 results[] 含 rerank_score/url/snippet/summary/content/site_name/authority。
 *
 * 窄口契约（P3-b 诚实失败 / P3-a 来源标签 / 有界 / 成本可报，沿用 SearXNG 同款）：
 *   1) 未配置 key ≠ 空结果：`web_search_not_configured` 诚实报（绝不空数组冒充）；
 *   2) 结果归一到既有 search 结果形状（title/url/snippet/source），source=主机名；
 *   3) 有界：count 钳位（窄口 1-20）、snippet 钳位 400、响应字节上限 512KB；
 *   4) 成本计量：cost.requests / cost.bytes / cost.results；
 *   5) query 超 deepseek 上限 128 字符 → 诚实 web_query_too_long（带渠道上限说明）；
 *   6) SearXNG 保持默认与既有行为不变（P3-c 本地主权）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { searchWeb, SEARCH_PROVIDERS } = require('../core/petri-server/helpers/web-search-provider.js');

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/tools/search';

/** 捕获请求的假 fetch：记录 (url, init)，按注入的应答器回包。 */
function mockFetch(responder) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return responder(calls.length, { url, init });
  };
  impl.calls = calls;
  return impl;
}

function okResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

const SAMPLE_RESULTS = {
  results: [
    { url: 'https://www.example.com/a', snippet: '示例摘要 A', summary: '示例总结 A', site_name: 'Example', rerank_score: 0.98, authority: 'high' },
    { url: 'https://sub.example.org/b?q=1', snippet: '示例摘要 B', site_name: 'Example Org', rerank_score: 0.81 },
    { url: 'not-a-url', snippet: '坏行应被丢弃' },
    { url: 'https://www.third.net/c', snippet: '示例摘要 C', rerank_score: 0.5 },
  ],
};

test('P2 契约 0 — deepseek 进入 SEARCH_PROVIDERS 窄口清单', () => {
  assert.ok(SEARCH_PROVIDERS.includes('deepseek'), `SEARCH_PROVIDERS=${JSON.stringify(SEARCH_PROVIDERS)}`);
});

test('P2 契约 1 — 未配置 key 诚实报 web_search_not_configured（不空数组冒充）', async () => {
  const fetchImpl = mockFetch(() => { throw new Error('不应发起请求'); });
  const r = await searchWeb({
    query: 'deepseek',
    config: { enabled: true, provider: 'deepseek' },
    fetchImpl,
    getApiKeyFn: () => '',
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'web_search_not_configured');
  assert.ok(r.message.includes('DeepSeek'), `消息应指明渠道: ${r.message}`);
  assert.equal(fetchImpl.calls.length, 0, '未配置时不得发起网络请求');
});

test('P2 契约 2 — 请求形态：POST 官方端点 + Bearer + {query,count,need_content:false}', async () => {
  const fetchImpl = mockFetch(() => okResponse({ results: [] }));
  const r = await searchWeb({
    query: '格物 agent',
    count: 3,
    config: { enabled: true, provider: 'deepseek' },
    fetchImpl,
    getApiKeyFn: () => 'sk-test-key',
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, DEEPSEEK_ENDPOINT);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization, 'Bearer sk-test-key');
  const body = JSON.parse(init.body);
  assert.equal(body.query, '格物 agent');
  assert.equal(body.count, 3);
  assert.equal(body.need_content, false);
  assert.equal(r.provider, 'deepseek');
});

test('P2 契约 3 — 结果归一：source=主机名、snippet 钳位 400、坏行丢弃、deepseek 特有字段保留', async () => {
  const longSnippet = '长'.repeat(500);
  const fetchImpl = mockFetch(() => okResponse({
    results: [
      { url: 'https://www.example.com/a', snippet: longSnippet, site_name: 'Example', rerank_score: 0.98, authority: 'high' },
      { url: 'https://sub.example.org/b?q=1', snippet: '摘要 B', site_name: 'Example Org' },
      { url: 'not-a-url', snippet: '坏行' },
    ],
  }));
  const r = await searchWeb({
    query: 'x',
    config: { enabled: true, provider: 'deepseek' },
    fetchImpl,
    getApiKeyFn: () => 'sk-test-key',
  });
  assert.equal(r.ok, true);
  assert.equal(r.results.length, 2, `坏行丢弃后 2 条: ${JSON.stringify(r.results)}`);
  const first = r.results[0];
  assert.equal(first.source, 'www.example.com', '来源标签=主机名（上层渲染用）');
  assert.equal(first.url, 'https://www.example.com/a');
  assert.ok(first.snippet.length <= 400, `snippet 必须钳位: ${first.snippet.length}`);
  assert.ok(first.snippet.endsWith('…'), '钳位须以省略号收尾');
  assert.equal(first.rerank_score, 0.98, 'rerank_score 保留（可审计排序依据）');
  assert.equal(first.authority, 'high');
  assert.equal(r.results[1].source, 'sub.example.org');
  assert.equal(r.truncated, true, '坏行被丢弃 → truncated 如实标记（与 searxng 归一器同语义：上游行数 > 输出条数）');
});

test('P2 契约 4 — 有界：count 钳位进窄口上限（>20 → 20）、truncated 标记、域名黑名单过滤', async () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    url: `https://host${i}.example.com/r`,
    snippet: `摘要 ${i}`,
    rerank_score: 1 - i * 0.01,
  }));
  const fetchImpl = mockFetch(() => okResponse({ results: rows }));
  const r = await searchWeb({
    query: 'x',
    count: 100,
    config: { enabled: true, provider: 'deepseek', blockedHosts: ['host5.example.com'] },
    fetchImpl,
    getApiKeyFn: () => 'sk-test-key',
  });
  assert.equal(r.ok, true);
  const body = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(body.count, 20, `请求体 count 必须钳位: ${body.count}`);
  assert.equal(r.results.length, 20);
  assert.ok(!r.results.some((row) => row.source === 'host5.example.com'), '黑名单域必须被过滤');
  assert.equal(r.filtered, 1);
  assert.equal(r.truncated, true, '上游 30 行 → 输出 20 条必须标 truncated');
});

test('P2 契约 5 — 成本计量：cost.requests=1、cost.bytes>0、cost.results=条数', async () => {
  const fetchImpl = mockFetch(() => okResponse(SAMPLE_RESULTS));
  const r = await searchWeb({
    query: 'x',
    config: { enabled: true, provider: 'deepseek' },
    fetchImpl,
    getApiKeyFn: () => 'sk-test-key',
  });
  assert.equal(r.ok, true);
  assert.equal(r.cost.requests, 1);
  assert.ok(r.cost.bytes > 0, `bytes 必须计量: ${JSON.stringify(r.cost)}`);
  assert.equal(r.cost.results, r.results.length);
  assert.equal(r.backend, 'api.deepseek.com', 'backend=检索后端主机（区别于结果来源）');
});

test('P2 契约 6 — query 超 deepseek 渠道上限 128 字符 → 诚实 web_query_too_long', async () => {
  const fetchImpl = mockFetch(() => { throw new Error('不应发起请求'); });
  const r = await searchWeb({
    query: '长'.repeat(129),
    config: { enabled: true, provider: 'deepseek' },
    fetchImpl,
    getApiKeyFn: () => 'sk-test-key',
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'web_query_too_long');
  assert.ok(r.message.includes('128'), `消息须指明渠道上限: ${r.message}`);
  assert.equal(fetchImpl.calls.length, 0);
});

test('P2 契约 7 — HTTP 401 → web_search_http_error 且不可重试（key 无效属配置面）', async () => {
  const fetchImpl = mockFetch(() => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ error: { message: 'invalid key' } }),
  }));
  const r = await searchWeb({
    query: 'x',
    config: { enabled: true, provider: 'deepseek' },
    fetchImpl,
    getApiKeyFn: () => 'sk-bad',
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'web_search_http_error');
  assert.equal(r.status, 401);
  assert.equal(r.retryable, false, '401 重试无意义（诚实不假装瞬时故障）');
});

test('P2 契约 8 — 0 结果仍 ok=true，note 诚实说明（不冒充「没有这个主题」）', async () => {
  const fetchImpl = mockFetch(() => okResponse({ results: [] }));
  const r = await searchWeb({
    query: 'x',
    config: { enabled: true, provider: 'deepseek' },
    fetchImpl,
    getApiKeyFn: () => 'sk-test-key',
  });
  assert.equal(r.ok, true);
  assert.equal(r.results.length, 0);
  assert.ok(r.note && r.note.length > 10, `0 结果必须有诚实 note: ${r.note}`);
});

test('P2 契约 9 — SearXNG 默认不变：provider=searxng 走既有 GET 形态（P3-c 本地主权）', async () => {
  const fetchImpl = mockFetch(() => okResponse({ results: [{ url: 'https://a.example.com/1', content: 'x' }] }));
  const r = await searchWeb({
    query: 'x',
    config: { enabled: true, provider: 'searxng', searxngBaseUrl: 'http://127.0.0.1:8080' },
    fetchImpl,
    getApiKeyFn: () => { throw new Error('searxng 不需要 key'); },
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(fetchImpl.calls[0].init.method, 'GET');
  assert.ok(fetchImpl.calls[0].url.startsWith('http://127.0.0.1:8080/search?'), 'searxng 仍走自建实例');
  assert.equal(r.provider, 'searxng');
});
