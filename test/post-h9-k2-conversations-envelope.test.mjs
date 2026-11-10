/**
 * K2 / K-01 判据重立的真实 HTTP 行为断言（红绿先行的行为腿）。
 *
 * 复用 block95-messages-cursor.test.mjs 的既有骨架（临时 DB + migrations +
 * helpers/conversations + express mount + 注入 req.user），不改生产契约。
 *
 * 断言：>100 条会话时列表仍返回 100 条（默认上限不变），但信封给出
 * hasMore=true 与 nextCursor；≤100 条时 hasMore=false、nextCursor=null。
 * 这是「服务端 LIMIT 100 截断被明确告知」的重立判据，不是 DOM 假前提。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'test', 'probe.cjs'));
const resolve = (rel) => path.join(ROOT, rel);
const USER_ID = 'k2-envelope-user';

let tempDir;
let server;
let baseUrl;
let adb;

const apiGet = async (urlPath) => {
  const r = await fetch(`${baseUrl}${urlPath}`);
  return { status: r.status, body: await r.json() };
};

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-h9-k2-'));
  const dbPath = path.join(tempDir, 'k2.db');
  process.env.PETRI_DB_PATH = dbPath;
  const { runMigrations } = require(resolve('src/migration-runner.js'));
  runMigrations(dbPath, resolve('src/migrations'));
  require(resolve('core/petri-server/helpers/conversations'));
  adb = require(resolve('core/petri-server/db')).getAsyncDatabase();
  const express = require('express');
  const app = express();
  app.use((req, _res, next) => { req.user = { id: USER_ID }; next(); });
  require(resolve('core/petri-server/routes/ai-conversations.js'))(app);
  await new Promise((done) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });
});

after(async () => {
  try { if (server) await new Promise((r) => server.close(r)); } catch {}
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  delete process.env.PETRI_DB_PATH;
});

test('≤100 条会话：hasMore=false、nextCursor=null、数组形状不变', async () => {
  const now = new Date().toISOString();
  for (let i = 0; i < 3; i += 1) {
    await adb.prepare('INSERT INTO copilot_conversations(id, user_id, title, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
      .run(`small-${i}`, USER_ID, `small ${i}`, 'active', now, now);
  }
  const r = await apiGet('/api/ai/conversations');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ok');
  assert.ok(Array.isArray(r.body.conversations));
  assert.equal(r.body.conversations.length, 3);
  assert.equal(r.body.hasMore, false);
  assert.equal(r.body.nextCursor, null);
});

test('>100 条会话：默认仍 100 条，hasMore=true 且 nextCursor 是本页最后一条的 updated_at', async () => {
  const base = Date.now();
  for (let i = 0; i < 103; i += 1) {
    const ts = new Date(base + i * 1000).toISOString();
    await adb.prepare('INSERT INTO copilot_conversations(id, user_id, title, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
      .run(`bulk-${i}`, USER_ID, `bulk ${i}`, 'active', ts, ts);
  }
  const r = await apiGet('/api/ai/conversations');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.conversations));
  assert.equal(r.body.conversations.length, 100, '默认 100 上限不变（向后兼容）');
  assert.equal(r.body.hasMore, true, '截断必须被明确告知');
  assert.equal(typeof r.body.nextCursor, 'string');
  assert.equal(r.body.nextCursor, r.body.conversations[99].updated_at);
  // 顺序仍按 updated_at DESC，且多查的第 101 条不进入数组
  assert.match(r.body.conversations[0].id, /^bulk-/);
  assert.ok(r.body.conversations.every((c) => c.user_id === undefined || c.user_id === USER_ID));
});

test('负测：越权用户看不到他人会话（信封改动不改变隔离）', async () => {
  const now = new Date().toISOString();
  await adb.prepare('INSERT INTO copilot_conversations(id, user_id, title, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run('other-user-conv', 'someone-else', 'private', 'active', now, now);
  const r = await apiGet('/api/ai/conversations');
  assert.ok(!r.body.conversations.some((c) => c.id === 'other-user-conv'));
});
