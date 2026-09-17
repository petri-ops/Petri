/**
 * BLOCK-95 B1 — 历史拼装权收归后端契约（helpers/history-assembly.js）。
 *
 * 真实 SQLite（BIOF3_DB_PATH 临时库），覆盖：
 *   - 开关判定（默认关 / 1|true 开 / 其他值关）
 *   - 拼装 = DB 历史 + 本轮 user 原文回填
 *   - diff 对账核心：模拟前端 tagged（= DB 同源 restore + 原文尾）与拼装输出逐字一致
 *   - 剥前缀场景：DB user 为 cleanContent（落库剥 [引用] 行），拼装历史保持剥后版、尾部用原文
 *   - 空会话 / 无会话 id / DB 异常：回退前端上报（不阻断会话）
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const resolve = (...segments) => path.resolve(__dirname, '..', ...segments);
const require = createRequire(import.meta.url);

const USER_ID = 'u_b95b1';
const CONV = 'conv-b95-b1';

let tempDir;
let adb;
let assembly;

function seedMsg(role, content, ts) {
  return adb.prepare('INSERT INTO copilot_messages(id, conversation_id, role, content, meta_json, ts) VALUES (?,?,?,?,?,?)')
    .run(`msg_b1_${Math.random().toString(36).slice(2, 8)}`, CONV, role, content, null, ts);
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-block95-b1-'));
  const dbPath = path.join(tempDir, 'b1.db');
  process.env.BIOF3_DB_PATH = dbPath;
  const { runMigrations } = require(resolve('src/migration-runner.js'));
  runMigrations(dbPath, resolve('src/migrations'));
  require(resolve('core/biof3-server/helpers/conversations'));
  adb = require(resolve('core/biof3-server/db')).getAsyncDatabase();
  assembly = require(resolve('core/biof3-server/helpers/history-assembly'));

  await adb.prepare('INSERT INTO copilot_conversations(id, user_id, title, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(CONV, USER_ID, 't', 'active', new Date().toISOString(), new Date().toISOString());
  // 两轮历史（content 与前端展示层 restore 同源——正常轮 resolveToolSummaryPresentation 原样透传）
  await seedMsg('user', '第一问：什么是游标分页？', '2026-09-17T00:00:01.000Z');
  await seedMsg('assistant', '游标分页是……', '2026-09-17T00:00:02.000Z');
  // 真实落库为 cleanContent（chat.js 剥开头引用行后的版本）
  await seedMsg('user', '第二问：rowid 为什么稳？', '2026-09-17T00:00:03.000Z');
  await seedMsg('assistant', '因为 fork 同 ts……', '2026-09-17T00:00:04.000Z');
});

after(async () => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  delete process.env.BIOF3_DB_PATH;
});

test('开关判定：默认关，1/true 开，其他值关', () => {
  const { isServerHistoryAssemblyEnabled } = assembly;
  assert.equal(isServerHistoryAssemblyEnabled({}), false);
  assert.equal(isServerHistoryAssemblyEnabled({ BIOF3_SERVER_HISTORY_ASSEMBLY: '1' }), true);
  assert.equal(isServerHistoryAssemblyEnabled({ BIOF3_SERVER_HISTORY_ASSEMBLY: 'true' }), true);
  assert.equal(isServerHistoryAssemblyEnabled({ BIOF3_SERVER_HISTORY_ASSEMBLY: 'yes' }), false);
  assert.equal(isServerHistoryAssemblyEnabled(undefined), false);
});

test('拼装 = DB 历史 + 本轮 user 原文回填', async () => {
  const incoming = [
    { role: 'user', content: '第一问：什么是游标分页？' },
    { role: 'assistant', content: '游标分页是……' },
    { role: 'user', content: '第二问：rowid 为什么稳？' },
    { role: 'assistant', content: '因为 fork 同 ts……' },
    { role: 'user', content: '第三问（新）' },
  ];
  const out = await assembly.assembleServerHistory({ conversationId: CONV, incomingMessages: incoming, adb });
  assert.equal(out.length, 5);
  assert.deepEqual(out.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user']);
  assert.equal(out[4].content, '第三问（新）'); // 尾部 = 前端原发
  assert.equal(out[0].content, '第一问：什么是游标分页？');
});

test('diff 对账：前端 tagged 与拼装输出逐字一致（无错误轮次会话）', async () => {
  // 前端 tagged = SimpleMessage restore（正常轮 content 原样）+ 本轮 user
  const tagged = [
    { role: 'user', content: '第一问：什么是游标分页？' },
    { role: 'assistant', content: '游标分页是……' },
    { role: 'user', content: '第二问：rowid 为什么稳？' }, // restore 自 DB（cleanContent 已剥）
    { role: 'assistant', content: '因为 fork 同 ts……' },
    { role: 'user', content: '第三问（新）' },
  ];
  const out = await assembly.assembleServerHistory({ conversationId: CONV, incomingMessages: tagged, adb });
  assert.equal(JSON.stringify(out), JSON.stringify(tagged));
});

test('剥前缀场景：历史轮保持 DB 版（cleanContent），尾部用前端原文', async () => {
  // DB 中第二条 user 已被落库 cleanContent 剥掉开头 [引用] 行
  const dbUser2 = await adb.prepare('SELECT content FROM copilot_messages WHERE conversation_id=? AND role=? ORDER BY ts ASC LIMIT 1 OFFSET 1').get(CONV, 'user');
  assert.equal(dbUser2.content, '第二问：rowid 为什么稳？'); // 剥后版
  const incoming = [
    { role: 'user', content: '[引用: 新文档]\n第三问（带引用）' },
  ];
  const out = await assembly.assembleServerHistory({ conversationId: CONV, incomingMessages: incoming, adb });
  // 拼装含 DB 全部历史 + 尾部前端原文（含引用行）
  assert.equal(out.length, 5);
  assert.equal(out[out.length - 1].content, '[引用: 新文档]\n第三问（带引用）');
});

test('chat.js 真实时序（append 剥前缀先行）：尾部剥后版回填为原文，长度不变', async () => {
  // 模拟 chat.js：先 appendMessageToConversation（cleanContent 剥开头引用行），再拼装
  const conv2 = 'conv-b95-b1-seq';
  await adb.prepare('INSERT INTO copilot_conversations(id, user_id, title, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(conv2, USER_ID, 't', 'active', new Date().toISOString(), new Date().toISOString());
  await adb.prepare('INSERT INTO copilot_messages(id, conversation_id, role, content, meta_json, ts) VALUES (?,?,?,?,?,?)')
    .run('msg_b1_seq_u', conv2, 'user', '第三问：总结', null, '2026-09-17T00:10:00.000Z');
  const incoming = [
    { role: 'user', content: '第一问：什么是游标分页？' },
    { role: 'assistant', content: '游标分页是……' },
    { role: 'user', content: '第二问：rowid 为什么稳？' },
    { role: 'assistant', content: '因为 fork 同 ts……' },
    { role: 'user', content: '第三问：总结' },
  ];
  const out = await assembly.assembleServerHistory({ conversationId: conv2, incomingMessages: incoming, adb });
  // 注意：conv2 只落了第三问——DB 拼装 = [第三问] + 尾部同文不动 = 1 条。
  // 真实会话 DB 有全量历史；此处锁定「尾部同文不重复追加」语义。
  assert.equal(out.length, 1);
  assert.equal(out[0].content, '第三问：总结');
});

test('空会话 / 无会话 id / DB 异常：回退前端上报', async () => {
  const incoming = [{ role: 'user', content: 'x' }];
  const empty = await assembly.assembleServerHistory({ conversationId: 'conv-b95-none', incomingMessages: incoming, adb });
  assert.equal(empty, incoming); // 原引用透传
  const noConv = await assembly.assembleServerHistory({ conversationId: null, incomingMessages: incoming, adb });
  assert.equal(noConv, incoming);
  const badDb = await assembly.assembleServerHistory({
    conversationId: CONV,
    incomingMessages: incoming,
    adb: { prepare: () => { throw new Error('db boom'); } },
  });
  assert.equal(badDb, incoming);
});
