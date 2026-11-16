'use strict';

/**
 * helpers/web-search-provider.js — 检索后端抽象（BLOCK-247 / Q2b）。
 *
 * 现在有两个 adapter：**SearXNG**（自建元搜索实例：不绑厂商、可内网部署、来源可审计
 * ——本地主权形态在联网检索上的落点，保持默认）与 **deepseek-search**（BLOCK-454 P2，
 * DeepSeek 独立 Search API，云端可选渠道、key 走凭据族）。接口刻意做成窄口
 * `search(query, options)`：将来加 Brave/Tavily/厂商 API 时只加一个 adapter，
 * 工具层与来源标签零改动。
 *
 * 诚实边界：
 *  · **未配置 ≠ 无结果**：provider=none 或 baseUrl 空 → `web_search_not_configured`
 *    （带如何配置的说明），绝不返回空数组冒充"搜过了"。
 *  · **结果来源保留**：每条结果带 `source`（主机名），上层据此渲染来源标签。
 *  · **有界**：条数与单条摘要长度都钳位；被钳位时 `truncated:true`。
 *  · **成本可报**：`cost.requests` / `cost.bytes` 由本层计量（不预测 money）。
 */

const SEARCH_PROVIDERS = Object.freeze(['searxng', 'deepseek']);
const SNIPPET_LIMIT = 400;
const RAW_BODY_LIMIT = 512 * 1024;
// BLOCK-454 P2 — DeepSeek 独立 Search API（findings §2 VERIFIED）：
// POST https://api.deepseek.com/v1/tools/search，query 上限 128 字符。
const DEEPSEEK_SEARCH_URL = 'https://api.deepseek.com/v1/tools/search';
const DEEPSEEK_QUERY_LIMIT = 128;

function normalizeBaseUrl(raw) {
  const text = String(raw || '').trim().replace(/\/+$/, '');
  return text;
}

function clampCount(value, fallback = 5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(20, Math.floor(n)));
}

function summarizeSnippet(raw) {
  const text = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  return text.length > SNIPPET_LIMIT ? `${text.slice(0, SNIPPET_LIMIT - 1)}…` : text;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * 归一化 SearXNG 的 JSON 响应。
 * @returns {{results:Array, truncated:boolean}}
 */
function normalizeSearxngResults(payload, { count, allowedHosts = [], blockedHosts = [] } = {}) {
  const rows = payload && Array.isArray(payload.results) ? payload.results : [];
  const out = [];
  let filtered = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const url = typeof row.url === 'string' ? row.url.trim() : '';
    if (!url) continue;
    const source = hostOf(url);
    if (!source) continue;
    const blocked = blockedHosts.some((item) => source === item || source.endsWith(`.${item}`));
    if (blocked) { filtered += 1; continue; }
    if (allowedHosts.length > 0) {
      const matched = allowedHosts.some((item) => source === item || source.endsWith(`.${item}`));
      if (!matched) { filtered += 1; continue; }
    }
    out.push({
      title: summarizeSnippet(row.title || row.url).slice(0, 200),
      url,
      snippet: summarizeSnippet(row.content || row.snippet || ''),
      source,
      ...(typeof row.engine === 'string' && row.engine ? { engine: row.engine.slice(0, 40) } : {}),
    });
    if (out.length >= count) break;
  }
  return { results: out, truncated: rows.length > out.length, filtered };
}

/**
 * BLOCK-454 P2 — DeepSeek 独立 Search API 响应归一。
 * 上游 results[] 字段：rerank_score/url/snippet/summary/content/site_name/authority；
 * 归一到与 SearXNG 同款的结果形状（title/url/snippet/source），deepseek 特有的
 * rerank_score / authority 保留（排序依据可审计）。key 不在本层存取——由
 * getApiKeyFn（凭据族）注入，与 web-search-config「不存凭据」边界一致。
 * @returns {{results:Array, truncated:boolean, filtered:number}}
 */
function normalizeDeepseekResults(payload, { count, allowedHosts = [], blockedHosts = [] } = {}) {
  const rows = payload && Array.isArray(payload.results) ? payload.results : [];
  const out = [];
  let filtered = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const url = typeof row.url === 'string' ? row.url.trim() : '';
    if (!url) continue;
    const source = hostOf(url);
    if (!source) continue;
    const blocked = blockedHosts.some((item) => source === item || source.endsWith(`.${item}`));
    if (blocked) { filtered += 1; continue; }
    if (allowedHosts.length > 0) {
      const matched = allowedHosts.some((item) => source === item || source.endsWith(`.${item}`));
      if (!matched) { filtered += 1; continue; }
    }
    out.push({
      title: summarizeSnippet(row.title || row.site_name || row.url).slice(0, 200),
      url,
      snippet: summarizeSnippet(row.summary || row.snippet || row.content || ''),
      source,
      ...(Number.isFinite(Number(row.rerank_score)) ? { rerank_score: Number(row.rerank_score) } : {}),
      ...(typeof row.authority === 'string' && row.authority ? { authority: row.authority.slice(0, 40) } : {}),
    });
    if (out.length >= count) break;
  }
  return { results: out, truncated: rows.length > out.length, filtered };
}

/** 默认 key 查询：凭据族唯一来源（懒 require，避免本模块被轻量测试环境拖起 ai-settings）。 */
function defaultDeepseekKeyLookup() {
  try {
     
    const { getApiKey } = require('./ai-settings');
    return getApiKey('deepseek') || '';
  } catch {
    return '';
  }
}

/**
 * 执行检索。
 * @param {{query:string, count?:number, config:object, fetchImpl?:Function, getApiKeyFn?:Function}} input
 */
async function searchWeb(input = {}) {
  const query = String(input.query || '').trim();
  const config = input.config || {};
  if (!query) {
    return { ok: false, code: 'web_query_missing', message: '缺少 query。' };
  }
  if (query.length > 400) {
    return { ok: false, code: 'web_query_too_long', message: `query 过长（${query.length} 字符，上限 400）。` };
  }
  if (config.enabled !== true) {
    return {
      ok: false,
      code: 'web_access_disabled',
      message: '联网能力未开启（默认关）。请在 设置 → 网络与联网 里打开「允许联网检索与抓取」后再试。',
    };
  }
  const provider = String(config.provider || 'none');
  if (!SEARCH_PROVIDERS.includes(provider)) {
    return {
      ok: false,
      code: 'web_search_not_configured',
      message: '未选择检索后端。请在 设置 → 网络与联网 里选择 SearXNG 并填写实例地址（自建实例不需要密钥）。',
    };
  }

  // BLOCK-454 P2 — deepseek-search 分支：云端 Search API（可选渠道，SearXNG 仍是默认）。
  if (provider === 'deepseek') {
    return searchDeepseek({ query, input, config });
  }

  const baseUrl = normalizeBaseUrl(config.searxngBaseUrl);
  if (!baseUrl) {
    return {
      ok: false,
      code: 'web_search_not_configured',
      message: '已选 SearXNG 但未填实例地址。请填写形如 http://127.0.0.1:8080 的自建实例地址。',
    };
  }

  const count = clampCount(input.count, clampCount(config.maxResults, 5));
  const timeoutMs = Math.max(1000, Number(config.timeoutMs) || 10000);
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, code: 'web_search_unavailable', message: '当前运行时没有 fetch，无法检索。' };
  }

  const target = new URL(`${baseUrl}/search`);
  target.searchParams.set('q', query);
  target.searchParams.set('format', 'json');
  target.searchParams.set('language', 'zh-CN');
  target.searchParams.set('safesearch', '1');

  let response;
  try {
    response = await fetchImpl(target.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'application/json',
        'user-agent': 'Petri-Desktop/0.0.1 (+local-first agent; web_search)',
      },
    });
  } catch (error) {
    const name = error && error.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, code: 'web_search_timeout', message: `检索超时（>${timeoutMs}ms）：${baseUrl}`, retryable: true, provider };
    }
    return {
      ok: false,
      code: 'web_search_failed',
      message: `检索请求失败：${error && error.message ? error.message : 'unknown'}（实例地址：${baseUrl}）`,
      retryable: true,
      provider,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      code: 'web_search_http_error',
      message: `检索实例返回 HTTP ${response.status}（${baseUrl}）。请确认实例已开启 JSON 输出（searxng settings.yml 的 search.formats 含 json）。`,
      retryable: response.status >= 500,
      provider,
      status: response.status,
    };
  }

  let raw;
  try {
    raw = await response.text();
  } catch (error) {
    return { ok: false, code: 'web_search_body_failed', message: `读取检索响应失败：${error && error.message ? error.message : 'unknown'}`, retryable: true, provider };
  }
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes > RAW_BODY_LIMIT) {
    return { ok: false, code: 'web_search_response_too_large', message: `检索响应过大（${bytes} 字节，上限 ${RAW_BODY_LIMIT}）。`, provider };
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      code: 'web_search_bad_response',
      message: '检索实例返回的不是 JSON（很可能未开启 json 格式输出）。',
      provider,
    };
  }

  const normalized = normalizeSearxngResults(payload, {
    count,
    allowedHosts: Array.isArray(config.allowedHosts) ? config.allowedHosts : [],
    blockedHosts: Array.isArray(config.blockedHosts) ? config.blockedHosts : [],
  });

  return {
    ok: true,
    provider,
    query,
    results: normalized.results,
    truncated: normalized.truncated,
    ...(normalized.filtered > 0 ? { filtered: normalized.filtered } : {}),
    cost: { requests: 1, bytes, results: normalized.results.length },
    // 注意：检索的**信息来源**在 results[].source（各站点主机名）；这里的 backend
    // 只是"检索后端"本身（自建 SearXNG 实例）。两者别混：来源标签要给前者。
    backend: hostOf(baseUrl),
    note: normalized.results.length === 0
      ? '实例返回 0 条结果：可能是查询太窄，也可能是实例的上游引擎被限流——这不是「没有这个主题」。'
      : undefined,
  };
}

/**
 * BLOCK-454 P2 — deepseek-search adapter（POST /v1/tools/search）。
 * 契约：findings §2（VERIFIED）。诚实边界与 SearXNG 同款：key 未配置 →
 * web_search_not_configured；0 结果仍 ok=true 带 note；成本逐请求计量。
 */
async function searchDeepseek({ query, input, config }) {
  const getApiKeyFn = typeof input.getApiKeyFn === 'function' ? input.getApiKeyFn : defaultDeepseekKeyLookup;
  const apiKey = String(getApiKeyFn('deepseek') || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      code: 'web_search_not_configured',
      message: '已选 DeepSeek 搜索但未配置 DeepSeek API key。请在 设置 → AI 设置 填入 DeepSeek API Key（与对话共用同一凭据），或在 设置 → 网络与联网 改选 SearXNG（自建、无需密钥）。',
    };
  }
  if (query.length > DEEPSEEK_QUERY_LIMIT) {
    return {
      ok: false,
      code: 'web_query_too_long',
      message: `query 过长（${query.length} 字符）：DeepSeek Search 渠道上限 128 字符，请缩短后重试。`,
    };
  }

  const count = clampCount(input.count, clampCount(config.maxResults, 5));
  const timeoutMs = Math.max(1000, Number(config.timeoutMs) || 10000);
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, code: 'web_search_unavailable', message: '当前运行时没有 fetch，无法检索。' };
  }

  let response;
  try {
    response = await fetchImpl(DEEPSEEK_SEARCH_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        'user-agent': 'Petri-Desktop/0.0.1 (+local-first agent; web_search)',
      },
      body: JSON.stringify({ query, count, need_content: false }),
    });
  } catch (error) {
    const name = error && error.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, code: 'web_search_timeout', message: `检索超时（>${timeoutMs}ms）：DeepSeek Search`, retryable: true, provider: 'deepseek' };
    }
    return {
      ok: false,
      code: 'web_search_failed',
      message: `检索请求失败：${error && error.message ? error.message : 'unknown'}（DeepSeek Search）`,
      retryable: true,
      provider: 'deepseek',
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      code: 'web_search_http_error',
      message: `DeepSeek Search 返回 HTTP ${response.status}${response.status === 401 || response.status === 403 ? '（API key 无效或无权限，请检查 设置 → AI 设置）' : ''}。`,
      retryable: response.status >= 500,
      provider: 'deepseek',
      status: response.status,
    };
  }

  let raw;
  try {
    raw = await response.text();
  } catch (error) {
    return { ok: false, code: 'web_search_body_failed', message: `读取检索响应失败：${error && error.message ? error.message : 'unknown'}`, retryable: true, provider: 'deepseek' };
  }
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes > RAW_BODY_LIMIT) {
    return { ok: false, code: 'web_search_response_too_large', message: `检索响应过大（${bytes} 字节，上限 ${RAW_BODY_LIMIT}）。`, provider: 'deepseek' };
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      code: 'web_search_bad_response',
      message: 'DeepSeek Search 返回的不是 JSON。',
      provider: 'deepseek',
    };
  }

  const normalized = normalizeDeepseekResults(payload, {
    count,
    allowedHosts: Array.isArray(config.allowedHosts) ? config.allowedHosts : [],
    blockedHosts: Array.isArray(config.blockedHosts) ? config.blockedHosts : [],
  });

  return {
    ok: true,
    provider: 'deepseek',
    query,
    results: normalized.results,
    truncated: normalized.truncated,
    ...(normalized.filtered > 0 ? { filtered: normalized.filtered } : {}),
    cost: { requests: 1, bytes, results: normalized.results.length },
    // backend=检索后端本身；信息来源在 results[].source（各站点主机名），两者别混。
    backend: hostOf(DEEPSEEK_SEARCH_URL),
    note: normalized.results.length === 0
      ? 'DeepSeek Search 返回 0 条结果：可能是查询太窄或上游被限流——这不是「没有这个主题」。'
      : undefined,
  };
}

module.exports = {
  SEARCH_PROVIDERS,
  SNIPPET_LIMIT,
  RAW_BODY_LIMIT,
  DEEPSEEK_SEARCH_URL,
  DEEPSEEK_QUERY_LIMIT,
  normalizeBaseUrl,
  clampCount,
  normalizeSearxngResults,
  normalizeDeepseekResults,
  searchWeb,
};
