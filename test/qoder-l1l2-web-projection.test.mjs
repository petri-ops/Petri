/**
 * QODER-L1/L2 联网搜索/抓取行为合同 — P1 纯函数 HK-01（2026-11-23）。
 *
 * 用户发令一次性推完；L1/L2 只借行为合同（summary/来源/权威度），不接 Qoder 端点。
 * D2 权威度口径=只透传上游已有字段、无则诚实 null（不自造评分=不造第二真相）。
 * 红线：不改出网调用链（guardedFetch/searchWeb）、不新增配置键、不碰凭据。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = path.join(ROOT, 'core', 'shared-backend', 'web-result-projection.js');
const load = () => require(MODULE);

test('L1/L2 模块存在且零新依赖', () => {
  assert.ok(fs.existsSync(MODULE), '须有 web-result-projection.js');
  assert.doesNotMatch(fs.readFileSync(MODULE, 'utf8'), /require\(['"](?!\.\.?\/|node:)/);
});

test('L1 projectSearchResults：summary 有界 + authority 透传/诚实 null', () => {
  const { projectSearchResults } = load();
  const out = projectSearchResults({
    results: [
      { title: 'A', url: 'https://a.example/x', snippet: '片段A', source: 'a.example', authority: 'high' },
      { title: 'B', url: 'https://b.example/y', snippet: '片段B', source: 'b.example' },
    ],
  });
  assert.equal(out.results.length, 2);
  assert.equal(out.results[0].authority, 'high', '上游有 authority 须透传');
  assert.equal(out.results[1].authority, null, '上游无 authority 须诚实 null，不自造');
  assert.equal(out.results[0].summary, '片段A');
  assert.ok(out.results.every((r) => r.summary.length <= 400), 'summary 须有界');
});

test('L2 projectFetchMetadata：只补 source/authority 元数据，不改正文', () => {
  const { projectFetchMetadata } = load();
  const out = projectFetchMetadata({
    ok: true, url: 'https://a.example/p', source: 'a.example', text: '正文内容', chars: 4,
  });
  assert.equal(out.ok, true);
  assert.equal(out.source, 'a.example');
  assert.equal(out.authority, null, 'web_fetch 无上游权威度→null');
  assert.equal(out.text, '正文内容', '不得改正文');
});

test('恶意/缺失输入不伪造结果', () => {
  const { projectSearchResults, projectFetchMetadata } = load();
  assert.equal(projectSearchResults({}).results.length, 0);
  assert.equal(projectFetchMetadata({}).ok, false);
  const out = projectSearchResults({ results: [{ title: 'X', url: 'not-a-url', snippet: 's' }] });
  assert.equal(out.results.length, 0, '非法 URL 不产出结果');
});

test('红线：出网硬边界与配置白名单未改', () => {
  const policy = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/web-fetch-policy.js'), 'utf8');
  const schema = fs.readFileSync(path.join(ROOT, 'core/packages/shared-config/config-schema.js'), 'utf8');
  assert.match(policy, /guardedFetch|唯一允许/, '唯一出网口仍在');
  assert.match(schema, /web-search/, '配置族仍在（本包不新增键）');
});
