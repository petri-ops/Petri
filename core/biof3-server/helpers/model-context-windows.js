/**
 * Dynamic model context window resolution via OpenRouter /models API.
 *
 * Strategy (in getContextWindow priority order):
 *   1. Hard-coded known list  → instant sync return
 *   2. OpenRouter in-memory cache → sync LRU lookup
 *      - cache miss triggers async fetch + cache population
 *      - only fires when baseUrl contains openrouter.ai
 *   3. Unknown / other providers → 0 (frontend renders "—")
 *
 * Cache: in-process Map, TTL 1 hour, max 200 entries.
 * Designed to be called from hot request paths; async fetch is fire-and-forget
 * so first request for a new model returns 0 immediately while background fetch
 * populates the cache for subsequent requests.
 */
const { encoding_for_model: encForModel } = require('tiktoken');

// ---------------------------------------------------------------------------
// LRU cache
// ---------------------------------------------------------------------------
const MAX_ENTRIES = 200;
const TTL_MS = 60 * 60 * 1000; // 1 hour

const _cache = new Map(); // key → { value, ts }

function _cacheSet(key, value) {
  if (_cache.size >= MAX_ENTRIES) {
    // Evict oldest entry (first-inserted, not true LRU but sufficient)
    const firstKey = _cache.keys().next().value;
    _cache.delete(firstKey);
  }
  _cache.set(key, { value, ts: Date.now() });
}

function _cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    _cache.delete(key);
    return null;
  }
  return entry.value;
}

// ---------------------------------------------------------------------------
// Hard-coded fallback (mirrors token-estimator.js known list for speed)
// ---------------------------------------------------------------------------
const HARDCODED = {
  'deepseek-chat': 64000,
  'deepseek-coder': 128000,
  'deepseek-v4-flash': 1_000_000,
  'deepseek-v4': 1_000_000,
  'gpt-4': 8192,
  'gpt-4-32k': 32768,
  'gpt-4-turbo': 128000,
  'gpt-4o': 128000,
  'gpt-3.5-turbo': 16385,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-5-haiku-20241022': 200000,
};

// ---------------------------------------------------------------------------
// OpenRouter fetch
// ---------------------------------------------------------------------------

// BLOCK-102 P4 — 5s 超时 + in-flight 去重：缓存 miss 曾每条消息重发且失败永不
// 写缓存，慢网下挂起连接随聊天流量累积（UDP 端口耗尽事件的一类嫌疑面）。
const openRouterInflight = new Set();

/** Fire-and-forget fetch. Populates cache on success; silently ignores errors. */
function fetchOpenRouterModels({ baseUrl, apiKey }) {
  const url = `${baseUrl.replace(/\/$/, '')}/models`;
  const inflightKey = `${url}|${apiKey || ''}`;
  if (openRouterInflight.has(inflightKey)) return;
  openRouterInflight.add(inflightKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const done = () => {
    clearTimeout(timer);
    openRouterInflight.delete(inflightKey);
  };
  fetch(url, {
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${apiKey || ''}`,
      'HTTP-Referer': 'https://biof3.local',
      'X-Title': 'BioF3 Desktop',
    },
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      if (!Array.isArray(data.data)) return;
      for (const model of data.data) {
        const ctx = model.context_length;
        if (ctx && typeof ctx === 'number') {
          _cacheSet(`openrouter:${model.id}`, ctx);
        }
      }
    })
    .catch(() => {
      // Network / auth errors: silently ignore, cache stays cold
    })
    .finally(done);
}

/** Async: returns cached value or kicks off background fetch and returns 0. */
async function getOpenRouterContextWindow(modelId, { baseUrl, apiKey }) {
  const key = `openrouter:${modelId}`;
  const cached = _cacheGet(key);
  if (cached !== null) return cached;

  // Fire-and-forget; return 0 for this request
  fetchOpenRouterModels({ baseUrl, apiKey });
  return 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve context window for a model.
 *
 * @param {string} modelName       - resolved model ID string
 * @param {string} providerName    - provider key e.g. 'openai', 'deepseek', 'anthropic'
 * @param {string} [baseUrl]       - API base URL from preset
 * @param {string} [apiKey]        - API key from preset
 * @returns {Promise<number>}       - context window in tokens, or 0 if unknown
 */
async function getContextWindow(modelName, providerName, baseUrl, apiKey) {
  if (!modelName) return 0;

  // 1. Hard-coded known list (sync, fastest path)
  const lower = modelName.toLowerCase();
  if (HARDCODED[lower] !== undefined) return HARDCODED[lower];

  // 2. OpenRouter: baseUrl check is sufficient (no extra API key guard needed)
  if (
    providerName === 'openai-compatible' &&
    baseUrl &&
    baseUrl.includes('openrouter.ai')
  ) {
    return await getOpenRouterContextWindow(modelName, { baseUrl, apiKey });
  }

  // 3. Everything else: unknown → 0 (frontend shows "—")
  return 0;
}

module.exports = {
  getContextWindow,
  // Exported for testing
  _cache,
  _cacheGet,
  _cacheSet,
};
