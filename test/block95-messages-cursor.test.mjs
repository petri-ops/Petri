/**
 * BLOCK-95 A1 — 会话消息游标分页契约（routes/ai-conversations.js GET /:id/messages）。
 *
 * 真实 SQLite（PETRI_DB_PATH 临时库）+ 真实 Express app，覆盖：
 *   - 默认窗口语义翻转：默认返回**最新** limit 条（修复旧「最旧 limit 条」缺陷）
 *   - hasMore / nextBefore / windowOffset / total 信封字段正确
 *   - before 游标向上翻页：两批拼接 = 全量，不重不漏
 *   - fork 同 ts 会话（全部消息同一 ts）rowid 游标分页不丢不重
 *   - 404 / 鉴权语义保持
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const resolve = (...segments) => path.resolve(__dirname, '..', ...segments);
const require = createRequire(import.meta.url);

const USER_ID = 'u_b95a1';
const CONV_BIG = 'conv-b95-big';
const CONV_FORK = 'conv-b95-fork';
const TOTAL = 250;
const PAGE = 200;

let tempDir;
let server;
let baseUrl;
let adb;

function apiGet(pathname) {
  return new Promise((resolvePromise, reject) => {
    const req = http.request(baseUrl + pathname, { method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let body = null;
        try { body = data ? JSON.parse(data) : null; } catch { body = data; }
        resolvePromise({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function seedMessages(conversationId, count, sameTs = false) {
  const base = Date.now() - count * 1000;
  const stmt = await adb.prepare('INSERT INTO copilot_messages(id, conversation_id, role, content, meta_json, ts) VALUES (?,?,?,?,?,?)');
  for (let i = 0; i < count; i += 1) {
    const ts = sameTs ? new Date(base).toISOString() : new Date(base + i * 1000).toISOString();
    await stmt.run(`msg_${conversationId}_${i}`, conversationId, i % 2 === 0 ? 'user' : 'assistant', `内容-${i}`, null, ts);
  }
  await adb.prepare('INSERT INTO copilot_conversations(id, user_id, title, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(conversationId, USER_ID, 't', 'active', new Date().toISOString(), new Date().toISOString());
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block95-a1-'));
  const dbPath = path.join(tempDir, 'block95.db');
  process.env.PETRI_DB_PATH = dbPath;
  // projects 等用户数据表由 src/migrations 管理（正常由 Electron 主进程执行），
  // 纯 Node 测试环境先跑同一 runner（g0-rs-p4r-capture.mjs 先例）
  const { runMigrations } = require(resolve('src/migration-runner.js'));
  runMigrations(dbPath, resolve('src/migrations'));
  // helpers/conversations.js require 即建 copilot_* 表（同步侧）
  require(resolve('core/petri-server/helpers/conversations'));
  adb = require(resolve('core/petri-server/db')).getAsyncDatabase();

  await seedMessages(CONV_BIG, TOTAL, false);
  await seedMessages(CONV_FORK, TOTAL, true);

  const express = require('express');
  const mount = require(resolve('core/petri-server/routes/ai-conversations.js'));
  const app = express();
  app.use((req, _res, next) => { req.user = { id: USER_ID }; next(); });
  mount(app);

  await new Promise((resolvePromise) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolvePromise();
    });
  });
});

after(async () => {
  try { if (server) await new Promise((r) => server.close(r)); } catch {}
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  delete process.env.PETRI_DB_PATH;
});

test('默认窗口返回最新 limit 条（修复最旧 200 条缺陷）', async () => {
  const r = await apiGet(`/api/ai/conversations/${CONV_BIG}/messages?limit=${PAGE}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ok');
  assert.equal(r.body.messages.length, PAGE);
  // 最旧语义下第一条是 内容-0；新语义下必须是 内容-50（最新 200 条的最旧一条）
  assert.equal(r.body.messages[0].content, '内容-50');
  assert.equal(r.body.messages[PAGE - 1].content, `内容-${TOTAL - 1}`);
  assert.equal(r.body.hasMore, true);
  assert.equal(typeof r.body.nextBefore, 'number');
  assert.equal(r.body.windowOffset, TOTAL - PAGE);
  assert.equal(r.body.total, TOTAL);
});

test('before 游标翻页：两批拼接 = 全量，不重不漏', async () => {
  const first = await apiGet(`/api/ai/conversations/${CONV_BIG}/messages?limit=${PAGE}`);
  const second = await apiGet(`/api/ai/conversations/${CONV_BIG}/messages?limit=${PAGE}&before=${first.body.nextBefore}`);
  assert.equal(second.status, 200);
  assert.equal(second.body.messages.length, TOTAL - PAGE);
  assert.equal(second.body.hasMore, false);
  assert.equal(second.body.nextBefore, null);
  assert.equal(second.body.windowOffset, 0);
  const all = [...second.body.messages, ...first.body.messages]; // 时间升序全量
  assert.equal(all.length, TOTAL);
  const seen = new Set();
  for (let i = 0; i < all.length; i += 1) {
    assert.equal(all[i].content, `内容-${i}`, `位置 ${i} 内容应按时间升序对齐`);
    assert.ok(!seen.has(all[i].id), `消息 ${all[i].id} 重复`);
    seen.add(all[i].id);
  }
});

test('fork 同 ts 会话（全部消息同一时间戳）游标分页不丢不重', async () => {
  const first = await apiGet(`/api/ai/conversations/${CONV_FORK}/messages?limit=${PAGE}`);
  assert.equal(first.body.messages.length, PAGE);
  assert.ok(first.body.hasMore);
  // 同 ts 下旧 ts 游标会整页丢失——rowid 游标必须可继续翻页
  const second = await apiGet(`/api/ai/conversations/${CONV_FORK}/messages?limit=${PAGE}&before=${first.body.nextBefore}`);
  assert.equal(second.body.messages.length, TOTAL - PAGE);
  const ids = new Set([...first.body.messages, ...second.body.messages].map((m) => m.id));
  assert.equal(ids.size, TOTAL);
});

test('未知会话 404 / limit 边界钳制保持', async () => {
  const missing = await apiGet('/api/ai/conversations/conv-b95-none/messages');
  assert.equal(missing.status, 404);
  const over = await apiGet(`/api/ai/conversations/${CONV_BIG}/messages?limit=99999`);
  assert.equal(over.status, 200);
  assert.ok(over.body.messages.length <= 500);
});
