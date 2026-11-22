/**
 * P6-TABLE-LOAD 续推 — pack scheme privileges 契约（U-P6-SANDBOX：A 裁决执行 · HK-01）。
 *
 * 背景：P6 压测 table_load 停 loading——沙箱 iframe 中 petri-pack:// 被 Chromium 判
 * external protocol navigation 静默拒绝（onLoad/onError 双未触发）。裁决 A=scheme
 * privileges 补 supportFetchAPI + corsEnabled（部分 Chromium 版本沙箱 iframe 判 external
 * 需要此二者）。本契约钉死 privileges 形状，防回退。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = () => fs.readFileSync(path.join(ROOT, 'src', 'main', 'pack-ui', 'scheme.js'), 'utf8');

test('U-P6-SANDBOX：pack scheme privileges 含 supportFetchAPI + corsEnabled（裁决 A）', () => {
  const s = src();
  const block = s.match(/privileges:\s*\{([^}]*)\}/);
  assert.ok(block, 'privileges 注册块在场');
  assert.match(block[1], /supportFetchAPI:\s*true/, 'supportFetchAPI 必须 true（沙箱 iframe 判 external 的成因之一）');
  assert.match(block[1], /corsEnabled:\s*true/, 'corsEnabled 必须 true');
  assert.match(block[1], /standard:\s*true/, 'standard 保持 true');
  assert.match(block[1], /secure:\s*true/, 'secure 保持 true');
});

test('U-P6-SANDBOX：privileges 注册仍先于 app ready（registerPackSchemePrivileges 时序契约）', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  const privIdx = main.indexOf('registerPackSchemePrivileges()');
  const readyIdx = main.indexOf('app.whenReady().then(main)');
  assert.ok(privIdx > -1 && readyIdx > -1, '两个调用点都在');
  assert.ok(privIdx < readyIdx, 'registerPackSchemePrivileges 必须在 app.whenReady 之前');
});
