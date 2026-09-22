/**
 * BLOCK-110 P1 — Jev noul 直替契约（`_maybeDetectTopicShift` 三区间 + 降级 + 杀开关）。
 *
 * 契约红线（plan §3 P1）：返回形状 `{shifted, reason}|null` 不变，调用方零改动；
 *   noul ≥0.85 → 切换；≤0.50 → 未切换（直替，不走大模型）；中间带 → 回退大模型路径；
 *   Jev 降级/杀开关 → 回退大模型路径（决策 API 不做单点故障）。
 */
import assert from 'node:assert/strict';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

// 内存 DB 自举（conversations.js 顶层建表）
{
  const Database = require('better-sqlite3');
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'biof3-b110-p1-'));
  const db = new Database(path.join(tempDbDir, 'biof3.db'));
  const migrationsDir = path.join(root, 'src', 'migrations');
  for (const file of fssync.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fssync.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.BIOF3_DB_PATH = path.join(tempDbDir, 'biof3.db');
  process.on('exit', () => {
    try { fssync.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* 句柄延迟释放 */ }
  });
}

const DECISION_PATH = require.resolve(path.join(root, 'core', 'biof3-server', 'helpers', 'decision-api.js'));
const MODEL_TASKS_PATH = require.resolve(path.join(root, 'core', 'biof3-server', 'helpers', 'model-tasks.js'));

// mock 注入（在 require conversations 之前装 require.cache）
const mocks = {
  askDecisionCalls: [],
  askDecisionImpl: null, // (state) => ({ ok, answers? , ... })
  callModelTaskCalls: [],
  callModelTaskImpl: null,
};
function installMocks() {
  const dec = require(DECISION_PATH);
  require.cache[DECISION_PATH] = {
    id: DECISION_PATH, filename: DECISION_PATH, loaded: true,
    exports: { ...dec, askDecision: async (p) => {
      mocks.askDecisionCalls.push(p.state);
      if (mocks.askDecisionImpl) return mocks.askDecisionImpl(p);
      return { ok: false, reason: 'no_key' };
    } },
  };
  const mt = require(MODEL_TASKS_PATH);
  require.cache[MODEL_TASKS_PATH] = {
    id: MODEL_TASKS_PATH, filename: MODEL_TASKS_PATH, loaded: true,
    exports: { ...mt, callModelTask: async (opts) => {
      mocks.callModelTaskCalls.push(opts);
      if (mocks.callModelTaskImpl) return mocks.callModelTaskImpl(opts);
      return { text: '{"shifted":true,"reason":"大模型判定"}' };
    } },
  };
}
installMocks();

const conv = require(path.join(root, 'core', 'biof3-server', 'helpers', 'conversations.js'));

const USER = 'u-p1';
function seedConversation(messageCount = 10) {
  const db = require('better-sqlite3')(process.env.BIOF3_DB_PATH);
  const convId = 'conv-p1-' + Math.random().toString(36).slice(2, 8);
  db.prepare(`INSERT INTO copilot_conversations (id, user_id, title, status, message_count, created_at, updated_at)
    VALUES (?, ?, 'P1 测试', 'active', ?, ?, ?)`)
    .run(convId, USER, messageCount, new Date().toISOString(), new Date().toISOString());
  const ins = db.prepare('INSERT INTO copilot_messages (id, conversation_id, role, content, ts) VALUES (?, ?, ?, ?, ?)');
  for (let i = 0; i < messageCount; i++) {
    ins.run('m-' + convId + '-' + i, convId, i % 2 ? 'assistant' : 'user', '历史消息 ' + i, new Date(Date.now() - 600000 + i * 1000).toISOString());
  }
  db.close();
  return convId;
}

function resetMocks(impl) {
  mocks.askDecisionCalls.length = 0;
  mocks.callModelTaskCalls.length = 0;
  mocks.askDecisionImpl = impl || null;
  delete process.env.BIOF3_JEV_TOPIC_SHIFT;
}

const noulAnswer = (v) => ({ ok: true, answers: { topic_shift: { type: 'noul', noul: v } } });

test('P1 — Jev noul ≥0.85：直替成立（shifted+reason，不调大模型）', async () => {
  resetMocks();
  const convId = seedConversation(10);
  mocks.askDecisionImpl = async () => noulAnswer(0.93);
  const r = await conv._maybeDetectTopicShift(convId, USER);
  assert.ok(r && r.shifted === true, 'shifted=true');
  assert.match(r.reason, /Jev 判定话题切换/);
  assert.equal(mocks.callModelTaskCalls.length, 0, '大模型路径未被调用（直替成立）');
  const db = require('better-sqlite3')(process.env.BIOF3_DB_PATH);
  const row = db.prepare('SELECT last_topic_shift_reason FROM copilot_conversations WHERE id=?').get(convId);
  db.close();
  assert.match(row.last_topic_shift_reason, /Jev 判定话题切换/);
});

test('P1 — Jev noul ≤0.50：明确未切换（直替 null，不调大模型）', async () => {
  resetMocks();
  const convId = seedConversation(10);
  mocks.askDecisionImpl = async () => noulAnswer(0.12);
  const r = await conv._maybeDetectTopicShift(convId, USER);
  assert.equal(r, null);
  assert.equal(mocks.askDecisionCalls.length, 1, 'Jev 调用一次');
  assert.equal(mocks.callModelTaskCalls.length, 0, '大模型未被调用（Jev 明确否）');
});

test('P1 — Jev 中间带（0.5<noul<0.85）：回退大模型路径', async () => {
  resetMocks();
  const convId = seedConversation(10);
  mocks.askDecisionImpl = async () => noulAnswer(0.7);
  mocks.callModelTaskImpl = () => ({ text: '{"shifted":true,"reason":"大模型判定切换"}' });
  const r = await conv._maybeDetectTopicShift(convId, USER);
  assert.ok(r && r.shifted === true, '中间带回退大模型并采信其判定');
  assert.equal(mocks.callModelTaskCalls.length, 1, '大模型路径被调用一次');
});

test('P1 — Jev 降级（askDecision !ok）→ 回退大模型路径', async () => {
  resetMocks();
  const convId = seedConversation(10);
  mocks.askDecisionImpl = async () => ({ ok: false, reason: 'timeout' });
  const r = await conv._maybeDetectTopicShift(convId, USER);
  assert.ok(r === null || (r && r.shifted === true), '降级后由大模型路径决定');
  assert.equal(mocks.callModelTaskCalls.length, 1, '降级后走大模型路径');
});

test('P1 — 杀开关 BIOF3_JEV_TOPIC_SHIFT=0：Jev 零调用，直走大模型', async () => {
  resetMocks();
  process.env.BIOF3_JEV_TOPIC_SHIFT = '0';
  const convId = seedConversation(10);
  await conv._maybeDetectTopicShift(convId, USER);
  assert.equal(mocks.askDecisionCalls.length, 0, '杀开关下 Jev 零调用');
  assert.equal(mocks.callModelTaskCalls.length, 1, '直接走大模型路径');
  delete process.env.BIOF3_JEV_TOPIC_SHIFT;
});

test('P1 — 门禁保留：消息数不足（<10）时零调用直接 null', async () => {
  resetMocks();
  const convId = seedConversation(4);
  // 门禁检查要求 message_count ≥10 且 %5==0 —— 4 条不满足
  const r = await conv._maybeDetectTopicShift(convId, USER);
  assert.equal(r, null);
  assert.equal(mocks.askDecisionCalls.length, 0, '门禁拦截，Jev 未调用');
  assert.equal(mocks.callModelTaskCalls.length, 0, '大模型亦未调用');
});
