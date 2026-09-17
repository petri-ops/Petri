'use strict';

/**
 * BLOCK-98 P3 — 防呆状态机（M3）+ context-exceeded 分类 + reactive 裁剪（M3）+ 遥测列（M5）契约。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const path = await import('node:path');
const url = await import('node:url');
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const R_SERVER = path.resolve(__dirname, '..', 'core', 'biof3-server');

// 自举临时 DB（src/migrations 全量）——ai-usage 模块级 getDatabase() 需要库在位；
// BIOF3_DB_PATH 隔离须在 require db.js 前生效（BLOCK-52 家法）。
{
  const fs = require('fs');
  const ospkg = require('os');
  const dbPathMod = require('path');
  const Database = require(R_SERVER + '/node_modules/better-sqlite3');
  const tempDbDir = fs.mkdtempSync(dbPathMod.join(ospkg.tmpdir(), 'biof3-block98-res-db-'));
  const boot = new Database(dbPathMod.join(tempDbDir, 'biof3.db'));
  const migrationsDir = path.resolve(__dirname, '..', 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(dbPathMod.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.BIOF3_DB_PATH = dbPathMod.join(tempDbDir, 'biof3.db');
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch {}
  });
}

const resilience = require('../core/biof3-server/helpers/agent-resilience');
const aiUsage = require('../core/biof3-server/helpers/ai-usage');

// ── M3 防呆状态机 ──

test('熔断：连续 3 次压缩失败开启 10 分钟冷却期', () => {
  const s = resilience.createResilienceState();
  assert.equal(resilience.compactionAllowed(s), true);
  resilience.recordCompactionFailure(s);
  resilience.recordCompactionFailure(s);
  assert.equal(resilience.compactionAllowed(s), true, '2 次失败不熔断');
  resilience.recordCompactionFailure(s);
  assert.equal(resilience.compactionAllowed(s), false, '3 次失败 → 熔断');
  // 冷却期过后恢复（注入未来时间戳）
  assert.equal(resilience.compactionAllowed(s, Date.now() + 11 * 60 * 1000), true);
});

test('熔断计数在开启后清零（冷却期内不再累积）', () => {
  const s = resilience.createResilienceState();
  resilience.recordCompactionFailure(s);
  resilience.recordCompactionFailure(s);
  resilience.recordCompactionFailure(s);
  assert.equal(s.compactionFailures, 0, '熔断触发即清零计数');
  assert.ok(s.circuitOpenUntil > Date.now());
});

test('reactive 单 run 上限 3 次', () => {
  const s = resilience.createResilienceState();
  resilience.recordReactiveUse(s);
  resilience.recordReactiveUse(s);
  assert.equal(resilience.reactiveAllowed(s), true);
  resilience.recordReactiveUse(s);
  assert.equal(resilience.reactiveAllowed(s), false, '第 4 次被拒');
});

// ── M3 context-exceeded 分类 ──

test('classifyContextExceeded 多族模式匹配', () => {
  const hits = [
    new Error("This model's maximum context length is 128000 tokens"),
    new Error('context_length_exceeded: prompt too long'),
    new Error('prompt is too long: 210000 tokens > 200000 maximum'),
    new Error('Request too large for the model'),
    new Error('输入长度超出上下文窗口限制 context window'),
  ];
  hits.forEach((e, i) => assert.equal(resilience.classifyContextExceeded(e), true, `case ${i}`));
  const misses = [
    new Error('401 unauthorized'),
    new Error('connection refused'),
    new Error('rate limit exceeded for requests per minute'),
    'plain string error',
    null,
  ];
  misses.forEach((e, i) => assert.equal(resilience.classifyContextExceeded(e), false, `miss ${i}`));
});

// ── M3 reactiveTrim ──

function block(i, fillLen = 600) {
  const assistant = {
    role: 'assistant',
    content: null,
    tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'read_page', arguments: '{}' } }],
  };
  const tool = { role: 'tool', tool_call_id: `c${i}`, name: 'read_page', content: 'z'.repeat(fillLen) };
  return [assistant, tool];
}

test('reactiveTrim 第 1 段：全量折叠工具组即可达标时不丢消息', () => {
  const messages = [{ role: 'system', content: 'sys' }];
  // 8 块 × 20000 字符工具结果 ≈ 40K tokens > target(38400)：折叠占位符后即达标
  for (let i = 0; i < 8; i++) messages.push(...block(i, 20000));
  messages.push({ role: 'user', content: '继续任务' });
  const out = resilience.reactiveTrim(messages, { contextWindow: 64000 });
  assert.ok(out, 'must produce a trimmed projection');
  assert.equal(out.dropped, 0, '第 1 段折叠即可达标 → 零丢弃');
  assert.equal(out.foldedAll, true);
  assert.equal(out.messages.length, messages.length, '消息数不变（内容被折叠）');
});

test('reactiveTrim 第 2 段：仍超限则从最老整块丢弃，切点不产生孤儿 tool', () => {
  const messages = [{ role: 'system', content: 'sys' }];
  // 工具结果可被第 1 段折叠；不可折叠的大段 assistant 正文才是第 2 段的目标
  for (let i = 0; i < 30; i++) {
    // 自然分词文本（tiktoken 对重复字符压缩极强，重复 u 不占 token）
    messages.push({ role: 'assistant', content: `第 ${i} 步分析结论 analysis result block-${i} alpha beta gamma 123 `.repeat(300) });
    messages.push(...block(i, 200));
  }
  messages.push({ role: 'user', content: '继续任务' });
  const out = resilience.reactiveTrim(messages, { contextWindow: 64000 });
  assert.ok(out, 'must produce a trimmed projection');
  assert.ok(out.dropped > 0, '必须丢弃最老消息 dropped=' + out.dropped);
  // 切点边界：drop 后首条不得是 tool 结果（孤儿）
  assert.notEqual(out.messages[0] && out.messages[0].role, 'tool');
  // system 保留、尾部保留
  assert.equal(out.messages[0].role, 'system');
  assert.equal(out.messages[out.messages.length - 1].content, '继续任务');
  // 丢弃数 = 裁剪前与裁剪后长度差
  assert.equal(messages.length - out.messages.length, out.dropped);
});

test('reactiveTrim：无法再裁（消息太少）返回 null', () => {
  const messages = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ];
  assert.equal(resilience.reactiveTrim(messages, { contextWindow: 64000 }), null);
});

// ── M5 遥测列（additive）──

test('recordAiUsage 接受韧性遥测字段并持久化', () => {
  // 走模块级真实 sqlite（ai-usage 自建表，幂等）；断言行可查
  aiUsage.recordAiUsage({
    userId: 'u-block98', kind: 'llm_retry', model: 'test-model', conversationId: 'conv_b98',
    attempt: 2, retryable: true, contextExceeded: true, errorCode: 'context_exceeded',
  });
  const row = aiUsage.__test_queryLatest ? aiUsage.__test_queryLatest() : null;
  // 模块未导出查询助手时直接打 sqlite 查询
  const sqlite = require('../core/biof3-server/db').getDatabase();
  const got = sqlite.prepare("SELECT attempt, retryable, context_exceeded FROM ai_usage WHERE user_id='u-block98' ORDER BY id DESC LIMIT 1").get();
  assert.deepEqual({ attempt: got.attempt, retryable: got.retryable, context_exceeded: got.context_exceeded }, { attempt: 2, retryable: 1, context_exceeded: 1 });
});
