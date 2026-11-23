/**
 * QODER-L1/L2 P1 — 联网搜索/抓取行为合同输出归一（2026-11-23）。
 *
 * 只借行为合同（summary/来源/权威度），不接 Qoder 端点、零新依赖。
 * D2 权威度口径=上游已有则透传、无则 null（不自造评分规则=不造第二真相）。
 * 红线：不改出网调用链、不新增配置键、不碰凭据/CSP/sandbox。
 */
'use strict';

const SUMMARY_LIMIT = 400;

function safeUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function authorityOf(row) {
  if (!row || typeof row.authority !== 'string' || !row.authority.trim()) return null;
  return row.authority.trim().slice(0, 40);
}

/** L1：搜索结果行为合同投影——summary 有界、authority 透传/诚实 null、来源保留。 */
function projectSearchResults(input = {}) {
  const rows = Array.isArray(input.results) ? input.results : [];
  const results = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const url = safeUrl(row.url);
    if (!url) continue;
    results.push({
      title: String(row.title || '').slice(0, 200),
      url,
      source: typeof row.source === 'string' ? row.source.slice(0, 200) : null,
      summary: String(row.summary || row.snippet || '').slice(0, SUMMARY_LIMIT),
      authority: authorityOf(row),
      ...(Number.isFinite(Number(row.rerank_score)) ? { rerank_score: Number(row.rerank_score) } : {}),
    });
  }
  return { results, truncated: Boolean(input.truncated), filtered: Number(input.filtered) || 0 };
}

/** L2：抓取结果只补 source/authority 元数据，正文 text 一字不改。 */
function projectFetchMetadata(input = {}) {
  if (input.ok !== true) return { ok: false, error: 'fetch_not_ok' };
  const url = safeUrl(input.url);
  if (!url) return { ok: false, error: 'invalid_url' };
  return {
    ok: true,
    url,
    source: typeof input.source === 'string' ? input.source.slice(0, 200) : null,
    authority: authorityOf(input),
    text: typeof input.text === 'string' ? input.text : '',
    ...(Number.isFinite(input.chars) ? { chars: input.chars } : {}),
  };
}

module.exports = { SUMMARY_LIMIT, projectSearchResults, projectFetchMetadata };
