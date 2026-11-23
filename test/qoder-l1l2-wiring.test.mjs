/**
 * QODER-L1/L2 输出接线 — HK-01 契约（2026-11-23）。
 *
 * 用户发令「继续」（Jev 建议 L1L2-WIRING 0.67）：把 P1 web-result-projection.js 接入
 * web-tools.js 的 search/fetch 输出——additive 加 summary/authority，不改出网链/正文/审计。
 * 红线：不碰 SSRF 硬边界/唯一出网口/凭据/配置键/product sandbox/CSP/handler/pack。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('L1/L2 接线：web-tools.js 消费 P1 投影器', () => {
  const s = read('core/petri-server/agent-tools/web-tools.js');
  assert.match(s, /web-result-projection|projectSearchResults/, 'search 须消费 P1 投影');
  assert.match(s, /projectFetchMetadata/, 'fetch 须消费 P1 投影');
});

test('接线 additive：保留原 snippet/source/text，不替换字段', () => {
  const s = read('core/petri-server/agent-tools/web-tools.js');
  const searchIdx = s.indexOf('tool_web_search');
  const fetchIdx = s.indexOf('tool_web_fetch');
  const searchBody = s.slice(searchIdx, fetchIdx);
  const fetchBody = s.slice(fetchIdx, fetchIdx + 2200);
  // 搜索侧：合并形态（...row / ...item）保留原字段，而非整体替换 results
  assert.match(searchBody, /\.\.\.(row|item|entry)/, 'search 投影须 spread 保留原字段');
  // fetch 侧：text 必须从 extracted/text 原样构造，不被投影改
  assert.match(fetchBody, /text,/, 'fetch 须保留原 text 字段');
});

test('红线：出网硬边界与配置族未改', () => {
  const policy = read('core/petri-server/helpers/web-fetch-policy.js');
  const schema = read('core/packages/shared-config/config-schema.js');
  const provider = read('core/petri-server/helpers/web-search-provider.js');
  assert.match(policy, /guardedFetch/, '唯一出网口仍在');
  assert.match(schema, /web-search/, '配置族仍在');
  assert.match(provider, /SEARCH_PROVIDERS/, 'provider 归一仍在');
});
