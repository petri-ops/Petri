import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-web-'));
process.env.PETRI_LOCAL_DATA_DIR = TMP_ROOT;

const config = require('../core/petri-server/helpers/web-search-config.js');
const { tool_web_search, tool_web_fetch, readAuditTail } = require('../core/petri-server/agent-tools/web-tools.js');

function resetConfig(patch = {}) {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  fs.writeFileSync(path.join(TMP_ROOT, 'web-search.json'), JSON.stringify(patch, null, 2), 'utf8');
}

const PUBLIC_LOOKUP = async () => [{ address: '93.184.216.34' }];

function htmlResponse(body, { status = 200, contentType = 'text/html; charset=utf-8', headers = {} } = {}) {
  const map = new Map(Object.entries({ 'content-type': contentType, ...headers }));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => map.get(String(name).toLowerCase()) || null },
    body: {
      getReader() {
        const buf = Buffer.from(body, 'utf8');
        let done = false;
        return {
          async read() {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: new Uint8Array(buf) };
          },
          async cancel() { done = true; },
        };
      },
    },
    async text() { return body; },
  };
}

test('默认关：检索与抓取都返回结构化拒绝（不静默、不出网）', async () => {
  resetConfig({});
  const search = await tool_web_search({ query: '格物' });
  assert.equal(search.ok, false);
  assert.equal(search.code, 'web_access_disabled');
  assert.match(search.message, /默认关/);

  const fetchResult = await tool_web_fetch({ url: 'https://example.org/' });
  assert.equal(fetchResult.ok, false);
  assert.equal(fetchResult.code, 'web_access_disabled');
});

test('开启但未配置检索后端：报「未配置」而不是空结果', async () => {
  resetConfig({ enabled: true, provider: 'none' });
  const result = await tool_web_search({ query: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'web_search_not_configured');
});

test('检索成功：结果带来源主机名与成本，审计落一行', async () => {
  resetConfig({ enabled: true, provider: 'searxng', searxngBaseUrl: 'http://searx.internal:8080' });
  const before = readAuditTail().length;
  const result = await tool_web_search({ query: '格物', count: 2 }, {}, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          results: [
            { title: '结果一', url: 'https://a.example.org/1', content: '摘要一' },
            { title: '结果二', url: 'https://b.example.net/2', content: '摘要二' },
          ],
        });
      },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].source, 'a.example.org');
  assert.equal(result.cost.requests, 1);
  const audit = readAuditTail();
  assert.equal(audit.length, before + 1);
  assert.equal(audit[audit.length - 1].tool, 'web_search');
  assert.equal(audit[audit.length - 1].ok, true);
});

test('抓取成功：正文转纯文本、返回来源与重定向链', async () => {
  resetConfig({ enabled: true, provider: 'none' });
  const result = await tool_web_fetch({ url: 'https://example.org/doc' }, {}, {
    lookup: PUBLIC_LOOKUP,
    fetchImpl: async () => htmlResponse('<html><head><title>文档</title></head><body><p>正文内容</p></body></html>'),
  });
  assert.equal(result.ok, true);
  assert.match(result.text, /正文内容/);
  assert.equal(result.title, '文档');
  assert.equal(result.source, 'example.org');
  assert.equal(result.redirects.length, 0);
  assert.equal(result.cost.requests, 1);
});

test('抓取：重定向到内网被拒（逐跳复检，不是信任上游）', async () => {
  resetConfig({ enabled: true, provider: 'none' });
  const result = await tool_web_fetch({ url: 'https://example.org/start' }, {}, {
    lookup: PUBLIC_LOOKUP,
    fetchImpl: async () => htmlResponse('', {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'web_url_private_host');
  assert.equal(result.redirects.length, 1);
});

test('抓取：二进制内容类型被拒（不返回乱码）', async () => {
  resetConfig({ enabled: true, provider: 'none' });
  const result = await tool_web_fetch({ url: 'https://example.org/x.png' }, {}, {
    lookup: PUBLIC_LOOKUP,
    fetchImpl: async () => htmlResponse('binary', { contentType: 'image/png' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'web_content_type_unsupported');
});

test('抓取：超过字节上限即截断并如实标注', async () => {
  resetConfig({ enabled: true, provider: 'none', fetchMaxBytes: 65536 });
  const big = 'x'.repeat(200000);
  const result = await tool_web_fetch({ url: 'https://example.org/big' }, {}, {
    lookup: PUBLIC_LOOKUP,
    fetchImpl: async () => htmlResponse(big, { contentType: 'text/plain' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.equal(result.bodyTruncated, true);
  // 成本口径=读到的字节；进上下文的字节受上限约束
  assert.ok(result.bytes >= 65536);
  assert.ok(result.bytesKept <= 65536);
});

test('抓取：黑名单域名被拒', async () => {
  resetConfig({ enabled: true, provider: 'none', blockedHosts: 'tracker.example' });
  const result = await tool_web_fetch({ url: 'https://tracker.example/pixel' }, {}, {
    lookup: PUBLIC_LOOKUP,
    fetchImpl: async () => htmlResponse('x', { contentType: 'text/plain' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'web_host_blocked');
});

test('配置写侧：未知键被拒（结构化 diagnostics），合法键落盘', () => {
  resetConfig({});
  let error = null;
  try {
    config.saveWebSearchConfig({ nope: 1 });
  } catch (err) {
    error = err;
  }
  assert.ok(error);
  assert.equal(error.message, 'config_value_rejected');
  assert.ok(Array.isArray(error.diagnostics) && error.diagnostics.length > 0);

  const snapshot = config.saveWebSearchConfig({ enabled: true, provider: 'searxng', searxngBaseUrl: 'http://127.0.0.1:8080' });
  assert.equal(snapshot.effective.enabled, true);
  assert.equal(snapshot.capabilities.search, true);
  assert.equal(snapshot.capabilities.fetch, true);
});

test('配置写侧：非法形状被拒（不静默改写）', () => {
  resetConfig({});
  assert.throws(() => config.saveWebSearchConfig({ maxResults: 9999 }));
  assert.throws(() => config.saveWebSearchConfig({ provider: 'bing' }));
  assert.throws(() => config.saveWebSearchConfig({ enabled: 'yes' }));
});

test('配置读侧：选了 SearXNG 却没填地址 → 诊断（不是静默失效）', () => {
  resetConfig({ enabled: true, provider: 'searxng' });
  const snapshot = config.getSnapshot();
  assert.equal(snapshot.capabilities.search, false);
  assert.equal(snapshot.diagnostics.length, 1);
  assert.equal(snapshot.diagnostics[0].code, 'searxng-base-url-missing');
});
