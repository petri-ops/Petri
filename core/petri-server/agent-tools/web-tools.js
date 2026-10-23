'use strict';

/**
 * agent-tools/web-tools.js — `web_search` / `web_fetch`（BLOCK-247 / Q2b）。
 *
 * 两个工具都是**只读外部请求**（sideEffect=external-request / R1），但「只读」不等于
 * 「随便读」：出网前的每一项校验都在 `helpers/web-fetch-policy.js`，这里只做
 * 「授权开关 → 参数整形 → 调用 → 有界返回 → 落审计」。
 *
 * 三条纪律：
 *  1. **默认关**：`webSearch.enabled=false` 时返回 `web_access_disabled` 并给开启路径，
 *     不抛异常（异常会被上层当故障重试），也不静默返回空结果。
 *  2. **来源与成本必须可见**：结果带 `source`（主机名）、`cost`（请求数/字节数），
 *     抓取带 `redirects`（每一跳的来源），用户与模型都能核账。
 *  3. **审计落盘**：每次出网追加一行 JSONL（时间/工具/主机/状态/字节/拒绝原因），
 *     不记正文——审计要能回答"访问了什么"，不需要复制网页内容。
 *
 * 依赖注入：`deps`（第三参）是**测试缝隙**——可替换 fetch 实现与 DNS 解析，
 * 让单测用假网络覆盖成功路径（生产调用方永远只传两个参数，注入面不外露到 ctx）。
 */

const fs = require('fs');
const path = require('path');

const config = require('../helpers/web-search-config');
const policy = require('../helpers/web-fetch-policy');
const { searchWeb } = require('../helpers/web-search-provider');

/** 抓取正文进模型上下文的上限（字符）。超限截断并如实标注。 */
const FETCH_TEXT_LIMIT = 20000;
const AUDIT_FILENAME = 'web-access-audit.jsonl';
const AUDIT_MAX_BYTES = 2 * 1024 * 1024;

function auditPath() {
  return path.join(path.dirname(config.storePath()), AUDIT_FILENAME);
}

/** 追加一条审计记录；任何失败都不阻塞工具（审计坏了不该让检索不可用），但会被计数。 */
function appendAudit(entry) {
  try {
    const file = auditPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      const stat = fs.statSync(file);
      if (stat.size > AUDIT_MAX_BYTES) {
        // 轮转：留一份 .1，避免无界增长（用户可核账，但不吃盘）
        fs.renameSync(file, `${file}.1`);
      }
    } catch { /* 文件不存在：首次写入 */ }
    fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function readAuditTail(limit = 200) {
  try {
    const raw = fs.readFileSync(auditPath(), 'utf8');
    return raw.split('\n').filter(Boolean).slice(-Math.max(1, Math.min(2000, limit))).map((line) => {
      try { return JSON.parse(line); } catch { return { corrupt: true }; }
    });
  } catch {
    return [];
  }
}

function effectiveHostLists() {
  const snapshot = config.getSnapshot();
  return {
    snapshot,
    allowedHosts: snapshot.allowedHosts,
    blockedHosts: snapshot.blockedHosts,
  };
}

function withAudit(result, base) {
  appendAudit({
    ...base,
    ok: result.ok === true,
    code: result.code || null,
    status: result.status || null,
    // 来源与成本也入账：审计要能回答"结论从哪来、花了多少"（与前端来源标签同源）。
    ...(result.source ? { source: String(result.source).slice(0, 160) } : {}),
    ...(Array.isArray(result.results) && result.results.length > 0
      ? { resultSources: result.results.map((row) => String(row && row.source).slice(0, 120)).filter(Boolean).slice(0, 5) }
      : {}),
    ...(result.cost ? { cost: result.cost } : {}),
  });
  return result;
}

async function tool_web_search(args = {}, _ctx = {}, deps = {}) {
  const { snapshot, allowedHosts, blockedHosts } = effectiveHostLists();
  const effective = snapshot.effective;
  const result = await searchWeb({
    query: args.query,
    count: args.count,
    config: { ...effective, allowedHosts, blockedHosts },
    ...(deps && typeof deps.fetchImpl === 'function' ? { fetchImpl: deps.fetchImpl } : {}),
  });
  return withAudit(result, {
    tool: 'web_search',
    query: String(args.query || '').slice(0, 200),
    provider: effective.provider,
  });
}

async function tool_web_fetch(args = {}, _ctx = {}, deps = {}) {
  const { snapshot, allowedHosts, blockedHosts } = effectiveHostLists();
  const effective = snapshot.effective;
  const rawUrl = String(args.url || '');

  if (effective.enabled !== true) {
    return withAudit({
      ok: false,
      code: 'web_access_disabled',
      message: '联网能力未开启（默认关）。请在 设置 → 网络与联网 里打开「允许联网检索与抓取」后再试。',
    }, { tool: 'web_fetch', url: rawUrl.slice(0, 300) });
  }

  const fetched = await policy.guardedFetch(rawUrl, {
    timeoutMs: effective.timeoutMs,
    maxBytes: effective.fetchMaxBytes,
    allowedHosts,
    blockedHosts,
    ...(deps && typeof deps.fetchImpl === 'function' ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps && typeof deps.lookup === 'function' ? { lookup: deps.lookup } : {}),
  });

  if (!fetched.ok) {
    return withAudit({
      ...fetched,
      source: (() => {
        try { return new URL(rawUrl).hostname.toLowerCase(); } catch { return ''; }
      })(),
    }, { tool: 'web_fetch', url: rawUrl.slice(0, 300) });
  }

  const html = /html|xhtml/i.test(fetched.contentType || '');
  const extracted = html ? policy.stripHtml(fetched.text) : fetched.text;
  const title = html ? policy.extractTitle(fetched.text) : '';
  const clipped = extracted.length > FETCH_TEXT_LIMIT;
  const text = clipped
    ? `${extracted.slice(0, FETCH_TEXT_LIMIT)}\n…（正文超出 ${FETCH_TEXT_LIMIT} 字符上限，已截断；完整内容未落盘）`
    : extracted;

  return withAudit({
    ok: true,
    url: rawUrl,
    finalUrl: fetched.finalUrl,
    source: fetched.host,
    ...(title ? { title } : {}),
    contentType: fetched.contentType,
    status: fetched.status,
    text,
    chars: text.length,
    bytes: fetched.bytes,
    // bytes = 网上读到的字节（成本口径）；bytesKept = 真正进入上下文的字节（受上限约束）
    bytesKept: Buffer.byteLength(text, 'utf8'),
    truncated: clipped || fetched.truncated === true,
    ...(fetched.truncated ? { bodyTruncated: true } : {}),
    redirects: fetched.redirects,
    cost: { requests: 1 + fetched.redirects.length, bytes: fetched.bytes },
    note: clipped || fetched.truncated
      ? '内容有界返回：超时/字节/字符任一上限命中即截断，引用时请以来源链接为准。'
      : undefined,
  }, { tool: 'web_fetch', url: rawUrl.slice(0, 300), host: fetched.host });
}

module.exports = {
  FETCH_TEXT_LIMIT,
  AUDIT_FILENAME,
  tool_web_search,
  tool_web_fetch,
  readAuditTail,
};
