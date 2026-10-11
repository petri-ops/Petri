/**
 * BLOCK-166 P1 主进程面单测：external-link（openExternal 白名单）+
 * vendor（sha256 逐文件强校验/缺失明确失败）+ shell P1 集成（主题/桥/错误横幅）。
 * plan §5-P1 门禁：vendor 映射与缺失失败测试 + openExternal 拒绝分支测试。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isAllowedExternalHref } from '../src/main/gen-ui/external-link.js';
import { loadVendorManifest, readVendorFile, verifyVendorHash } from '../src/main/gen-ui/vendor.js';
import { assembleGenUiShell } from '../src/main/gen-ui/shell.js';
import { buildGenUiThemeCss } from '../src/main/gen-ui/theme.js';

test('isAllowedExternalHref：绝对 http(s) 放行', () => {
  assert.equal(isAllowedExternalHref('https://example.com/a?b=1#frag'), true);
  assert.equal(isAllowedExternalHref('http://example.com'), true);
  assert.equal(isAllowedExternalHref('https://深度.域名/路径'), true);
});

test('isAllowedExternalHref：非 http(s) scheme 全拒', () => {
  assert.equal(isAllowedExternalHref('javascript:alert(1)'), false);
  assert.equal(isAllowedExternalHref('data:text/html,<script>'), false);
  assert.equal(isAllowedExternalHref('file:///C:/Windows/win.ini'), false);
  assert.equal(isAllowedExternalHref('ftp://example.com/x'), false);
  assert.equal(isAllowedExternalHref('ws://example.com'), false);
  assert.equal(isAllowedExternalHref('vbscript:x'), false);
});

test('isAllowedExternalHref：相对路径/空白/非字符串拒绝', () => {
  assert.equal(isAllowedExternalHref('/relative/path'), false);
  assert.equal(isAllowedExternalHref('//example.com/protocol-relative'), false);
  assert.equal(isAllowedExternalHref('  '), false);
  assert.equal(isAllowedExternalHref(''), false);
  assert.equal(isAllowedExternalHref(null), false);
  assert.equal(isAllowedExternalHref(undefined), false);
  assert.equal(isAllowedExternalHref(42), false);
});

test('isAllowedExternalHref：内嵌凭证拒绝（防钓鱼外带）', () => {
  assert.equal(isAllowedExternalHref('https://user:pass@example.com/'), false);
  assert.equal(isAllowedExternalHref('https://x@example.com/'), false);
});

test('isAllowedExternalHref：URL 解析放行时不改写 href（原样交 shell）', () => {
  const href = 'https://example.com/a b?q=中文';
  assert.equal(isAllowedExternalHref(href), true);
});

test('vendor：随包文件与 manifest sha256 逐文件一致（完整性门）', () => {
  const manifest = loadVendorManifest();
  assert.ok(manifest.byUrl.size >= 4, 'manifest 至少含 d3/lucide/floating-ui 四件');
  const vendorDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'gen-ui', 'vendor');
  for (const [file, resource] of manifest.byFile) {
    const bytes = fs.readFileSync(path.join(vendorDir, file));
    assert.doesNotThrow(() => verifyVendorHash(resource, bytes), `${file} sha256 mismatch`);
  }
});

test('vendor：verifyVendorHash 对篡改字节抛 vendor-hash-mismatch', () => {
  const manifest = loadVendorManifest();
  const resource = manifest.byFile.values().next().value;
  assert.throws(
    () => verifyVendorHash(resource, Buffer.from('tampered bytes')),
    (err) => err.code === 'vendor-hash-mismatch',
  );
});

test('vendor：readVendorFile 对清单外文件名明确拒绝不回退', () => {
  assert.throws(
    () => readVendorFile('evil-remote.js'),
    (err) => err.code === 'vendor-not-in-manifest',
  );
});

test('theme：petri token 映射产出标准变量 + light-dark 双值 + viz 序列', () => {
  const css = buildGenUiThemeCss();
  for (const name of [
    '--background', '--foreground', '--card', '--primary', '--primary-foreground',
    '--border', '--input', '--ring', '--destructive', '--muted-foreground',
    '--viz-series-1', '--viz-series-6', '--font-size-base',
  ]) {
    assert.ok(css.includes(`${name}:`), `missing ${name}`);
  }
  assert.ok(css.includes('light-dark('), 'light/dark pairs via light-dark()');
  assert.ok(css.includes('color-scheme'), 'color-scheme declared');
  // 禁零定义：不得引用未定义的 petri token（值层为字面量映射）。
  assert.ok(!css.includes('var(--petri-'), 'guest css must not reference host-only petri tokens');
});

test('shell P1：主题 CSS 在 visualize 工具类之后注入（值层覆盖契约层）', () => {
  const html = assembleGenUiShell({
    fragmentHtml: '<div>hi</div>',
    sandboxOrigin: 'petri-genui://gen-t',
    hostOrigin: 'http://localhost:3000',
  });
  const vizIdx = html.indexOf('.viz-grid');
  const themeIdx = html.indexOf('--background:light-dark(');
  assert.ok(vizIdx >= 0, 'visualize utilities injected');
  assert.ok(themeIdx > vizIdx, 'petri theme values must override visualize defaults');
});

test('shell P1：guest 桥脚本在 initial-state 之后、fragment 之前，携带 hostOrigin 配置', () => {
  const html = assembleGenUiShell({
    fragmentHtml: '<div id="root">hi</div>',
    sandboxOrigin: 'petri-genui://gen-t',
    hostOrigin: 'http://localhost:3000',
  });
  const stateIdx = html.indexOf('petri-gen-ui-initial-state');
  const bridgeIdx = html.indexOf('petri-gen-ui-rpc');
  const fragIdx = html.indexOf('<div id="root">');
  assert.ok(stateIdx >= 0 && bridgeIdx > stateIdx && fragIdx > bridgeIdx, 'bridge order fixed');
  assert.ok(html.includes('http://localhost:3000'), 'hostOrigin injected into bridge config');
});

test('shell P1：脚本资源加载失败监听（vendor 缺失明确失败不白屏）在场', () => {
  const html = assembleGenUiShell({
    fragmentHtml: '<div>hi</div>',
    sandboxOrigin: 'petri-genui://gen-t',
  });
  assert.ok(html.includes('petri-gen-ui-fatal'), 'fatal error banner id present');
});

test('shell P1：hostOrigin 缺省时不注入空串（guest 退化为 source-only 校验）', () => {
  const html = assembleGenUiShell({
    fragmentHtml: '<div>hi</div>',
    sandboxOrigin: 'petri-genui://gen-t',
  });
  const bridgeIdx = html.indexOf('petri-gen-ui-rpc');
  const after = html.slice(bridgeIdx, bridgeIdx + 400);
  assert.ok(!after.includes('""'), 'no empty-string hostOrigin in bridge config');
});
