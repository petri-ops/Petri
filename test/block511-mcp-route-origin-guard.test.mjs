/**
 * BLOCK-511 S3.1b HK-01 — MCP 客户端 10 条变更路由挂 requireTrustedDesktopOrigin。
 * 用 mock app 捕获注册链，断言每条变更路由的第一道守卫是 requireTrustedDesktopOrigin，
 * 并直接调用守卫验证 Origin:null 变更请求 403（无 token），可信桌面 Origin 放行。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { requireTrustedDesktopOrigin } = await import(pathToFileURL(path.join(root, 'core/shared-backend/local-request-boundary.js')).href);
const { registerMcpClientRoutes } = await import(pathToFileURL(path.join(root, 'core/petri-server/routes/mcp-client.js')).href);

const routes = [];
const app = {
  get: (p, ...handlers) => routes.push({ method: 'GET', path: p, handlers }),
  post: (p, ...handlers) => routes.push({ method: 'POST', path: p, handlers }),
  put: (p, ...handlers) => routes.push({ method: 'PUT', path: p, handlers }),
  patch: (p, ...handlers) => routes.push({ method: 'PATCH', path: p, handlers }),
  delete: (p, ...handlers) => routes.push({ method: 'DELETE', path: p, handlers }),
};
registerMcpClientRoutes(app);

const mutating = routes.filter((r) => r.method !== 'GET');
test('10 条 MCP 变更路由全部挂 requireTrustedDesktopOrigin', () => {
  assert.equal(mutating.length, 10, `CHANGE 路由数应为 10，实际 ${mutating.length}`);
  for (const r of mutating) {
    assert.ok(r.handlers.includes(requireTrustedDesktopOrigin), `${r.method} ${r.path} 缺 requireTrustedDesktopOrigin`);
  }
});

test('MCP 变更路由 Origin:null 无 token → 403；可信 Origin → 放行', () => {
  process.env.PETRI_TRUSTED_DESKTOP_ORIGINS = 'http://localhost:3000';
  const mkRes = () => ({ statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
  for (const r of mutating) {
    const bad = mkRes();
    let nexted = false;
    requireTrustedDesktopOrigin({ method: r.method, headers: { origin: 'null' } }, bad, () => { nexted = true; });
    assert.equal(bad.statusCode, 403, `${r.method} ${r.path} Origin:null 应 403`);
    assert.equal(nexted, false);
    const good = mkRes();
    requireTrustedDesktopOrigin({ method: r.method, headers: { origin: 'http://localhost:3000' } }, good, () => { nexted = true; });
    assert.equal(nexted, true, `${r.method} ${r.path} 可信 Origin 应放行`);
  }
  delete process.env.PETRI_TRUSTED_DESKTOP_ORIGINS;
});
