'use strict';

/**
 * helpers/web-fetch-policy.js — 出网策略层（BLOCK-247 / Q2b）。
 *
 * 这是**唯一允许发起外部 HTTP 请求的地方**（工具层只调这里）。设计原则：
 *  1. **每一跳都重新校验**：重定向不是"信任上游"的借口——Location 目标同样要过
 *     协议/主机/IP/黑白名单，否则 302 到 169.254.169.254 就绕过了全部防线。
 *  2. **先解析再放行**：域名解析出的所有地址都必须是公网地址（任一命中私网即拒），
 *     防 `localhost`/`*.internal`/DNS rebinding 把请求打到本机或内网。
 *  3. **字节与时间双上限**：边读边计数，超限即断流（不是读完再截断），避免用大文件把
 *     内存打爆；超时用 AbortSignal 硬切。
 *  4. **内容类型白名单**：只接受文本类；二进制回结构化拒绝并说明原因，不返回乱码。
 *  5. **不跟随非 http(s) 协议**（file:/data:/ftp: 一律拒）。
 *
 * 纯函数（`parseTargetUrl` / `classifyAddress` / `isHostAllowed` / `stripHtml`）与
 * 网络副作用（`guardedFetch`）分离：前者可零网络单测，后者在测试里指向本地 HTTP 服务。
 *
 * BLOCK-512 P1 — pin-IP（清 BLOCK-511 §2 第 8 项遗留）：此前「先解析校验、再交 fetch
 * 建连」存在 DNS rebinding TOCTOU 窗口（undici 建连时自行重解析）。现默认通道改
 * Node 内建 http/https + `pinnedLookupFor`（建连层只连**已校验地址**，不再查 DNS）+
 * https `servername=host`（SNI 与证书身份仍按目标主机名校验）。`fetchImpl` 注入契约
 * 保留为测试/兜底通道（不 pin-IP，生产路径零注入不会走到）；`transportImpl` 为新
 * 注入点（测试可用流式 shim 直驱）。
 */

const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');

const MAX_REDIRECTS = 5;
const TEXT_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'text/markdown',
  'application/json',
  'application/xml',
  'text/xml',
];

/** IPv4 私网/保留网段（CIDR 形式，见 classifyIpv4 的展开规则）。 */
const IPV4_BLOCKS = [
  { cidr: '0.0.0.0/8', label: 'unspecified' },
  { cidr: '10.0.0.0/8', label: 'private' },
  { cidr: '100.64.0.0/10', label: 'cgnat' },
  { cidr: '127.0.0.0/8', label: 'loopback' },
  { cidr: '169.254.0.0/16', label: 'link-local' },
  { cidr: '172.16.0.0/12', label: 'private' },
  { cidr: '192.0.0.0/24', label: 'reserved' },
  { cidr: '192.0.2.0/24', label: 'documentation' },
  { cidr: '192.168.0.0/16', label: 'private' },
  { cidr: '198.18.0.0/15', label: 'benchmark' },
  { cidr: '198.51.100.0/24', label: 'documentation' },
  { cidr: '203.0.113.0/24', label: 'documentation' },
  { cidr: '224.0.0.0/4', label: 'multicast' },
  { cidr: '240.0.0.0/4', label: 'reserved' },
];

function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function inIpv4Block(ip, cidr) {
  const [base, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt == null || baseInt == null || !Number.isInteger(bits)) return false;
  const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
  return ((ipInt & mask) >>> 0) === ((baseInt & mask) >>> 0);
}

/** 特殊用途地址（元数据/私网/回环…）→ label；公网 → 'public'。 */
function classifyAddress(address) {
  const raw = String(address || '').trim();
  if (!raw) return 'invalid';
  const version = net.isIP(raw);
  if (version === 4) {
    for (const block of IPV4_BLOCKS) {
      if (inIpv4Block(raw, block.cidr)) {
        return raw === '169.254.169.254' ? 'metadata' : block.label;
      }
    }
    return 'public';
  }
  if (version === 6) {
    const lower = raw.toLowerCase();
    if (lower === '::1') return 'loopback';
    if (lower === '::') return 'unspecified';
    // IPv4-mapped（::ffff:127.0.0.1）按 v4 判定，别让映射形态绕过私网检查
    const mapped = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return classifyAddress(mapped[1]);
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return 'unique-local';
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return 'link-local';
    if (/^ff[0-9a-f]{2}:/.test(lower)) return 'multicast';
    return 'public';
  }
  return 'invalid';
}

function isPublicAddress(address) {
  return classifyAddress(address) === 'public';
}

/**
 * 解析并校验目标 URL。
 * @returns {{ok:true,url:URL,host:string}|{ok:false,code:string,message:string}}
 */
function parseTargetUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, code: 'web_url_missing', message: '缺少 url。' };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, code: 'web_url_invalid', message: `不是合法 URL：${text.slice(0, 120)}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, code: 'web_url_scheme', message: `只允许 http/https（收到 ${url.protocol}）。` };
  }
  if (url.username || url.password) {
    return { ok: false, code: 'web_url_userinfo', message: '不在 URL 里传凭据（user:pass@host）。' };
  }
  const host = url.hostname.toLowerCase();
  if (!host) return { ok: false, code: 'web_url_host_missing', message: 'URL 缺少主机名。' };
  // 主机名形态的私网/回环直接拒（IP 字面量还需解析后二次判定，见 resolveHostAddresses）
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    return { ok: false, code: 'web_url_private_host', message: `拒绝访问本机/内网主机名：${host}` };
  }
  if (net.isIP(host)) {
    const label = classifyAddress(host);
    if (label !== 'public') {
      return { ok: false, code: 'web_url_private_host', message: `拒绝访问非公网地址（${label}）：${host}` };
    }
  }
  if (url.port && Number(url.port) === 0) {
    return { ok: false, code: 'web_url_port', message: '端口 0 无意义。' };
  }
  return { ok: true, url, host };
}

/** 域名黑白名单：黑名单优先；白名单非空时只放行其命中项（含子域）。 */
function isHostAllowed(host, { allowedHosts = [], blockedHosts = [] } = {}) {
  const target = String(host || '').toLowerCase();
  const match = (list) => list.some((item) => target === item || target.endsWith(`.${item}`));
  if (match(blockedHosts)) {
    return { ok: false, code: 'web_host_blocked', message: `域名在访问黑名单里：${target}` };
  }
  if (blockedHosts.length === 0 && allowedHosts.length === 0) return { ok: true };
  if (allowedHosts.length === 0) return { ok: true };
  if (match(allowedHosts)) return { ok: true };
  return { ok: false, code: 'web_host_not_allowed', message: `域名不在访问白名单里：${target}` };
}

/** 解析主机名并校验全部地址都是公网（任一非公网即拒）。 */
async function resolveHostAddresses(host, { lookup = dns.promises.lookup } = {}) {
  if (net.isIP(host)) {
    const label = classifyAddress(host);
    if (label !== 'public') {
      return { ok: false, code: 'web_url_private_host', message: `拒绝访问非公网地址（${label}）：${host}` };
    }
    return { ok: true, addresses: [host] };
  }
  let records;
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch (error) {
    return {
      ok: false,
      code: 'web_host_unresolved',
      message: `域名解析失败：${host}（${error && error.message ? error.message : 'unknown'}）`,
      retryable: true,
    };
  }
  const addresses = (Array.isArray(records) ? records : []).map((row) => row && row.address).filter(Boolean);
  if (addresses.length === 0) {
    return { ok: false, code: 'web_host_unresolved', message: `域名没有解析结果：${host}`, retryable: true };
  }
  const bad = addresses.find((addr) => !isPublicAddress(addr));
  if (bad) {
    return {
      ok: false,
      code: 'web_url_private_address',
      message: `域名 ${host} 解析到非公网地址（${classifyAddress(bad)}: ${bad}），已拒绝以免打到内网。`,
    };
  }
  return { ok: true, addresses };
}

function isTextContentType(contentType) {
  const base = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!base) return true; // 无 Content-Type：按文本尝试，解析失败会在正文层暴露
  return TEXT_CONTENT_TYPES.some((allowed) => base === allowed);
}

/** 实体解码（只解常见的几个；全量 HTML 实体表不值得为此引依赖）。 */
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…',
  mdash: '—', ndash: '–', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
};

function decodeEntities(text) {
  return String(text || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const mapped = ENTITIES[body.toLowerCase()];
    return mapped === undefined ? whole : mapped;
  });
}

/** 抽取 <title>（有界）。 */
function extractTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  return match ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim() : '';
}

/**
 * HTML → 纯文本（去脚本/样式/标签，保留块级换行）。
 * 不追求完美排版，追求「模型能读、用户能核」：宁可多留空行，也不吞内容。
 */
function stripHtml(html) {
  let text = String(html || '');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<(script|style|noscript|template|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, '\n');
  text = text.replace(/<li[^>]*>/gi, '- ');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);
  text = text.replace(/[ \t\u00a0]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

async function readBodyBounded(response, maxBytes) {
  const reader = response.body && typeof response.body.getReader === 'function'
    ? response.body.getReader()
    : null;
  if (!reader) {
    const text = await response.text();
    const bytes = Buffer.byteLength(text, 'utf8');
    return { text, bytes, truncated: bytes > maxBytes };
  }
  const chunks = [];
  let bytes = 0; // 已收下的字节（= 返回给上层的字节）
  let seenBytes = 0; // 实际从流里读到的字节（截断时会大于 bytes）
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    seenBytes += value.byteLength;
    if (bytes + value.byteLength > maxBytes) {
      truncated = true;
      const keep = Math.max(0, maxBytes - bytes);
      if (keep > 0) chunks.push(Buffer.from(value.slice(0, keep)));
      bytes += keep;
      try { await reader.cancel(); } catch { /* 已结束 */ }
      break;
    }
    bytes += value.byteLength;
    chunks.push(Buffer.from(value));
  }
  return { text: Buffer.concat(chunks).toString('utf8'), bytes, seenBytes, truncated };
}

/** 诚实 UA 与接受面（两条通道共用，不伪装浏览器）。 */
const REQUEST_HEADERS = {
  'user-agent': 'Petri-Desktop/0.0.1 (+local-first agent; web_fetch)',
  accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.1',
};

/**
 * BLOCK-512 P1 — pin 住已校验地址的 lookup：对**任何** hostname 都只回 records，
 * 建连层不再信 DNS（rebind-proof 的核心属性——DNS 再怎么重绑定都影响不到连接目标）。
 * 兼容 `all: true`（回数组）与普通形态（回 address, family）两种回调契约。
 */
function pinnedLookupFor(records) {
  const list = (Array.isArray(records) ? records : [])
    .map((row) => {
      const address = typeof row === 'string' ? row : row && row.address;
      return { address, family: net.isIP(address) === 6 ? 6 : 4 };
    })
    .filter((row) => row.address && net.isIP(row.address));
  return function pinnedLookup(_hostname, options, callback) {
    const cb = typeof options === 'function' ? options : callback;
    if (list.length === 0) {
      const err = new Error('no pinned address');
      err.code = 'ECONNREFUSED';
      return cb(err);
    }
    if (options && typeof options === 'object' && options.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  };
}

/**
 * BLOCK-512 P1 — 默认传输通道：Node 内建 http/https + pinned lookup。
 * https 时 `servername=host`：SNI 与证书身份仍按目标主机名校验（连接目标是 pin 住的
 * IP，但 TLS 语义不变）。超时覆盖建连与读体全程（ destroy 携 TimeoutError 名，
 * guardedFetch 映射为 web_fetch_timeout）。
 */
function defaultTransport({ url, host, addresses, timeoutMs = 10000, headers = {} }) {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;
    const req = mod.request(url, {
      method: 'GET',
      headers: { ...REQUEST_HEADERS, ...headers },
      servername: isHttps ? host : undefined,
      lookup: pinnedLookupFor(addresses),
    }, (res) => {
      resolve({
        status: res.statusCode,
        headers: {
          get(name) {
            const v = res.headers[String(name).toLowerCase()];
            if (v == null) return null;
            return Array.isArray(v) ? v.join(', ') : String(v);
          },
        },
        stream: res,
      });
    });
    req.on('error', reject);
    const timer = setTimeout(() => {
      const err = new Error(`request timed out after ${timeoutMs}ms`);
      err.name = 'TimeoutError';
      req.destroy(err);
    }, Math.max(1000, Number(timeoutMs) || 10000));
    req.on('close', () => clearTimeout(timer));
    req.end();
  });
}

/** 流式有界读（Node 可读流）：超限即断流截断，语义与 readBodyBounded 一致。 */
function readStreamBounded(stream, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let seenBytes = 0;
    let truncated = false;
    let settled = false;
    const cleanup = () => {
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
    };
    const settle = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const onData = (chunk) => {
      seenBytes += chunk.length;
      if (bytes + chunk.length > maxBytes) {
        truncated = true;
        const keep = Math.max(0, maxBytes - bytes);
        if (keep > 0) chunks.push(chunk.subarray(0, keep));
        bytes += keep;
        settle({ text: Buffer.concat(chunks).toString('utf8'), bytes, seenBytes, truncated });
        try { stream.destroy(); } catch { /* 已结束 */ }
      } else {
        chunks.push(Buffer.from(chunk));
        bytes += chunk.length;
      }
    };
    const onEnd = () => settle({ text: Buffer.concat(chunks).toString('utf8'), bytes, seenBytes, truncated });
    const onError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
  });
}

/** 早退路径关闭底层流（node IncomingMessage；fetch Response 无 destroy 时为空操作）。 */
function discardStream(response) {
  try {
    if (response && response.body && typeof response.body.destroy === 'function') response.body.destroy();
  } catch { /* 已结束 */ }
}

/**
 * 受控抓取：逐跳校验 → 解析校验 → 抓取 → 有界读体。
 * 通道选择（BLOCK-512 P1）：显式 `fetchImpl`（兼容契约，不 pin）> `transportImpl`（新
 * 注入点）> `defaultTransport`（生产默认，pinned）。
 * @returns {Promise<object>} 成功 { ok:true, status, finalUrl, host, contentType, text, bytes,
 *   truncated, redirects }；失败 { ok:false, code, message, retryable? }
 */
async function guardedFetch(rawUrl, options = {}) {
  const {
    timeoutMs = 10000,
    maxBytes = 1048576,
    allowedHosts = [],
    blockedHosts = [],
    maxRedirects = MAX_REDIRECTS,
    fetchImpl = undefined,
    transportImpl = undefined,
    lookup = dns.promises.lookup,
  } = options;

  const first = parseTargetUrl(rawUrl);
  if (!first.ok) return first;
  if (fetchImpl !== undefined && typeof fetchImpl !== 'function') {
    return { ok: false, code: 'web_fetch_unavailable', message: '当前运行时没有 fetch，无法抓取。' };
  }

  let current = first.url;
  const redirects = [];
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const parsed = hop === 0 ? first : parseTargetUrl(current.toString());
    if (!parsed.ok) return { ...parsed, redirects };
    const listCheck = isHostAllowed(parsed.host, { allowedHosts, blockedHosts });
    if (!listCheck.ok) return { ...listCheck, redirects };
    const resolved = await resolveHostAddresses(parsed.host, { lookup });
    if (!resolved.ok) return { ...resolved, redirects };

    let response;
    try {
      if (typeof fetchImpl === 'function') {
        // 兼容通道：测试注入的 fetchImpl（undici 自行建连，不 pin-IP——见文件头注记）
        response = await fetchImpl(parsed.url.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 10000)),
          headers: { ...REQUEST_HEADERS },
        });
      } else {
        // BLOCK-512 P1 — 校验与建连合一：addresses 已全公网，传输层 pin 住不再查 DNS
        const transport = typeof transportImpl === 'function'
          ? transportImpl
          : defaultTransport;
        const shim = await transport({
          url: parsed.url,
          host: parsed.host,
          addresses: resolved.addresses,
          timeoutMs,
          maxBytes,
          headers: { ...REQUEST_HEADERS },
        });
        response = {
          status: shim.status,
          ok: shim.status >= 200 && shim.status < 300,
          headers: shim.headers,
          body: shim.stream,
          transportStream: true,
        };
      }
    } catch (error) {
      const name = error && error.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        return { ok: false, code: 'web_fetch_timeout', message: `请求超时（>${timeoutMs}ms）：${parsed.url.toString()}`, retryable: true, redirects };
      }
      return {
        ok: false,
        code: 'web_fetch_failed',
        message: `请求失败：${error && error.message ? error.message : 'unknown'}`,
        retryable: true,
        redirects,
      };
    }

    if (response.status >= 300 && response.status < 400) {
      discardStream(response);
      const location = response.headers.get('location');
      if (!location) {
        return { ok: false, code: 'web_fetch_redirect_invalid', message: `HTTP ${response.status} 缺 Location，无法跟随。`, redirects };
      }
      let nextUrl;
      try {
        nextUrl = new URL(location, parsed.url);
      } catch {
        return { ok: false, code: 'web_fetch_redirect_invalid', message: `Location 不是合法 URL：${String(location).slice(0, 120)}`, redirects };
      }
      redirects.push({ status: response.status, from: parsed.url.toString(), to: nextUrl.toString() });
      if (redirects.length > maxRedirects) {
        return { ok: false, code: 'web_fetch_redirect_limit', message: `重定向超过 ${maxRedirects} 跳，已停止跟随。`, redirects };
      }
      current = nextUrl;
      continue;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!isTextContentType(contentType)) {
      discardStream(response);
      return {
        ok: false,
        code: 'web_content_type_unsupported',
        message: `内容类型不在白名单（${contentType || '未声明'}）：只抓文本类页面。`,
        status: response.status,
        contentType,
        redirects,
      };
    }
    if (!response.ok) {
      discardStream(response);
      return {
        ok: false,
        code: 'web_fetch_http_error',
        message: `HTTP ${response.status}`,
        status: response.status,
        contentType,
        retryable: response.status >= 500 || response.status === 429,
        redirects,
      };
    }

    let body;
    try {
      const cap = Math.max(1024, Number(maxBytes) || 1048576);
      body = response.transportStream
        ? await readStreamBounded(response.body, cap)
        : await readBodyBounded(response, cap);
    } catch (error) {
      const name = error && error.name;
      const code = name === 'TimeoutError' || name === 'AbortError' ? 'web_fetch_timeout' : 'web_fetch_body_failed';
      return { ok: false, code, message: `读取正文失败：${error && error.message ? error.message : 'unknown'}`, retryable: true, redirects };
    }

    return {
      ok: true,
      status: response.status,
      finalUrl: parsed.url.toString(),
      host: parsed.host,
      contentType,
      text: body.text,
      bytes: body.bytes,
      truncated: body.truncated,
      ...(body.seenBytes != null ? { seenBytes: body.seenBytes } : {}),
      redirects,
    };
  }
  return { ok: false, code: 'web_fetch_redirect_limit', message: `重定向超过 ${maxRedirects} 跳，已停止跟随。`, redirects };
}

module.exports = {
  MAX_REDIRECTS,
  TEXT_CONTENT_TYPES,
  IPV4_BLOCKS,
  classifyAddress,
  isPublicAddress,
  parseTargetUrl,
  isHostAllowed,
  resolveHostAddresses,
  isTextContentType,
  decodeEntities,
  extractTitle,
  stripHtml,
  readBodyBounded,
  readStreamBounded,
  pinnedLookupFor,
  defaultTransport,
  guardedFetch,
};
