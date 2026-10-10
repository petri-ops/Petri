/**
 * BLOCK-95 B2 — 会话级 rolling compaction 契约（helpers/conversation-compaction.js
 * + ai-conversations 信封/端点）。
 *
 * 真实 SQLite（PETRI_DB_PATH 临时库），覆盖：
 *   - 开关判定（默认关）
 *   - planCompaction 阈值判定（token/消息数不足不折叠；超限按 KEEP_RECENT 切分）
 *   - applyCompactionView 视图投影（covers 内替换为摘要、其余原样、无记录原样）
 *   - compactConversationNow 真实落库（mock callModelTask）+ upsert 推进 covers_rowid
 *   - 红线：压缩前后 copilot_messages 原文逐字节不变
 *   - messages 信封带 compaction 字段；compact 端点开关关时 409
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

const USER_ID = 'u_b95b2';
const CONV = 'conv-b95-b2';
let tempDir, server, baseUrl, sqlite, compaction, dbMod;

function seedMsg(role, content) {
  sqlite.prepare('INSERT INTO copilot_messages(id, conversation_id, role, content, meta_json, ts) VALUES (?,?,?,?,?,?)')
    .run(`msg_b2_${Math.random().toString(36).slice(2, 8)}`, CONV, role, content, null, new Date().toISOString());
}

function apiPost(pathname) {
  return new Promise((resolvePromise, reject) => {
    const req = http.request(baseUrl + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolvePromise({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolvePromise({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    req.end('{}');
  });
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block95-b2-'));
  const dbPath = path.join(tempDir, 'b2.db');
  process.env.PETRI_DB_PATH = dbPath;
  delete process.env.PETRI_SESSION_COMPACTION;
  const { runMigrations } = require(resolve('src/migration-runner.js'));
  runMigrations(dbPath, resolve('src/migrations'));
  dbMod = require(resolve('core/petri-server/db'));
  require(resolve('core/petri-server/helpers/conversations'));
  sqlite = dbMod.getDatabase();
  compaction = require(resolve('core/petri-server/helpers/conversation-compaction'));

  await sqlite.prepare('INSERT INTO copilot_conversations(id, user_id, title, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(CONV, USER_ID, 't', 'active', new Date().toISOString(), new Date().toISOString());
  for (let i = 0; i < 30; i += 1) {
    seedMsg(i % 2 === 0 ? 'user' : 'assistant', `B2消息-${i}：${'细节'.repeat(800)}`); // 每条 ~400 token 级
  }

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
  delete process.env.PETRI_SESSION_COMPACTION;
});

test('开关判定：默认开（2026-09-18 裁决），0 强关', () => {
  const prevDir = process.env.PETRI_LOCAL_DATA_DIR;
  process.env.PETRI_LOCAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b2-flag-'));
  try {
    assert.equal(compaction.isSessionCompactionEnabled({}), true);
    assert.equal(compaction.isSessionCompactionEnabled({ PETRI_SESSION_COMPACTION: '1' }), true);
    assert.equal(compaction.isSessionCompactionEnabled({ PETRI_SESSION_COMPACTION: '0' }), false);
  } finally {
    if (prevDir === undefined) delete process.env.PETRI_LOCAL_DATA_DIR;
    else process.env.PETRI_LOCAL_DATA_DIR = prevDir;
  }
});

test('planCompaction：消息数不足不折叠；超限按 KEEP_RECENT 切分且 token 有值', () => {
  const few = Array.from({ length: 10 }, (_, _i) => ({ role: 'user', content: 'x' }));
  assert.equal(compaction.planCompaction(few).should, false);
  const many = Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: `B2消息-${i}：${'细节'.repeat(800)}` }));
  const plan = compaction.planCompaction(many);
  assert.equal(plan.should, true);
  assert.equal(plan.coveredRows.length, 30 - compaction.KEEP_RECENT);
  assert.equal(plan.keepRows.length, compaction.KEEP_RECENT);
  assert.ok(plan.sourceTokens > 0);
});

test('applyCompactionView：covers 内替换为摘要卡、其余原样；无记录原样透出', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ rowid: i + 1, role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
  const view = compaction.applyCompactionView(rows, { summary: '摘要要点', covers_rowid: 4 });
  assert.equal(view.length, 3);
  assert.match(view[0].content, /会话早期对话摘要/);
  assert.match(view[0].content, /摘要要点/);
  assert.equal(view[1].content, 'm4');
  assert.equal(view[2].content, 'm5');
  assert.ok(!('rowid' in view[1]));
  const passthrough = compaction.applyCompactionView(rows, null);
  assert.equal(passthrough.length, 6);
  assert.equal(passthrough[0].content, 'm0');
});

test('compactConversationNow：真实落库 + upsert 推进 + 原文红线不变', async () => {
  const modelTasks = require(resolve('core/petri-server/helpers/model-tasks'));
  const originalCall = modelTasks.callModelTask;
  let callCount = 0;
  modelTasks.callModelTask = async () => {
    callCount += 1;
    return { text: '- 用户在验证 B2 压缩\n- 关键数字 30 条', model: 'mock' };
  };
  try {
    const beforeRows = sqlite.prepare('SELECT rowid, role, content FROM copilot_messages WHERE conversation_id=? ORDER BY rowid ASC').all(CONV);
    const r1 = await compaction.compactConversationNow({ userId: USER_ID, conversationId: CONV, sqlite });
    assert.equal(r1.ok, true);
    assert.equal(callCount, 1);
    assert.equal(r1.compaction.covers_count, 30 - compaction.KEEP_RECENT);
    const afterRows = sqlite.prepare('SELECT rowid, role, content FROM copilot_messages WHERE conversation_id=? ORDER BY rowid ASC').all(CONV);
    assert.equal(JSON.stringify(afterRows), JSON.stringify(beforeRows)); // 红线：原文逐字节不变

    // 追加新消息后再次压缩 → upsert 推进 covers_rowid
    seedMsg('user', 'B2消息-30（新）');
    const r2 = await compaction.compactConversationNow({ userId: USER_ID, conversationId: CONV, sqlite });
    assert.equal(r2.ok, true);
    assert.ok(r2.compaction.covers_rowid >= r1.compaction.covers_rowid);
    assert.equal(r2.compaction.summary, '- 用户在验证 B2 压缩\n- 关键数字 30 条');
  } finally {
    modelTasks.callModelTask = originalCall;
  }
});

test('compactConversationNow：消息数不足诚实拒绝', async () => {
  const r = await compaction.compactConversationNow({ userId: USER_ID, conversationId: 'conv-b95-b2-empty', sqlite });
  assert.equal(r.ok, false);
});

test('messages 信封带 compaction 字段；compact 端点开关关时 409', async () => {
  const msgs = await new Promise((resolvePromise) => {
    http.get(`${baseUrl}/api/ai/conversations/${CONV}/messages?limit=5`, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolvePromise(JSON.parse(d)));
    });
  });
  assert.equal(msgs.status, 'ok');
  assert.ok(msgs.compaction);
  assert.equal(msgs.compaction.coversCount > 0, true);
  assert.ok(msgs.compaction.summary.length > 0);

  // 开关 env 强制关 → 409（kill-switch 路径；默认已翻开，2026-09-18 裁决）
  const prev = process.env.PETRI_SESSION_COMPACTION;
  process.env.PETRI_SESSION_COMPACTION = '0';
  const compact = await apiPost(`/api/ai/conversations/${CONV}/compact`);
  assert.equal(compact.status, 409);
  // 开关默认开（删 env 走默认）→ 端点可用，不再 409
  if (prev === undefined) delete process.env.PETRI_SESSION_COMPACTION;
  else process.env.PETRI_SESSION_COMPACTION = prev;
  const compactOn = await apiPost(`/api/ai/conversations/${CONV}/compact`);
  assert.notEqual(compactOn.status, 409);
});
