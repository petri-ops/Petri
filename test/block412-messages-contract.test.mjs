/**
 * BLOCK-412（补腿批第一刀：L-31 messages 读契约）契约测试。
 *
 * 红绿先行：
 *   红① COUNT 走 rowid 无索引（EXPLAIN QUERY PLAN 无 idx_msg_conv_ts_id 命中）
 *   红② export 全量 .all() 进内存（分块行数无上界）
 * 绿：行为逐字对齐（windowOffset 序列 / 导出内容等价）。
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const resolve = (rel) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', rel);

const USER_ID = 'local-user';
const CONV = 'b412-conv';
let baseUrl;
let sqlite;

function apiGet(pathname) {
  return new Promise((resolvePromise, reject) => {
    http.get(baseUrl + pathname, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolvePromise({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolvePromise({ status: res.statusCode, body: d }); } });
    }).on('error', reject);
  });
}

test.before(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block412-'));
  const dbPath = path.join(tempDir, 'l31.db');
  process.env.PETRI_DB_PATH = dbPath;
  const { runMigrations } = require(resolve('src/migration-runner.js'));
  runMigrations(dbPath, resolve('src/migrations'));
  const dbMod = require(resolve('core/petri-server/db'));
  require(resolve('core/petri-server/helpers/conversations'));
  sqlite = dbMod.getDatabase();
  const now = new Date().toISOString();
  sqlite.prepare('INSERT INTO copilot_conversations(id, user_id, title, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(CONV, USER_ID, 't', 'active', now, now);
  const ins = sqlite.prepare('INSERT INTO copilot_messages(id, conversation_id, role, content, meta_json, ts) VALUES (?,?,?,?,?,?)');
  const tx = sqlite.transaction(() => {
    for (let i = 0; i < 400; i += 1) {
      ins.run(`msg_412_${i}`, CONV, i % 2 ? 'assistant' : 'user', `消息-${i}`, null, new Date(Date.now() + i).toISOString());
    }
  });
  tx();
  const express = require('express');
  const mount = require(resolve('core/petri-server/routes/ai-conversations.js'));
  const app = express();
  app.use((req, _res, next) => { req.user = { id: USER_ID }; next(); });
  mount(app);
  await new Promise((res) => {
    const server = app.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; res(); });
  });
});

test('L-31 红→绿：分页行为基线逐字对齐（K2 同族——windowOffset/hasMore/nextBefore 序列）', async () => {
  // 20 页滚动：每页 20 条，断言 windowOffset 严格递增且值与「rowid 序绝对偏移」一致
  const offsets = [];
  let before = '';
  for (let p = 0; p < 20; p += 1) {
    const r = await apiGet(`/api/ai/conversations/${CONV}/messages?limit=20${before ? `&before=${before}` : ''}`);
    assert.equal(r.status, 200);
    offsets.push(r.body.windowOffset);
    if (p === 0) assert.equal(r.body.windowOffset, 380, '首页窗口偏移=380（400 条取最新 20）');
    if (!r.body.hasMore) break;
    before = r.body.nextBefore;
  }
  assert.equal(offsets.length, 20, '20 页滚动');
  for (let i = 1; i < offsets.length; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- offsets 为本测试自建数组（夹具），无外部输入
    assert.equal(offsets[i], offsets[i - 1] - 20, `偏移严格 -20 步进（页 ${i}）`);
  }
});

test('L-31 红→绿：独立 COUNT 退役（窗口列在页查询内算偏移——COUNT(*) 调用数 1→0，蓝图验收口径）', () => {
  const routeSrc = fs.readFileSync(resolve('core/petri-server/routes/ai-conversations.js'), 'utf8');
  assert.doesNotMatch(routeSrc, /COUNT\(\*\) AS c FROM copilot_messages WHERE conversation_id=\?\s*AND rowid < \?/, 'rowid 版独立 COUNT 已退役');
  assert.match(routeSrc, /COUNT\(\*\) OVER \(PARTITION BY conversation_id ORDER BY rowid/, '窗口列在档（rowid 语义保持=fork 同 ts 安全）');
  const plan = sqlite.prepare("EXPLAIN QUERY PLAN SELECT id, rowid AS _rid, COUNT(*) OVER (PARTITION BY conversation_id ORDER BY rowid ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS _offset1 FROM copilot_messages WHERE conversation_id=? ORDER BY rowid DESC LIMIT ?").all(CONV, 20);
  const detail = plan.map((p) => p.detail).join(' | ');
  assert.doesNotMatch(detail, /SCAN copilot_messages(?!.*INDEX)/, '不得全表扫描：' + detail);
});


test('L-31 红→绿：export 走分块组装（无全量 .all 无界装载）', () => {
  const src = fs.readFileSync(resolve('core/petri-server/routes/ai-conversations.js'), 'utf8');
  const exportBlock = src.slice(src.indexOf('export.md'));
  assert.doesNotMatch(exportBlock, /\.all\(req\.params\.id\)\s*;[\s\S]*?composeConversationMarkdown\(\{[\s\S]*?messages:\s*rows/, '全量 .all 装载已退役');
  assert.match(exportBlock, /chunk|CHUNK/i, '分块组装在档');
  // 行为等价：真实端点导出内容含全部消息
});

test('L-31 行为等价：导出 Markdown 含首尾消息与 400 条行', async () => {
  const r = await apiGet(`/api/ai/conversations/${CONV}/export.md`);
  assert.equal(r.status, 200);
  const md = typeof r.body === 'string' ? r.body : '';
  assert.match(md, /消息-0/, '首条在场');
  assert.match(md, /消息-399/, '末条在场');
  const rows = (md.match(/消息-\d+/g) || []).length;
  assert.ok(rows >= 400, `导出行覆盖 ${rows} 条`);
});
