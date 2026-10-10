'use strict';

/**
 * BLOCK-133（mojibake 加映二收口）— R deparse `<U+XXXX>` 解码契约。
 *
 * 背景：jsonlite 在非 UTF-8 locale 下把不可本地表示的码点输出为 `<U+6C14>`
 * 形态字面量（纯 ASCII 无歧义）；pack 侧脚本已保证不再产生高位剥离乱码，
 * 本模块在读取侧统一解码——两条 manifest 读点（tools-executor /
 * run-plugin-script）均接线。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { decodeRDeparseManifest, decodeRDeparseString } = require('../core/shared-backend/r-deparse-decode.js');

test('decodes R deparse escapes in string leaves at any depth', () => {
  const decoded = decodeRDeparseManifest({
    files: [
      { name: 'go_bp_dotplot.png', type: 'plot', label: 'GO-BP <U+6C14><U+6CE1><U+56FE> (PNG)' },
      { name: 't.csv', label: 'GO-MF <U+7ED3><U+679C><U+8868>' },
    ],
    summary: { title: '<U+5206><U+6790><U+6458><U+8981>', nested: { deep: ['<U+57FA><U+56E0>'] } },
    count: 3,
    keep: true,
  });
  assert.equal(decoded.files[0].label, 'GO-BP 气泡图 (PNG)');
  assert.equal(decoded.files[1].label, 'GO-MF 结果表');
  assert.equal(decoded.summary.title, '分析摘要');
  assert.equal(decoded.summary.nested.deep[0], '基因');
  assert.equal(decoded.count, 3);
  assert.equal(decoded.keep, true);
});

test('real Chinese and ASCII pass through untouched; malformed escapes kept as-is', () => {
  assert.equal(decodeRDeparseString('GO-BP 气泡图 (PNG)'), 'GO-BP 气泡图 (PNG)');
  assert.equal(decodeRDeparseString('plain ascii'), 'plain ascii');
  assert.equal(decodeRDeparseString('<U+ZZZZ>'), '<U+ZZZZ>');
  assert.equal(decodeRDeparseString('edge <U+110000> out'), 'edge <U+110000> out');
  assert.equal(decodeRDepareseSafe('x'), 'x');
});
function decodeRDepareseSafe(x) { return decodeRDeparseString(x); }

test('both manifest read points are wired to the decoder', () => {
  const executor = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/tools-executor.js'), 'utf8');
  const mcp = fs.readFileSync(path.join(ROOT, 'core/petri-server/mcp/registry/run-plugin-script.js'), 'utf8');
  assert.ok(executor.includes('decodeRDeparseManifest(JSON.parse'), 'tools-executor manifest read decodes');
  assert.ok(mcp.includes('decodeRDeparseManifest(JSON.parse'), 'run-plugin-script manifest read decodes');
});
