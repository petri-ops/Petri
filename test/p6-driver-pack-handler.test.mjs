/**
 * P6 harness 补 pack handler（2026-11-22）— HK-01 契约（纯源码，不跑 Electron）。
 *
 * 卡点：压测 driver 是隔离 Electron 观察器，未注册 petri-pack:// 协议处理器，
 * B1 解除 sandbox 拦截后 iframe 仍无 handler 响应 → table_load 永挂。本票让 driver
 * 复用产品主进程 scheme.js（registerPackSchemePrivileges + setupPackProtocol），
 * 仅补 harness 协议服务能力，不改产品 sandbox/CSP/凭据/B1 token。
 *
 * 本文件只测源码契约：模块加载、ready 前注册、ready 后 setup、复用产品单源。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRIVER = path.join(ROOT, 'scripts', 'g0-rs-p6-electron-pressure-driver.cjs');
const SCHEME = path.join(ROOT, 'src', 'main', 'pack-ui', 'scheme.js');
const src = () => fs.readFileSync(DRIVER, 'utf8');

test('driver 复用产品主进程 scheme.js 单源（不自造第二份 handler）', () => {
  const s = src();
  assert.match(
    s,
    /require\(['"][^'"]*pack-ui[\\/]scheme['"]\)/,
    'driver 须 require 产品 scheme.js（petri-pack 协议 handler 单源）',
  );
  assert.match(s, /registerPackSchemePrivileges/, 'driver 须引用 registerPackSchemePrivileges');
  assert.match(s, /setupPackProtocol/, 'driver 须引用 setupPackProtocol');
});

test('registerPackSchemePrivileges 在 app ready 前调用', () => {
  const s = src();
  const regCall = s.search(/registerPackSchemePrivileges\s*\(\s*\)/);
  const ready = s.search(/app\.whenReady\s*\(/);
  assert.ok(regCall >= 0, '须调用 registerPackSchemePrivileges()');
  assert.ok(ready >= 0, '须存在 app.whenReady()');
  assert.ok(
    regCall < ready,
    'registerPackSchemePrivileges() 必须在 app.whenReady() 之前（Electron 硬约束）',
  );
});

test('setupPackProtocol 在 run() 内 app ready 后调用', () => {
  const s = src();
  // run() 由 app.whenReady().then(run) 触发 → run 内即 ready 后；
  // 判据=调用点落在 run() 函数体内（run 定义之后、下一个顶层函数之前）。
  const runDef = s.search(/async function run\s*\(/);
  const setupCall = s.search(/setupPackProtocol\s*\(\s*\)/);
  assert.ok(runDef >= 0, '须存在 async function run()');
  assert.ok(setupCall >= 0, '须调用 setupPackProtocol()');
  assert.ok(
    setupCall > runDef,
    'setupPackProtocol() 须在 run() 内（app ready 后）调用：ready 前 protocol.handle 不可用',
  );
  assert.match(s, /app\.whenReady\(\)[\s\S]*\.then\(run\)/, 'run() 须由 app.whenReady().then(run) 触发');
});

test('产品 scheme.js 保持 handler 单源（红线：不改产品 handler/CSP/凭据/privileges）', () => {
  const scheme = fs.readFileSync(SCHEME, 'utf8');
  assert.match(scheme, /protocol\.handle\(SCHEME/, '产品 handler 仍在');
  assert.match(scheme, /Content-Security-Policy/, '产品 CSP 仍在');
  assert.match(scheme, /supportFetchAPI:\s*true/, '产品 scheme privileges（裁决 A）仍在');
  assert.match(scheme, /module\.exports[\s\S]*setupPackProtocol/, '产品 handler 导出仍在');
});
