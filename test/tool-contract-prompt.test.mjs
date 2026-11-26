/**
 * conv 分析裁决②（owner msg_1d935cbef8a7）：system prompt 工具契约硬约束三条铁律。
 * HK-01：principles 静态段含 a) read→sha b) 长链分步验产物 c) 配置错误不重试。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/system-prompt.js'), 'utf8');

const at = src.indexOf('const principles = [');
const section = src.slice(at, src.indexOf('].join(\'\');', at));

test('HK-01-1：铁律 a — workspace_write/replace 前必须先 workspace_read 取 expectedSha256（长链不例外）', () => {
  assert.match(section, /workspace_read/);
  assert.match(section, /expectedSha256/);
  assert.match(section, /长链|多轮|不得跳过|例外/);
});

test('HK-01-2：铁律 b — 长任务分步执行、每步检查中间产物', () => {
  assert.match(section, /分步/);
  assert.match(section, /中间产物|产物有效性|再继续/);
});

test('HK-01-3：铁律 c — 配置类错误（web_access_disabled）不重试，先告知用户', () => {
  assert.match(section, /配置类/);
  assert.match(section, /不要重试|不重试/);
  assert.match(section, /告知用户/);
});

test('HK-01-4：三条铁律在 principles 静态缓存段（零每次调用 token 成本）', () => {
  assert.ok(section.indexOf('铁律') > -1, '铁律段应在 principles 内');
  assert.match(src, /STATIC_CACHE\.templates = \{ baseRole, principles, homePageHint \}/);
});
