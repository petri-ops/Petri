/**
 * QODER-L5 插件宿主契约层 — P1 纯函数 HK-01（2026-11-23）。
 *
 * 用户发令一次性推完；L5 只做契约层（manifest schema + host API 白名单，默认拒绝），
 * 不接 Electron utility-process、不改 scheme/CSP/sandbox（运行态必碰红线→不做）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = path.join(ROOT, 'core', 'shared-backend', 'utility-host-contract.js');
const load = () => require(MODULE);

test('L5 契约模块存在且零新依赖', () => {
  assert.ok(fs.existsSync(MODULE), '须有 utility-host-contract.js');
  assert.doesNotMatch(fs.readFileSync(MODULE, 'utf8'), /require\(['"](?!\.\.?\/|node:)/);
});

test('默认拒绝：无 host 声明即不装载，不启动进程', () => {
  const { evaluateHostManifest } = load();
  const out = evaluateHostManifest({ id: 'p1' });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'no_host_declaration');
  assert.equal(out.loadable, false);
});

test('合法声明须含入口/权限/消息白名单，且入口路径安全', () => {
  const { evaluateHostManifest } = load();
  const ok = evaluateHostManifest({
    id: 'p1',
    host: {
      type: 'utility-process',
      entry: 'host/worker.js',
      permissions: ['workspace.read'],
      messages: { inbound: ['ping'], outbound: ['pong'] },
    },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.loadable, true);
  const escape = evaluateHostManifest({ id: 'p1', host: { type: 'utility-process', entry: '../../etc/passwd', permissions: [], messages: {} } });
  assert.equal(escape.ok, false, '路径穿越须拒绝');
});

test('未知权限/消息类型 fail-closed，不隐式放行', () => {
  const { evaluateHostManifest } = load();
  const out = evaluateHostManifest({
    id: 'p1',
    host: { type: 'utility-process', entry: 'host/w.js', permissions: ['fs.write.everything'], messages: { inbound: ['*'] } },
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('permission')), '未知权限须诊断');
});

test('红线：不改 pack handler/CSP/scheme', () => {
  const scheme = fs.readFileSync(path.join(ROOT, 'src/main/pack-ui/scheme.js'), 'utf8');
  const csp = fs.readFileSync(path.join(ROOT, 'src/main/pack-ui/csp.js'), 'utf8');
  assert.match(scheme, /protocol\.handle\(SCHEME/);
  assert.match(csp, /default-src/);
});
