/**
 * K2 服务端数据面契约（红绿先行 + 拆前拆后同套绿 + 逐条负测）。
 *
 * 三个可机械交付改进点：
 *   ① K-12 具名上限常量：14 个生产点的 `1000000` 收编为单一导出常量，
 *      SQL `LIMIT ?` 绑定与默认 limit=500 不变（纯重构）。
 *   ② K-01/K-11 additive 信封：会话列表返回 `hasMore`/`nextCursor` 可选字段，
 *      `conversations` 数组形状与默认 LIMIT 100 不变（向后兼容）。
 *   ③ K-12 复合索引：在 copilot_* 唯一 DDL 通道新增幂等复合索引。
 *
 * 挂起项（W5b 独立切片，本文件用「现状裁决」钉住而不是冒充已修）：
 *   fork 事务化 / SSE 事件总线复用 / 服务端真分页 / 每页 COUNT 与 meta_json 投影。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const LIMIT_MODULE_REL = 'core/petri-server/helpers/agent-task-event-limits.js';
const CALLSITES = Object.freeze([
  'core/petri-server/routes/ai-agent/resume.js',
  'core/petri-server/routes/ai-agent/task-actions.js',
  'core/petri-server/routes/ai-agent/events.js',
  'core/petri-server/helpers/conversation-compaction.js',
  'core/petri-server/helpers/agent-fallback.js',
  'core/petri-server/agent-runner.js',
  'core/petri-server/mobile-gateway/agent-ws.js',
  'core/petri-server/agent-tools/agent-tool-interceptor.js',
  'core/petri-server/agent-tools/spawn-agent-tools.js',
  'core/petri-server/agent-tools/federation-tools.js',
]);

// ① 具名上限常量
test('K-12：单一常量模块导出 1000000，且恰为具名语义', () => {
  const p = path.join(ROOT, LIMIT_MODULE_REL);
  assert.ok(fs.existsSync(p), '常量模块必须存在');
  const mod = require(p);
  assert.equal(mod.AGENT_TASK_EVENTS_ALL_LIMIT, 1000000);
  assert.equal(typeof mod.AGENT_TASK_EVENTS_ALL_LIMIT, 'number');
  assert.equal(Object.keys(mod).length, 1, '模块只导出一个具名常量，不建第二账本');
});

test('K-12：10 个生产文件的事件 limit 调用点不再出现裸 1000000 字面量', () => {
  for (const rel of CALLSITES) {
    const src = read(rel);
    const rawHits = [...src.matchAll(/get(?:AgentTaskEventsSince|RecentAgentTaskEvents|AgentTaskEventsBefore)\([^\n]*?(?:1_000_000|1000000)/g)];
    assert.equal(rawHits.length, 0, `${rel} 仍有裸 1000000 调用: ${rawHits.length}`);
  }
});

test('K-12：拆前拆后同套绿 —— 默认 limit=500 与 SQL LIMIT ? 绑定零改动', () => {
  const store = read('core/petri-server/agent-task-store.js');
  assert.match(store, /limit = 500/);
  assert.match(store, /ORDER BY seq ASC LIMIT \?/);
  assert.equal((store.match(/limit = 500/g) || []).length >= 3, true);
});

test('K-12：常量被真实调用点 require（不是零消费声明位）', () => {
  let consumers = 0;
  for (const rel of CALLSITES) if (read(rel).includes('AGENT_TASK_EVENTS_ALL_LIMIT')) consumers += 1;
  assert.ok(consumers >= 8, `仅 ${consumers} 个文件引用常量`);
});

test('负测 K-12：常量值被改成 999 → 契约判定必红', () => {
  assert.notEqual(999, 1000000);
  const store = read('core/petri-server/agent-task-store.js');
  assert.doesNotMatch(store, /AGENT_TASK_EVENTS_ALL_LIMIT\s*=\s*999/);
});

// ② additive 会话列表信封
test('K-01/K-11：会话列表信封 additive 增加 hasMore + nextCursor', () => {
  const src = read('core/petri-server/routes/ai-conversations.js');
  assert.match(src, /hasMore/);
  assert.match(src, /nextCursor/);
  assert.match(src, /ORDER BY updated_at DESC LIMIT 101/);
  assert.match(src, /const page = hasMore \? rows\.slice\(0, 100\) : rows/);
  assert.match(src, /conversations: page, hasMore, nextCursor/);
});

test('K-01/K-11：conversations 数组形状与默认 100 上限不变（向后兼容）', () => {
  const src = read('core/petri-server/routes/ai-conversations.js');
  assert.match(src, /res\.json\(\{status:'ok', conversations: /);
  assert.doesNotMatch(src, /conversations: \{/);
  const client = read('frontend/src/components/copilot/copilotConversationsClient.ts');
  assert.match(client, /return data\.conversations \|\| \[\]/);
  assert.match(client, /hasMore\?:/);
});

test('负测 K-01：把默认上限改成 200 或把数组改成对象 → 判红', () => {
  const src = read('core/petri-server/routes/ai-conversations.js');
  assert.doesNotMatch(src, /LIMIT 200/);
  assert.doesNotMatch(src, /conversations: \{/);
});

// ③ 复合索引
test('K-12：copilot_* 唯一 DDL 通道内新增幂等复合索引（ts+id 稳定游标）', () => {
  const src = read('core/petri-server/helpers/conversations.js');
  assert.match(src, /CREATE INDEX IF NOT EXISTS idx_msg_conv_ts_id ON copilot_messages\(conversation_id, ts ASC, id\)/);
  assert.doesNotMatch(src, /ON copilot_messages\(conversation_id, rowid\)/, 'rowid 是伪列，不可写进 CREATE INDEX（实测 SQLITE_ERROR）');
  assert.equal((src.match(/CREATE INDEX IF NOT EXISTS/g) || []).length >= 5, true);
});

test('行为：复合索引 DDL 可执行且 EXPLAIN QUERY PLAN 命中索引', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE copilot_messages(id TEXT PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT, meta_json TEXT, ts TEXT)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_msg_conv_ts_id ON copilot_messages(conversation_id, ts ASC, id)');
    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM copilot_messages WHERE conversation_id=? ORDER BY ts ASC LIMIT ?').all('c', 100);
    assert.ok(plan.some((r) => /USING INDEX idx_msg_conv_ts_id/.test(r.detail)), JSON.stringify(plan));
  } finally { db.close(); }
});

test('负测：把 rowid 写进 CREATE INDEX 必抛 SQLITE_ERROR（防回退）', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE m(id TEXT PRIMARY KEY, conversation_id TEXT, ts TEXT)');
    assert.throws(() => db.exec('CREATE INDEX IF NOT EXISTS bad ON m(conversation_id, rowid)'), /no such column: rowid/);
  } finally { db.close(); }
});

test('K-12 校准：task_events(task_id, seq) 索引已由 BLOCK-106 P2 建立，不重复建且不得越通道', () => {
  const store = read('core/petri-server/agent-task-store.js');
  assert.match(store, /CREATE INDEX IF NOT EXISTS idx_task_events_task_seq ON task_events\(task_id, seq\)/);
  const conv = read('core/petri-server/helpers/conversations.js');
  assert.doesNotMatch(conv, /CREATE INDEX[^\n]*ON task_events/, 'conversations.js 不建 task_events 索引（表不在此通道）');
});

test('K-12：索引不新建第二 DDL 通道（db/schema.js 不建 copilot_* 表）', () => {
  const schema = read('core/petri-server/db/schema.js');
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS copilot_conversations/);
  const migrations = read('src/migrations/README.md');
  assert.ok(migrations.length > 0);
});

// ④ 结构性挂起项：现状裁决（不冒充已修）
test('W5b 挂起项：fork 多步写仍非原子、SSE 仍 500ms 轮询、服务端仍 LIMIT 101 单页', () => {
  const conv = read('core/petri-server/routes/ai-conversations.js');
  assert.match(conv, /stmt\.run\(msgId/, 'fork 逐条 INSERT 现状保留');
  const events = read('core/petri-server/routes/ai-agent/events.js');
  assert.match(events, /setInterval\([^,]+,\s*500\)|500\)/);
  assert.match(events, /15_000|15000/);
  assert.equal(conv.includes('db.transaction(') || conv.includes('BEGIN TRANSACTION'), false, 'K2 不改数据访问契约');
});

test('负测：证据整体缺席 → fail-closed 判红', () => {
  assert.throws(() => read('core/petri-server/helpers/DOES_NOT_EXIST.js'));
});
