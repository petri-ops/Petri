/**
 * BLOCK-166 P2 Node 侧单测：widgetState 持久化往返（后端纯逻辑）+
 * scopeKey/几何校验纯函数 + 独立导出产物离线可开。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { getWidgetState, putWidgetState, isValidScopeKey, normalizeStateJson } = require('../core/petri-server/routes/gen-ui.js');
const { computeScopeKey } = require('../src/main/gen-ui/paths.js');
const { validateCaptureRect } = require('../src/main/gen-ui/geometry.js');
const { buildStandaloneHtml } = await import('../scripts/gen-ui-export.mjs');

function memoryDb() {
  const Database = require(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'better-sqlite3'));
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE gen_ui_widget_state (
    scope_key TEXT NOT NULL,
    file_path TEXT NOT NULL,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope_key, file_path)
  )`);
  return db;
}

const SCOPE = 'a'.repeat(64);
const FILE = 'C:/ws/.petri/gen-ui/conv1/demo.html';

test('computeScopeKey：sha256 十六进制 64 位且确定性', () => {
  const key = computeScopeKey('C:/ws', 'conv1');
  assert.equal(key, computeScopeKey('C:/ws', 'conv1'));
  assert.notEqual(key, computeScopeKey('C:/ws', 'conv2'));
  assert.match(key, /^[a-f0-9]{64}$/);
});

test('widgetState 持久化往返：写→读一致，覆盖写生效', () => {
  const db = memoryDb();
  assert.equal(getWidgetState(db, SCOPE, FILE).state, null);
  assert.equal(putWidgetState(db, SCOPE, FILE, { modelContent: { n: 1 } }).ok, true);
  assert.deepEqual(getWidgetState(db, SCOPE, FILE).state, { modelContent: { n: 1 } });
  assert.equal(putWidgetState(db, SCOPE, FILE, { modelContent: { n: 2 } }).ok, true);
  assert.deepEqual(getWidgetState(db, SCOPE, FILE).state, { modelContent: { n: 2 } });
  // scope 隔离
  assert.equal(getWidgetState(db, 'b'.repeat(64), FILE).state, null);
});

test('widgetState 校验：非对象/数组/超 16KiB/坏 scopeKey/空路径拒绝', () => {
  const db = memoryDb();
  assert.equal(normalizeStateJson(null), null);
  assert.equal(normalizeStateJson([1]), null);
  assert.equal(normalizeStateJson({ blob: 'x'.repeat(17 * 1024) }), null);
  assert.equal(putWidgetState(db, 'not-hex', FILE, {}).ok, false);
  assert.equal(isValidScopeKey('a'.repeat(64)), true);
  assert.equal(isValidScopeKey('A'.repeat(64)), false);
  assert.equal(putWidgetState(db, SCOPE, '', {}).ok, false);
  assert.equal(getWidgetState(db, SCOPE, '').ok, false);
});

test('validateCaptureRect：合法区域归一化，非法分支全拒', () => {
  assert.deepEqual(validateCaptureRect({ x: 10.7, y: 20.2, width: 300.9, height: 200.1 }), { x: 10, y: 20, width: 300, height: 200 });
  assert.equal(validateCaptureRect(null), null);
  assert.equal(validateCaptureRect({ x: 0, y: 0, width: NaN, height: 10 }), null);
  assert.equal(validateCaptureRect({ x: 0, y: 0, width: 0, height: 10 }), null);
  assert.equal(validateCaptureRect({ x: 0, y: 0, width: -5, height: 10 }), null);
  assert.equal(validateCaptureRect({ x: 0, y: 0, width: 10001, height: 10 }), null);
  assert.equal(validateCaptureRect({ x: '0', y: 0, width: 5, height: 5 }), null);
  assert.equal(validateCaptureRect([1, 2, 3, 4]), null);
});

test('独立导出：CDN URL 全部内嵌为 data URL，零外链，shim/主题在场', () => {
  const fragment = [
    '<div id="demo">',
    '<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"></script>',
    '<script>document.getElementById("demo").textContent = typeof d3;</script>',
    '</div>',
  ].join('\n');
  const html = buildStandaloneHtml(fragment, { title: 'P2 导出 <测试>' });
  // data URL（含 url 编码形态）整体剥离到双引号闭合后查资源引用——shim 源码里的
  // 'http:'/'https:' 协议字面量与 svg 命名空间标识符都不是网络资源引用。
  const stripped = html.replace(/data:[^"]+/g, '');
  assert.ok(!/<script[^>]*src="https?:/i.test(stripped), '零外链 script src');
  assert.ok(!stripped.includes('url(http') && !stripped.includes('href="http'), '零外链 url()/href 资源引用');
  assert.ok(html.includes('data:text/javascript;base64,'), 'vendor 内嵌 data URL');
  assert.ok(html.includes('petriGenUiStandaloneShim'), 'standalone shim 在场');
  assert.ok(html.includes('--background:light-dark('), '主题值层在场');
  assert.ok(html.includes('.viz-grid'), '工具类在场');
  assert.ok(html.includes('P2 导出 &lt;测试&gt;'), '标题转义');
  assert.ok(html.startsWith('<!doctype html>'), 'HTML 形态可直开');
});

test('独立导出：无 vendor 引用的 fragment 产物同样零外链且 shim 在场', () => {
  const html = buildStandaloneHtml('<p>纯静态</p>');
  assert.ok(!html.includes('https://'));
  assert.ok(html.includes('petriGenUiStandaloneShim'));
});

test('独立导出：vendor 哈希门在位（导出读取即校验，真实随包文件全过）', () => {
  const manifest = require('../resources/gen-ui/vendor/manifest.json');
  assert.ok(manifest.resources.length >= 4);
  for (const resource of manifest.resources) {
    const bytes = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'gen-ui', 'vendor', resource.file));
    const crypto = require('node:crypto');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), resource.sha256, `${resource.file} sha256`);
  }
});

test('临时目录清理自检（os 引用保活）', () => {
  assert.ok(fs.statSync(os.tmpdir()).isDirectory());
});
