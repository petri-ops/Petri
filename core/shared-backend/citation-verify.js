'use strict';

/**
 * shared-backend/citation-verify.js
 *
 * item 87 第一阶段 —— 引用验真（方案 §6 四道机制之「入库验真关」）。
 *
 * DOI 反查：先 Crossref（绝大多数期刊论文），404 再 DataCite 兜底
 * （Bioconductor/R 包等基础设施 DOI 走 DataCite，实测 10.18129/B9.bioc.DESeq2
 * 在 Crossref 是 404、DataCite 是 200——只接 Crossref 会把真 DOI 误杀）。
 * 隐私红线（方案 §9）：反查请求只发 DOI/题录字段，永不携带用户正文。
 *
 * fail-closed 契约：
 * - 返回 status ∈ verified | title_mismatch | doi_unresolvable | network_error
 * - 只有 verified 才允许入库（do-knowledge-store.js 钉②强制）；
 *   网络错误/解析失败永远不是 verified——不可达 ≠ 验真通过。
 * - fetch 可注入：测试走录制 fixture；live 测试/采集管线用默认真调用。
 *   结果里 via/checkedAt/registry 如实留痕，绝不把 mock 冒充实测。
 */

const CROSSREF_API = 'https://api.crossref.org/works/';
const DATACITE_API = 'https://api.datacite.org/dois/';
const DEFAULT_TIMEOUT_MS = 15000;
const DOI_RE = /^10\.\d{4,9}\/\S+$/;

/** 剥 https://doi.org/ / dx.doi.org / doi: 前缀并小写化；非法形态返回 null。 */
function normalizeDoi(input) {
  if (typeof input !== 'string') return null;
  let doi = input.trim();
  doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  doi = doi.replace(/^doi:/i, '');
  doi = doi.toLowerCase();
  if (!DOI_RE.test(doi)) return null;
  return doi;
}

function nowIso() {
  return new Date().toISOString();
}

async function fetchJson(fetchImpl, url, timeoutMs) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, controller ? { signal: controller.signal } : {});
    const json = await response.json().catch(() => ({}));
    return { ok: response.ok === true, status: response.status, json };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function crossrefRecord(json) {
  const message = json && json.message ? json.message : {};
  const authors = Array.isArray(message.author)
    ? message.author.map((author) => [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean)
    : undefined;
  const issuedParts = message.issued && Array.isArray(message.issued['date-parts'])
    ? message.issued['date-parts'][0]
    : null;
  const issued = issuedParts && Number.isFinite(issuedParts[0]) ? issuedParts[0] : undefined;
  return {
    doi: typeof message.DOI === 'string' ? message.DOI.toLowerCase() : undefined,
    title: Array.isArray(message.title) ? message.title[0] : message.title,
    authors,
    year: issued,
    container: Array.isArray(message['container-title']) ? message['container-title'][0] : message['container-title'],
    publisher: message.publisher,
  };
}

function dataciteRecord(json) {
  const attributes = json && json.data && json.data.attributes ? json.data.attributes : {};
  const titles = Array.isArray(attributes.titles) ? attributes.titles.map((entry) => entry.title) : [];
  return {
    doi: typeof attributes.doi === 'string' ? attributes.doi.toLowerCase() : undefined,
    title: titles[0],
    authors: undefined,
    year: attributes.publicationYear,
    container: typeof attributes.publisher === 'string' ? attributes.publisher : undefined,
    publisher: attributes.publisher,
  };
}

function titlesRoughlyMatch(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return true; // 没给期望标题=只验 DOI 可解析
  const compact = (value) => value.toLowerCase().replace(/\s+/g, ' ').trim();
  const a = compact(expected);
  const b = compact(actual);
  if (a === b) return true;
  // 容忍副标题/截断：短串包含在长串里也算匹配（同向比较两次）
  return a.length >= 12 && (b.includes(a) || a.includes(b));
}

/**
 * 验真单条引用。options: { doi, expectedTitle? }；deps: { fetch?, timeoutMs? }。
 * 返回 { status, via?, record?, checkedAt, error?, registryStatus? }。
 */
async function verifyCitation(options = {}, deps = {}) {
  const doi = normalizeDoi(options.doi);
  const checkedAt = nowIso();
  if (!doi) {
    return { status: 'doi_unresolvable', checkedAt, error: 'DOI 形态非法（应为 10.xxxx/…）' };
  }
  const fetchImpl = deps.fetch || globalThis.fetch;
  const timeoutMs = deps.timeoutMs || DEFAULT_TIMEOUT_MS;

  const registries = [
    { via: 'crossref', url: `${CROSSREF_API}${encodeURIComponent(doi)}`, extract: crossrefRecord },
    { via: 'datacite', url: `${DATACITE_API}${encodeURIComponent(doi)}`, extract: dataciteRecord },
  ];
  let lastError = null;
  for (const registry of registries) {
    let response;
    try {
      response = await fetchJson(fetchImpl, registry.url, timeoutMs);
    } catch (error) {
      lastError = error;
      continue; // 网络错误换下一个库；两库都失败→network_error
    }
    if (!response.ok) continue; // 404/4xx/5xx → 下一个库
    let record;
    try {
      record = registry.extract(response.json);
    } catch (error) {
      lastError = error;
      continue;
    }
    if (!record.title) continue;
    if (!titlesRoughlyMatch(options.expectedTitle, record.title)) {
      return {
        status: 'title_mismatch',
        via: registry.via,
        record,
        checkedAt,
        error: `题录不匹配：期望「${options.expectedTitle}」而 ${registry.via} 记录为「${record.title}」`,
      };
    }
    return { status: 'verified', via: registry.via, record, checkedAt };
  }
  if (lastError) {
    return { status: 'network_error', checkedAt, error: `验真请求失败：${lastError.message || String(lastError)}` };
  }
  return {
    status: 'doi_unresolvable',
    checkedAt,
    error: `Crossref 与 DataCite 均无此 DOI 记录（拒绝入库，不「先留着」）`,
  };
}

module.exports = { normalizeDoi, verifyCitation };
