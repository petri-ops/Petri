/**
 * BLOCK-166 P0 主进程面单测：paths（scope 根/包含校验/id 形状）+
 * csp（禁网/白名单/全禁项）+ shell（拼装顺序/初始状态转义/vendor 重写/1MB 常量）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { computeScopeRoot, isValidConversationId, assertInsideScope } from '../src/main/gen-ui/paths.js';
import { buildGenUiCsp, STATIC_DOMAINS } from '../src/main/gen-ui/csp.js';
import { assembleGenUiShell, HTML_MAX_BYTES } from '../src/main/gen-ui/shell.js';
import { loadVendorManifest } from '../src/main/gen-ui/vendor.js';

test('conversationId 形状：合法 id 通过，穿越/超长/空拒绝', () => {
  assert.equal(isValidConversationId('conv_abc-123'), true);
  assert.equal(isValidConversationId(''), false);
  assert.equal(isValidConversationId('../escape'), false);
  assert.equal(isValidConversationId('a'.repeat(65)), false);
});

test('computeScopeRoot：落在 workspace 的 .petri/gen-ui/<id> 下', () => {
  const root = computeScopeRoot(path.join(os.tmpdir(), 'ws'), 'conv1');
  assert.equal(root, path.join(path.join(os.tmpdir(), 'ws'), '.petri', 'gen-ui', 'conv1'));
});

test('computeScopeRoot：非绝对 workspace / 非法 id 抛错', () => {
  assert.throws(() => computeScopeRoot('relative/ws', 'conv1'), /absolute/);
  assert.throws(() => computeScopeRoot(path.join(os.tmpdir(), 'ws'), 'bad/id'), /conversation/);
});

test('assertInsideScope：scope 内文件通过，scope 外/不存在分别拒绝', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'genui-'));
  fs.mkdirSync(path.join(dir, '.petri', 'gen-ui', 'conv1'), { recursive: true });
  const scope = fs.realpathSync(path.join(dir, '.petri', 'gen-ui', 'conv1'));
  const inside = path.join(scope, 'chart-a.html');
  fs.writeFileSync(inside, '<div>x</div>');
  assert.equal(assertInsideScope(scope, inside), fs.realpathSync(inside));
  assert.throws(
    () => assertInsideScope(scope, path.join(dir, 'outside.html')),
    (err) => /outside-scope|file-not-found/.test(err.code || err.message),
  );
  assert.throws(
    () => assertInsideScope(scope, path.join(scope, 'missing.html')),
    (err) => err.code === 'file-not-found',
  );
});

test('CSP：default-src none、connect 仅 blob/data、frame/form 全禁、白名单域在场', () => {
  const csp = buildGenUiCsp();
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src blob: data:/);
  assert.match(csp, /frame-src 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /script-src 'self' 'unsafe-inline'/, "'self' 放行自源 vendor 路径");
  for (const domain of STATIC_DOMAINS) assert.ok(csp.includes(domain), `missing ${domain}`);
  assert.ok(!csp.includes('*'), 'no wildcard');
});

test('shell：加载顺序 initial-state → bootstrap → fragment，初始状态转义 <', () => {
  const html = assembleGenUiShell({
    fragmentHtml: '<div id="root">hi</div>',
    sandboxOrigin: 'petri-genui://gen-test',
    initialState: { a: '<b>' },
  });
  const stateIdx = html.indexOf('petri-gen-ui-initial-state');
  const bootIdx = html.indexOf('petri-gen-ui-height');
  const fragIdx = html.indexOf('<div id="root">');
  assert.ok(stateIdx >= 0 && bootIdx > stateIdx && fragIdx > bootIdx, 'load order fixed');
  assert.ok(html.includes('\\u003cb\\u003e'), 'initial state escaped');
});

test('shell：vendor CDN URL 重写为沙箱路径', () => {
  const manifest = loadVendorManifest();
  const anyUrl = manifest.byUrl.keys().next().value;
  const html = assembleGenUiShell({
    fragmentHtml: `<script src="${anyUrl}"></script>`,
    sandboxOrigin: 'petri-genui://gen-x',
  });
  assert.ok(!html.includes(anyUrl), 'cdn url replaced');
  assert.ok(html.includes('petri-genui://gen-x/vendor/'), 'rewritten to sandbox vendor path');
});

test('1MB 上限常量在位（plan §6-11 硬校验）', () => {
  assert.equal(HTML_MAX_BYTES, 1_048_576);
});
