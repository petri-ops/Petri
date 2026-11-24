/**
 * BLOCK-511 S3.4 HK-01 — Express 4 async 路由抛错返回 JSON 5xx（不再悬挂）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { asyncHandler, installErrorMiddleware } = require(path.resolve('.', 'core/petri-server/helpers/async-handler.js'));

test('asyncHandler 把 async rejection 转交 next(err)', async () => {
  const boom = new Error('db exploded');
  let nextErr = null;
  const wrapped = asyncHandler(async () => { throw boom; });
  await wrapped({}, {}, (e) => { nextErr = e; });
  // catch 经 Promise 微任务链转交，等一个 tick
  await new Promise((r) => setImmediate(r));
  assert.equal(nextErr, boom);
});

test('asyncHandler 同步抛错也转交 next(err)', () => {
  const boom = new Error('sync boom');
  let nextErr = null;
  const wrapped = asyncHandler(() => { throw boom; });
  wrapped({}, {}, (e) => { nextErr = e; });
  assert.equal(nextErr, boom);
});

test('installErrorMiddleware 返回既有错误形状的 JSON 5xx', () => {
  const mws = [];
  installErrorMiddleware({ use: (fn) => mws.push(fn) });
  assert.equal(mws.length, 1);
  const res = { headersSent: false, statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  mws[0](new Error('kaboom'), {}, res, () => {});
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.status, 'error');
  assert.equal(res.body.error, 'internal_error');
  assert.match(res.body.message, /kaboom/);
});

test('headersSent 时不重复写响应', () => {
  const mws = [];
  installErrorMiddleware({ use: (fn) => mws.push(fn) });
  let wrote = false;
  const res = { headersSent: true, status() { wrote = true; return this; }, json() { wrote = true; return this; } };
  mws[0](new Error('late'), {}, res, () => {});
  assert.equal(wrote, false);
});
