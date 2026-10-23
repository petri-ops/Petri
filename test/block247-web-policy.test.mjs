import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const policy = require('../core/petri-server/helpers/web-fetch-policy.js');
const { searchWeb, normalizeSearxngResults } = require('../core/petri-server/helpers/web-search-provider.js');

// ── 1. 地址分类：私网/保留/元数据必须被拒，公网放行 ──────────────────────
test('classifyAddress：私网与保留地址分类正确', () => {
  assert.equal(policy.classifyAddress('8.8.8.8'), 'public');
  assert.equal(policy.classifyAddress('127.0.0.1'), 'loopback');
  assert.equal(policy.classifyAddress('10.1.2.3'), 'private');
  assert.equal(policy.classifyAddress('192.168.1.1'), 'private');
  assert.equal(policy.classifyAddress('172.16.0.1'), 'private');
  assert.equal(policy.classifyAddress('172.32.0.1'), 'public');
  assert.equal(policy.classifyAddress('169.254.1.1'), 'link-local');
  assert.equal(policy.classifyAddress('169.254.169.254'), 'metadata');
  assert.equal(policy.classifyAddress('100.64.0.1'), 'cgnat');
  assert.equal(policy.classifyAddress('0.0.0.0'), 'unspecified');
  assert.equal(policy.classifyAddress('::1'), 'loopback');
  assert.equal(policy.classifyAddress('fe80::1'), 'link-local');
  assert.equal(policy.classifyAddress('fd00::1'), 'unique-local');
  assert.equal(policy.classifyAddress('::ffff:127.0.0.1'), 'loopback');
  assert.equal(policy.classifyAddress('2606:4700::1111'), 'public');
});

// ── 2. URL 解析：协议/凭据/主机形态 ───────────────────────────────────
test('parseTargetUrl：只收 http(s)、不收凭据、拒本机主机名', () => {
  const ok = policy.parseTargetUrl('https://example.org/a?b=1');
  assert.equal(ok.ok, true);
  assert.equal(ok.host, 'example.org');

  assert.equal(policy.parseTargetUrl('file:///etc/passwd').code, 'web_url_scheme');
  assert.equal(policy.parseTargetUrl('ftp://example.org/x').code, 'web_url_scheme');
  assert.equal(policy.parseTargetUrl('https://user:pass@example.org/').code, 'web_url_userinfo');
  assert.equal(policy.parseTargetUrl('http://localhost:8080/').code, 'web_url_private_host');
  assert.equal(policy.parseTargetUrl('http://foo.internal/').code, 'web_url_private_host');
  assert.equal(policy.parseTargetUrl('http://127.0.0.1/').code, 'web_url_private_host');
  assert.equal(policy.parseTargetUrl('http://169.254.169.254/').code, 'web_url_private_host');
  assert.equal(policy.parseTargetUrl('').code, 'web_url_missing');
  assert.equal(policy.parseTargetUrl('not a url').code, 'web_url_invalid');
});

// ── 3. 域名黑白名单 ──────────────────────────────────────────────────
test('isHostAllowed：黑名单优先、白名单含子域', () => {
  assert.equal(policy.isHostAllowed('a.example.org', {}).ok, true);
  assert.equal(policy.isHostAllowed('a.example.org', { blockedHosts: ['example.org'] }).code, 'web_host_blocked');
  assert.equal(policy.isHostAllowed('a.example.org', { allowedHosts: ['example.org'] }).ok, true);
  assert.equal(policy.isHostAllowed('a.other.org', { allowedHosts: ['example.org'] }).code, 'web_host_not_allowed');
  assert.equal(policy.isHostAllowed('a.other.org', { allowedHosts: ['example.org'], blockedHosts: ['other.org'] }).code, 'web_host_blocked');
});

// ── 4. DNS 解析后校验：解析到私网即拒 ────────────────────────────────
test('resolveHostAddresses：解析到私网地址一律拒绝', async () => {
  const r1 = await policy.resolveHostAddresses('example.org', {
    lookup: async () => [{ address: '93.184.216.34' }],
  });
  assert.equal(r1.ok, true);

  const r2 = await policy.resolveHostAddresses('sneaky.example', {
    lookup: async () => [{ address: '10.0.0.5' }],
  });
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 'web_url_private_address');

  const r3 = await policy.resolveHostAddresses('sneaky.example', {
    lookup: async () => [{ address: '93.184.216.34' }, { address: '127.0.0.1' }],
  });
  assert.equal(r3.ok, false, '任一地址非公网即拒（多 A 记录混合场景）');
});

// ── 5. 内容类型白名单 ────────────────────────────────────────────────
test('isTextContentType：只收文本类', () => {
  assert.equal(policy.isTextContentType('text/html; charset=utf-8'), true);
  assert.equal(policy.isTextContentType('application/json'), true);
  assert.equal(policy.isTextContentType('image/png'), false);
  assert.equal(policy.isTextContentType('application/octet-stream'), false);
});

// ── 6. HTML → 文本：去脚本/样式/标签，保标题 ─────────────────────────
test('stripHtml：去脚本样式、留正文、抽标题', () => {
  const html = '<html><head><title>格物 &amp; 上下文</title><style>a{color:red}</style></head>'
    + '<body><script>alert(1)</script><p>第一段</p><p>第二段</p></body></html>';
  const text = policy.stripHtml(html);
  assert.equal(text.includes('alert(1)'), false);
  assert.equal(text.includes('color:red'), false);
  assert.ok(text.includes('第一段'));
  assert.ok(text.includes('第二段'));
  assert.equal(policy.extractTitle(html), '格物 & 上下文');
});

// ── 7. 受控抓取：重定向逐跳复检 + 体积上限 + 超时 ─────────────────────
function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('guardedFetch：本机/解析到私网一律拒（DNS rebinding 防线）', async () => {
  const { server, port } = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><title>标题</title><body><p>正文内容</p></body></html>');
  });
  try {
    // 直连 127.0.0.1 会被策略拒（这是对的：IP 字面量在 URL 解析层就拒）
    const blocked = await policy.guardedFetch(`http://127.0.0.1:${port}/page`, { lookup: async () => [{ address: '127.0.0.1' }] });
    assert.equal(blocked.ok, false);
    assert.ok(['web_url_private_host', 'web_url_private_address'].includes(blocked.code), `code=${blocked.code}`);

    // 主机名解析到 127.0.0.1 → 仍拒（防 DNS rebinding）
    const rebound = await policy.guardedFetch(`http://rebind.test:${port}/page`, { lookup: async () => [{ address: '127.0.0.1' }] });
    assert.equal(rebound.ok, false);
    assert.equal(rebound.code, 'web_url_private_address');
  } finally {
    server.close();
  }
});

test('guardedFetch：公网主机名放行后 HTML 落成纯文本', async () => {
  const { server, port } = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><title>标题</title><body><p>正文内容</p></body></html>');
  });
  try {
    const result = await policy.guardedFetch(`http://public.test:${port}/page`, {
      lookup: async () => [{ address: '93.184.216.34' }],
      // 传输层改道到本地测试服（策略层看到的仍是 public.test → 公网）
      fetchImpl: (url, init) => fetch(String(url).replace('public.test', '127.0.0.1'), init),
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.ok(result.text.includes('正文内容'));
    assert.equal(result.truncated, false);
  } finally {
    server.close();
  }
});

test('guardedFetch：重定向到内网地址必须被拒（逐跳复检）', async () => {
  const { server, port } = await startServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  try {
    const result = await policy.guardedFetch(`http://public.test:${port}/redirect`, {
      lookup: async () => [{ address: '93.184.216.34' }],
      fetchImpl: (url, init) => fetch(String(url).replace('public.test', '127.0.0.1'), init),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'web_url_private_host');
    assert.equal(result.redirects.length, 1, '拒绝也要记账：用户能看见它跳去了哪');
  } finally {
    server.close();
  }
});

test('guardedFetch：内容类型与字节上限都按约束生效', async () => {
  const { server, port } = await startServer((req, res) => {
    if (req.url === '/bin') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from([0x89, 0x50]));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('x'.repeat(50_000));
  });
  try {
    const lookup = async () => [{ address: '93.184.216.34' }];
    const bin = await policy.guardedFetch(`http://public.test:${port}/bin`, { lookup, fetchImpl: (url, init) => fetch(url.replace('public.test', '127.0.0.1'), init) });
    assert.equal(bin.ok, false);
    assert.equal(bin.code, 'web_content_type_unsupported');

    const big = await policy.guardedFetch(`http://public.test:${port}/big`, {
      lookup,
      maxBytes: 1024,
      fetchImpl: (url, init) => fetch(url.replace('public.test', '127.0.0.1'), init),
    });
    assert.equal(big.ok, true);
    assert.equal(big.truncated, true);
    assert.ok(big.bytes <= 1024 + 1024, '读体按上限截断（流式，不是读完再截）');
  } finally {
    server.close();
  }
});

// ── 8. 检索：未配置 ≠ 无结果；结果带来源主机名 ───────────────────────
test('searchWeb：默认关 → 明确拒绝；未配后端 → not_configured', async () => {
  const off = await searchWeb({ query: 'x', config: { enabled: false, provider: 'none' } });
  assert.equal(off.ok, false);
  assert.equal(off.code, 'web_access_disabled');

  const noProvider = await searchWeb({ query: 'x', config: { enabled: true, provider: 'none' } });
  assert.equal(noProvider.ok, false);
  assert.equal(noProvider.code, 'web_search_not_configured');

  const noBaseUrl = await searchWeb({ query: 'x', config: { enabled: true, provider: 'searxng', searxngBaseUrl: '' } });
  assert.equal(noBaseUrl.ok, false);
  assert.equal(noBaseUrl.code, 'web_search_not_configured');
});

test('searchWeb：正常检索返回来源主机名与成本', async () => {
  const { server, port } = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      results: [
        { title: 'A', url: 'https://a.example.org/1', content: '内容 A' },
        { title: 'B', url: 'https://b.example.net/2', content: '内容 B' },
      ],
    }));
  });
  try {
    const result = await searchWeb({
      query: '测试',
      config: { enabled: true, provider: 'searxng', searxngBaseUrl: `http://127.0.0.1:${port}`, maxResults: 5, timeoutMs: 5000 },
    });
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].source, 'a.example.org');
    assert.equal(result.cost.requests, 1);
    assert.ok(result.cost.bytes > 0);
  } finally {
    server.close();
  }
});

test('normalizeSearxngResults：按域名白/黑名单过滤并保留条数上限', () => {
  const payload = {
    results: [
      { title: 'A', url: 'https://a.example.org/1', content: 'x' },
      { title: 'B', url: 'https://b.example.org/2', content: 'x' },
      { title: 'C', url: 'https://c.other.net/3', content: 'x' },
    ],
  };
  const blocked = normalizeSearxngResults(payload, { count: 5, blockedHosts: ['example.org'] });
  assert.equal(blocked.results.length, 1);
  assert.equal(blocked.results[0].source, 'c.other.net');
  assert.equal(blocked.filtered, 2);

  const allowed = normalizeSearxngResults(payload, { count: 5, allowedHosts: ['example.org'] });
  assert.equal(allowed.results.length, 2);

  const capped = normalizeSearxngResults(payload, { count: 1 });
  assert.equal(capped.results.length, 1);
  assert.equal(capped.truncated, true);
});
