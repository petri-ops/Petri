/**
 * BLOCK-408（第五轮 L4 性能与数据面）契约测试。
 *
 * 红绿先行（HK-01）：L-24 fork 无事务+全量逐条 INSERT——先证「中途失败留半截会话」
 * （红）→ 事务化+INSERT...SELECT+LIMIT 下推（绿）。真 better-sqlite3 内存级隔离库驱动。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const resolve = (rel) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', rel);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USER_ID = 'local-user';
const CONV = 'b408-src-conv';
let baseUrl;
let sqlite;
let dbMod;
let tempDir;

function apiPost(pathname, body) {
  return new Promise((resolvePromise, reject) => {
    const req = http.request(baseUrl + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolvePromise({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolvePromise({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    req.end(JSON.stringify(body || {}));
  });
}

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block408-l4-'));
  const dbPath = path.join(tempDir, 'l4.db');
  process.env.PETRI_DB_PATH = dbPath;
  const { runMigrations } = require(resolve('src/migration-runner.js'));
  runMigrations(dbPath, resolve('src/migrations'));
  dbMod = require(resolve('core/petri-server/db'));
  require(resolve('core/petri-server/helpers/conversations'));
  sqlite = dbMod.getDatabase();
  const now = new Date().toISOString();
  sqlite.prepare('INSERT INTO copilot_conversations(id, user_id, title, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(CONV, USER_ID, 't', 'active', now, now);
  for (let i = 0; i < 12; i += 1) {
    sqlite.prepare('INSERT INTO copilot_messages(id, conversation_id, role, content, meta_json, ts) VALUES (?,?,?,?,?,?)')
      .run(`msg_408_${i}`, CONV, i % 2 === 0 ? 'user' : 'assistant', `消息-${i}`, null, new Date(Date.now() + i).toISOString());
  }
  const express = require('express');
  const mount = require(resolve('core/petri-server/routes/ai-conversations.js'));
  const app = express();
  app.use((req, _res, next) => { req.user = { id: USER_ID }; next(); });
  mount(app);
  await new Promise((resolvePromise) => {
    const server = app.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolvePromise(); });
  });
});

test('L4-1 红转绿：facade 暴露 transaction（better-sqlite3 同步事务透传）', () => {
  assert.equal(typeof dbMod.getAsyncDatabase().transaction, 'function', 'async facade 必须提供 transaction');
});

test('L4-1 红转绿：fork 全量复制走事务（INSERT...SELECT 单语句；12 条消息逐条数对齐）', async () => {
  const r = await apiPost(`/api/ai/conversations/${CONV}/fork`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const forkId = r.body.conversation.id;
  const count = sqlite.prepare('SELECT message_count FROM copilot_conversations WHERE id=?').get(forkId).message_count;
  assert.equal(count, 12);
  const copied = sqlite.prepare('SELECT id FROM copilot_messages WHERE conversation_id=?').all(forkId);
  assert.equal(copied.length, 12);
  assert.ok(copied.every((c) => c.id.startsWith('msg_')), '复制消息 id 契约保持 msg_ 前缀');
});

test('L4-1 红转绿：untilIndex 下推 LIMIT（0-based inclusive 语义逐字保持）', async () => {
  const r = await apiPost(`/api/ai/conversations/${CONV}/fork`, { untilIndex: 4 });
  assert.equal(r.status, 200);
  assert.equal(r.body.conversation.message_count, 5, 'untilIndex=4 → 前 5 条（inclusive）');
  const first = sqlite.prepare('SELECT content FROM copilot_messages WHERE conversation_id=? ORDER BY ts ASC LIMIT 1').get(r.body.conversation.id);
  assert.equal(first.content, '消息-0', '起点保持首条');
  const last = sqlite.prepare('SELECT content FROM copilot_messages WHERE conversation_id=? ORDER BY ts DESC LIMIT 1').get(r.body.conversation.id);
  assert.equal(last.content, '消息-4', 'inclusive 截止=消息-4');
});

test('L4-1 原子性负测：复制中途失败 → 零半截会话（事务回滚）', async () => {
  // 注入：让 UPDATE message_count 语句失败（模拟中途崩溃）——
  // 直接在 sqlite 层劫持一次 prepare。
  const realPrepare = sqlite.prepare.bind(sqlite);
  let injected = false;
  sqlite.prepare = (sql) => {
    if (!injected && sql.includes('UPDATE copilot_conversations SET message_count')) {
      injected = true;
      return { run: () => { throw new Error('injected mid-tx failure'); } };
    }
    return realPrepare(sql);
  };
  try {
    const before = sqlite.prepare("SELECT COUNT(*) AS n FROM copilot_conversations WHERE parent_id=?").get(CONV).n;
    const r = await apiPost(`/api/ai/conversations/${CONV}/fork`, {});
    assert.equal(r.status, 500, '注入失败必须 500');
    const after = sqlite.prepare("SELECT COUNT(*) AS n FROM copilot_conversations WHERE parent_id=?").get(CONV).n;
    assert.equal(after, before, '事务回滚：不得留下半截 fork 会话（红：旧实现留 parent 行+消息）');
  } finally {
    sqlite.prepare = realPrepare;
  }
});

test('L4-1 幂等收尾：注入恢复后 fork 仍可用', async () => {
  const r = await apiPost(`/api/ai/conversations/${CONV}/fork`, {});
  assert.equal(r.status, 200);
});

// ---- L4-5 / L-32：tick 分档桶（纯函数契约） ----
test('L4-5 红转绿语义：tickBucket floor 桶——5s 心跳下 30s 档=每 6 拍触发、60s 档=每 12 拍', async () => {
  const { tickBucket } = await import('../frontend/src/components/workspace-panels/WorkspaceSummaryCard.tsx').catch(() => ({}));
  if (typeof tickBucket !== 'function') {
    // tsx 导入在 node --test 不可用——退化为源码契约断言（同款 floor 公式）
    const src = fs.readFileSync(path.join(ROOT, 'frontend/src/components/workspace-panels/WorkspaceSummaryCard.tsx'), 'utf8');
    assert.match(src, /export function tickBucket\(tick: number, everyTicks: number\): number \{\s*return Math\.floor\(tick \/ Math\.max\(1, everyTicks\)\);/, 'tickBucket 纯函数在场');
    // 慢档依赖桶值（不再原始 tick 直入）
    const bucket6 = (src.match(/tickBucket\(tick, 6\)/g) || []).length;
    const bucket12 = (src.match(/tickBucket\(tick, 12\)/g) || []).length;
    assert.equal(bucket6, 2, `30s 档两处依赖桶 6（实际 ${bucket6}）`);
    assert.equal(bucket12, 1, '60s 档依赖桶 12');
    // 快档（5s）保持原始 tick
    assert.match(src, /\[enabled, projectId, tick\]\); \/\/ BLOCK-161 W4-1：节拍驱动（5s 档每拍）/);
  } else {
    assert.equal(tickBucket(0, 6), 0);
    assert.equal(tickBucket(5, 6), 0, '前 5 拍同桶（不触发）');
    assert.equal(tickBucket(6, 6), 1, '第 6 拍跨桶（触发）');
    assert.equal(tickBucket(11, 6), 1);
    assert.equal(tickBucket(12, 12), 1);
    assert.equal(tickBucket(5, 0), 5, 'everyTicks 防零');
  }
});
