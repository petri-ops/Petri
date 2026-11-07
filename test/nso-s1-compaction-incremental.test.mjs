/**
 * nso-s1-compaction-incremental.test.mjs — BLOCK-376（S1 / G-05 + G-04）增量摘要与压缩失败可见。
 *
 * 缺口（蓝图 G-05/G-04，S0 分片勘察实证）：
 *  - compactConversationNow 每次都把「全部 coveredRows」（全表前缀）作为摘要源——会话翻倍时
 *    摘要输入线性增长、触发次数线性增长（O(n²)）；
 *  - maybeCompactInBackground 的 .catch(() => {}) 吞掉后台压缩失败（静默）；
 *  - chat.js 视图层直读 isSessionCompactionEnabled/isResilienceEnabled 而非 resolveCompactionMode 单源。
 *
 * 契约（本测试钉死）：
 *  1. 首次压缩：语义与既有 B2 契约一致（block95-b2-compaction 继续守护）。
 *  2. 二次压缩（真增量）：摘要输入只含 rowid > covers_rowid 的未覆盖行 + 已有摘要合并提示；
 *     会话翻倍后单次摘要输入长度有界（不随总量线性增长）。
 *  3. covers_rowid 单调推进、原文红线不变、视图投影正确。
 *  4. 后台压缩失败 → 会话当前主任务 task_events 追加 compaction_failed{reason}（seq=last+1）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const resolve = (p) => require('node:path').resolve(require('node:path').dirname(new URL(import.meta.url).pathname), '..', p);

const USER_ID = 'user-s1-compaction';
const CONV = 'conv-s1-compaction';

let sqlite;
let compaction;
let agentTaskStore;
let tempDir;

function seedMsg(role, content) {
  sqlite.prepare('INSERT INTO copilot_messages(id, conversation_id, role, content, meta_json, ts) VALUES (?,?,?,?,?,?)')
    .run(`msg_s1_${Math.random().toString(36).slice(2, 8)}`, CONV, role, content, null, new Date().toISOString());
}

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-s1-compaction-'));
  const dbPath = path.join(tempDir, 's1.db');
  process.env.PETRI_DB_PATH = dbPath;
  delete process.env.PETRI_SESSION_COMPACTION;
  // BLOCK-375 S1：legacy 模式（固定 12K 阈值）——resilience 模式无 preset 窗口时
  // 「窗口未知不猜测」早退，会让后台触发腿失去确定性。
  process.env.PETRI_AGENT_RESILIENCE = '0';
  const { runMigrations } = require(resolve('src/migration-runner.js'));
  runMigrations(dbPath, resolve('src/migrations'));
  const dbMod = require(resolve('core/petri-server/db'));
  require(resolve('core/petri-server/helpers/conversations')); // copilot_conversations 建表（b2 同款）
  sqlite = dbMod.getDatabase();
  compaction = require(resolve('core/petri-server/helpers/conversation-compaction'));
  agentTaskStore = require(resolve('core/petri-server/agent-task-store'));

  await sqlite.prepare('INSERT INTO copilot_conversations(id, user_id, title, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(CONV, USER_ID, 't', 'active', new Date().toISOString(), new Date().toISOString());
  for (let i = 0; i < 30; i += 1) {
    seedMsg(i % 2 === 0 ? 'user' : 'assistant', `首批消息-${i}：${'细节'.repeat(800)}`);
  }
});

test.after(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function withStubbedModel(fn) {
  const modelTasks = require(resolve('core/petri-server/helpers/model-tasks'));
  const original = modelTasks.callModelTask;
  const captured = [];
  modelTasks.callModelTask = async ({ messages }) => {
    captured.push(messages);
    return { text: '- S1 增量摘要要点\n- 关键数字 60 条', model: 'mock' };
  };
  return Promise.resolve(fn(captured)).finally(() => { modelTasks.callModelTask = original; });
}

test('S1-G05 首次压缩=全量语义（与 B2 契约同形：covered=30-KEEP_RECENT）', async () => {
  await withStubbedModel(async (captured) => {
    const r1 = await compaction.compactConversationNow({ userId: USER_ID, conversationId: CONV, sqlite });
    assert.equal(r1.ok, true);
    assert.equal(r1.compaction.covers_count, 30 - compaction.KEEP_RECENT);
    const firstPrompt = JSON.stringify(captured[0]);
    assert.match(firstPrompt, /首批消息-0/, '首压缩输入含最早覆盖行');
    globalThis.__s1FirstPromptLen = firstPrompt.length;
    globalThis.__s1FirstCover = r1.compaction.covers_rowid;
  });
});

test('S1-G05 会话翻倍后二次压缩=真增量：输入只含未覆盖行 + 已有摘要，长度有界', async () => {
  await withStubbedModel(async (captured) => {
    for (let i = 0; i < 30; i += 1) {
      seedMsg(i % 2 === 0 ? 'user' : 'assistant', `次批消息-${i}：${'细节'.repeat(800)}`);
    }
    const r2 = await compaction.compactConversationNow({ userId: USER_ID, conversationId: CONV, sqlite });
    assert.equal(r2.ok, true, `二次压缩应成功：${JSON.stringify(r2)}`);
    assert.ok(r2.compaction.covers_rowid > globalThis.__s1FirstCover, `covers_rowid 单调推进（r2=${r2.compaction && r2.compaction.covers_rowid} first=${globalThis.__s1FirstCover} r2full=${JSON.stringify(r2).slice(0,200)}）`);

    const secondPrompt = JSON.stringify(captured[0]);
    assert.ok(secondPrompt.includes('已有摘要'), '增量提示必须携带已有摘要（合并而非重读全文）');
    assert.match(secondPrompt, /次批消息-0/, '增量输入含新未覆盖行');
    assert.ok(!secondPrompt.includes('首批消息-0'), '增量输入不得再读已覆盖首排行（O(n²) 根因）');
    // 有界断言：全量重读=全部 60 行（首 18 已覆盖 + 次批 30 + 尾窗 12），真增量只读
    // 未覆盖 30 行 → 输入必须显著小于全历史体量（O(n²) 根因=随总量增长）。
    const allRows = sqlite.prepare('SELECT content FROM copilot_messages WHERE conversation_id=?').all(CONV);
    const fullHistoryChars = allRows.reduce((sum, r) => sum + String(r.content || '').length, 0);
    assert.ok(
      secondPrompt.length < fullHistoryChars * 0.75,
      `二次摘要输入（${secondPrompt.length}）必须显著小于全历史体量（${fullHistoryChars}）——会话翻倍但单次输入只随未覆盖增量走`,
    );
  });
});

test('S1-G05 原文红线：压缩不改写 copilot_messages 原文', async () => {
  const rows = sqlite.prepare('SELECT content FROM copilot_messages WHERE conversation_id=? ORDER BY rowid ASC').all(CONV);
  assert.equal(rows.length, 60);
  assert.match(rows[0].content, /首批消息-0/);
  assert.match(rows[59].content, /次批消息-29/);
});

test('S1-G04 后台压缩失败 → 会话主任务 task_events 追加 compaction_failed{reason}', async () => {
  const task = agentTaskStore.createAgentTask({
    status: 'running', agentStatus: 'running', userId: USER_ID,
    params: { conversationId: CONV, kind: 'primary' },
  });
  const taskId = task.taskId || task.id;
  const modelTasks = require(resolve('core/petri-server/helpers/model-tasks'));
  const original = modelTasks.callModelTask;
  modelTasks.callModelTask = async () => { throw new Error('S1 模拟压缩模型故障'); };
  try {
    // 追加足以越过 12K 阈值的未覆盖增量（keepRecent=12 尾窗之外仍需 >12K tokens）
    for (let i = 0; i < 24; i += 1) seedMsg('user', `触发批-${i}：${'细节'.repeat(1500)}`);
    compaction.maybeCompactInBackground({ userId: USER_ID, conversationId: CONV, sqlite });
    // setImmediate 异步消化——轮询等待事件落库（有界等待，不盲等）
    let evt = null;
    for (let i = 0; i < 50 && !evt; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      const events = agentTaskStore.getAgentTaskEventsSince(taskId, 0, 100000);
      evt = events.find((e) => e.eventType === 'compaction_failed') || null;
    }
    assert.ok(evt, 'compaction_failed 事件必须落 task_events（不再静默吞掉）');
    assert.match(String(evt.payload?.reason || evt.payload?.event || ''), /S1 模拟压缩模型故障|compaction_failed/, '事件必须携带失败原因');
  } finally {
    modelTasks.callModelTask = original;
  }
});
