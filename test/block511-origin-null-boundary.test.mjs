/**
 * BLOCK-511 S3.1a HK-01 — 全局 Origin 门对非 http(s) Origin（含 null）的变更请求收口。
 *
 * 五例：①无 token 403 ②正确 token 放行 ③GET 不受影响 ④无 Origin 不变 ⑤可信 Origin 不变；
 * 另：未配置 token 时非 http(s) Origin 变更请求直接 403；其它 http(s) 来源维持 403。
 * BLOCK-67 拖出下载语义（Origin:null + 路由级 token）由路由自己裁决，本测试只测全局门。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { rejectUntrustedOrigin } = await import(pathToFileURL(path.join(root, 'core/petri-server/bootstrap.js')).href);

const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];
const mkRes = () => ({ statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } });
const mkReq = (method, origin, token) => {
  const headers = {};
  if (origin !== undefined) headers.origin = origin;
  if (token !== undefined) headers['x-petri-local-request-token'] = token;
  return { method, headers };
};
const run = (req) => {
  const res = mkRes();
  let nexted = false;
  rejectUntrustedOrigin(req, res, () => { nexted = true; });
  return { res, nexted };
};

test('①非 http(s) Origin（null/file://）变更请求无 token → 403 local_request_token_required', () => {
  process.env.PETRI_LOCAL_REQUEST_TOKEN = 'tok-511';
  for (const origin of ['null', 'file://', 'custom-scheme://x']) {
    for (const method of MUTATING) {
      const { res, nexted } = run(mkReq(method, origin));
      assert.equal(res.statusCode, 403, `${origin} ${method} 应 403`);
      assert.match(res.body?.error, /local_request_token_required/);
      assert.equal(nexted, false);
    }
  }
});

test('②正确 token → 放行', () => {
  process.env.PETRI_LOCAL_REQUEST_TOKEN = 'tok-511';
  for (const method of MUTATING) {
    const { res, nexted } = run(mkReq(method, 'null', 'tok-511'));
    assert.equal(nexted, true, `${method} 正确 token 应放行`);
    assert.equal(res.statusCode, 0);
  }
});

test('③GET 不受影响：null Origin 无 token 仍放行', () => {
  process.env.PETRI_LOCAL_REQUEST_TOKEN = 'tok-511';
  const { nexted } = run(mkReq('GET', 'null'));
  assert.equal(nexted, true);
});

test('④无 Origin 的本地调用不变（token 语义保持，由路由级门裁决）', () => {
  process.env.PETRI_LOCAL_REQUEST_TOKEN = 'tok-511';
  const { nexted } = run(mkReq('POST', undefined));
  assert.equal(nexted, true);
});

test('⑤可信桌面 Origin 不变（无需 token）', () => {
  process.env.PETRI_LOCAL_REQUEST_TOKEN = 'tok-511';
  process.env.PETRI_TRUSTED_DESKTOP_ORIGINS = 'http://localhost:3000';
  const { nexted } = run(mkReq('POST', 'http://localhost:3000'));
  assert.equal(nexted, true);
  delete process.env.PETRI_TRUSTED_DESKTOP_ORIGINS;
});

test('未配置 token 时非 http(s) Origin 变更请求直接 403（fail-closed）', () => {
  delete process.env.PETRI_LOCAL_REQUEST_TOKEN;
  const { res, nexted } = run(mkReq('POST', 'null'));
  assert.equal(res.statusCode, 403);
  assert.match(res.body?.error, /local_request_token_required/);
  assert.equal(nexted, false);
});

test('其它 http(s) 来源维持现状（untrusted_origin 403）', () => {
  process.env.PETRI_LOCAL_REQUEST_TOKEN = 'tok-511';
  const { res } = run(mkReq('POST', 'https://evil.example'));
  assert.equal(res.statusCode, 403);
  assert.match(res.body?.error, /untrusted_origin/);
});
