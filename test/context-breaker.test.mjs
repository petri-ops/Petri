// BLOCK-51 P2 — 上下文熔断接线 loop 层测试
// 验证：① 超窗触发一次性修剪 + token_budget(trimmed:true) 事件；
//       ② reqBody 使用修剪后消息且 system 保留；
//       ③ 原数组引用就地替换（agent-runner 后续 push 安全）；
//       ④ 多轮迭代防抖——trimmed 事件只发一次。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-context-breaker-'));
process.env.PETRI_DB_PATH = path.join(tempDir, 'context-breaker.db');

const require = createRequire(import.meta.url);
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

// loop-orchestrator 顶层 require ./db（模块顶层 prepare projects）——
// 与 agent-concurrency.test.mjs 同一基建修复：先跑生产 migration 链。
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.PETRI_DB_PATH, path.join(TEST_DIR, '../src/migrations'));

const { runLoop } = require('../core/petri-server/loop-orchestrator');

// ~180 tokens/条（tiktoken cl100k_base 对自然语言文本），100 条 ≈ 18K tokens
function buildMessages(count) {
  const messages = [{ role: 'system', content: '你是测试系统提示。' }];
  for (let i = 0; i < count; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `历史消息 ${i}:` + 'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(20),
    });
  }
  return messages;
}

function baseConfig(overrides = {}) {
  return {
    userId: 'user-breaker',
    modelName: 'test-model',
    kind: 'primary',
    contextWindow: 24000, // 触发线 0.85*24000=20400；est.total ≈ sys+18K+16384 ≈ 34K 必触发
    executionPolicy: { allowExecution: false },
    context: {},
    ...overrides,
  };
}

function baseLoopArgs({ callChatProvider, events }) {
  return {
    toolCtx: { accessMode: 'read' },
    shouldAbort: () => false,
    emitToolResult: () => {},
    emitAssistant: (e) => events.push(e),
    emitDone: () => {},
    callChatProvider,
    conversationState: {},
  };
}

test('BLOCK-51 P2 — 超窗触发一次性修剪 + token_budget(trimmed) 事件 + 就地替换', async () => {
  const events = [];
  const reqBodies = [];
  const messages = buildMessages(100);
  const originalCount = messages.length;

  const callChatProvider = async (_provider, _apiKey, reqBody) => {
    reqBodies.push(reqBody);
    return { choices: [{ message: { role: 'assistant', content: '完成' }, finish_reason: 'stop' }] };
  };

  const result = await runLoop({
    messages,
    ...baseLoopArgs({ callChatProvider, events }),
    config: baseConfig(),
  });

  assert.equal(result.assistantText, '完成', '正常收尾');

  const budgetEvents = events.filter((e) => e.event === 'token_budget');
  assert.equal(budgetEvents.length, 1, 'trimmed 事件只发一次（防抖）');
  assert.equal(budgetEvents[0].trimmed, true);
  assert.ok(budgetEvents[0].messagesDropped > 0, '确有消息被修剪');
  assert.ok(budgetEvents[0].messagesTokensUsed < budgetEvents[0].contextWindow, '修剪后低于窗口');

  assert.ok(reqBodies.length >= 1);
  const sent = reqBodies[0].messages;
  assert.ok(sent.length < originalCount, 'reqBody 使用修剪后数组');
  assert.equal(sent[0].role, 'system', 'system prompt 不参与 trim、恒保留');
  // 原数组引用保持且内容被就地替换（agent-runner 持有的 fullMessages 后续 push 安全）
  assert.equal(messages.length, sent.length);
  assert.equal(messages[0], sent[0]);
});

test('BLOCK-51 P2 — 未超窗不修剪（零开销路径）', async () => {
  const events = [];
  const reqBodies = [];
  const messages = buildMessages(3); // 远低于触发线

  const callChatProvider = async (_provider, _apiKey, reqBody) => {
    reqBodies.push(reqBody);
    return { choices: [{ message: { role: 'assistant', content: '完成' }, finish_reason: 'stop' }] };
  };

  await runLoop({
    messages,
    ...baseLoopArgs({ callChatProvider, events }),
    config: baseConfig(),
  });

  assert.equal(events.filter((e) => e.event === 'token_budget').length, 0, '不超窗不发 token_budget');
  assert.equal(reqBodies[0].messages.length, 4, '消息原样发送');
});

test('BLOCK-51 P2 — 多轮迭代防抖：continuation 续写后 trimmed 事件仍只有一次', async () => {
  const events = [];
  const reqBodies = [];
  const messages = buildMessages(100);
  const afterFirstTrimSnapshot = [];

  let call = 0;
  const callChatProvider = async (_provider, _apiKey, reqBody) => {
    reqBodies.push(reqBody);
    call += 1;
    if (call === 1) {
      // 首轮：返回截断标记 → continuation 路径（messages 追加 assistant + '继续'）
      afterFirstTrimSnapshot.push(reqBody.messages.length);
      return { choices: [{ message: { role: 'assistant', content: '部分回答…' }, finish_reason: 'length' }] };
    }
    return { choices: [{ message: { role: 'assistant', content: '完成' }, finish_reason: 'stop' }] };
  };

  await runLoop({
    messages,
    ...baseLoopArgs({ callChatProvider, events }),
    config: baseConfig(),
  });

  assert.ok(reqBodies.length >= 2, '应有多轮迭代');
  const trimmedEvents = events.filter((e) => e.event === 'token_budget' && e.trimmed === true);
  assert.equal(trimmedEvents.length, 1, '防抖：多轮迭代 trimmed 事件只发一次');
  // 第二轮请求仍使用修剪后的规模（未超窗二次膨胀即不再 trim，交给 API 诚实失败）
  assert.ok(reqBodies[1].messages.length >= afterFirstTrimSnapshot[0], '续写消息正常追加');
});
