'use strict';

/**
 * helpers/web-search-provider.js — 检索后端抽象（BLOCK-247 / Q2b）。
 *
 * 现在只有 **SearXNG**（自建元搜索实例：不绑厂商、可内网部署、来源可审计——这是
 * 本地主权形态在联网检索上的落点）。接口刻意做成窄口 `search(query, options)`：
 * 将来加 Brave/Tavily/厂商 API 时只加一个 adapter，工具层与来源标签零改动。
 *
 * 诚实边界：
 *  · **未配置 ≠ 无结果**：provider=none 或 baseUrl 空 → `web_search_not_configured`
 *    （带如何配置的说明），绝不返回空数组冒充"搜过了"。
 *  · **结果来源保留**：每条结果带 `source`（主机名），上层据此渲染来源标签。
 *  · **有界**：条数与单条摘要长度都钳位；被钳位时 `truncated:true`。
 *  · **成本可报**：`cost.requests` / `cost.bytes` 由本层计量（不预测 money）。
 */

const SEARCH_PROVIDERS = Object.freeze(['searxng']);
const SNIPPET_LIMIT = 400;
const RAW_BODY_LIMIT = 512 * 1024;

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
 * 执行检索。
 * @param {{query:string, count?:number, config:object, fetchImpl?:Function}} input
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

module.exports = {
  SEARCH_PROVIDERS,
  SNIPPET_LIMIT,
  RAW_BODY_LIMIT,
  normalizeBaseUrl,
  clampCount,
  normalizeSearxngResults,
  searchWeb,
};
