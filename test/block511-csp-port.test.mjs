/**
 * BLOCK-511 S4.1 HK-01 — CSP 按实际后端端口与渲染 Origin 生成；打包态恒用生产 CSP。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildCspHeader } = require(path.resolve('.', 'src/main/csp-config.js'));

test('后端在非 3001 端口：connect-src/frame-src 含实际端口且不含写死的 3001 后端入口', () => {
  // 仅 dev 端口放行本机 3000/3001；改成实际 4123 后不应再含 :3001 的 connect 目标。
  const csp = buildCspHeader(true, { backendPort: 4123, rendererOrigin: 'http://localhost:3000' });
  assert.match(csp, /http:\/\/localhost:4123/);
  assert.match(csp, /ws:\/\/localhost:4123/);
  assert.doesNotMatch(csp, /http:\/\/localhost:3001/);
  assert.match(csp, /http:\/\/localhost:3000/);
});

test('渲染 Origin 非 3000：按传入 Origin 生成（不再写死 3000）', () => {
  const csp = buildCspHeader(true, { backendPort: 3001, rendererOrigin: 'http://127.0.0.1:3100' });
  assert.match(csp, /http:\/\/127\.0\.0\.1:3100/);
});

test('打包态即使 NODE_ENV=development（isDevMode=true）仍用生产 CSP：无 unsafe-inline script-src', () => {
  const csp = buildCspHeader(true, { backendPort: 3001, isPackaged: true });
  assert.match(csp, /script-src 'self';/);
  assert.doesNotMatch(csp, /script-src 'self' 'unsafe-inline'/);
});

test('未打包 dev 态：unsafe-inline script-src 保留（vite react-refresh）', () => {
  const csp = buildCspHeader(true, { backendPort: 3001, isPackaged: false });
  assert.match(csp, /script-src 'self' 'unsafe-inline'/);
});
