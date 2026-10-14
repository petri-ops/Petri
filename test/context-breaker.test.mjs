// BLOCK-51 P2 — 上下文熔断接线 loop 层测试
// 验证（BLOCK-172 CP-7 后契约）：① 每轮发放 token_budget(trimmed:false) 预算环；
//       ② 超窗一次性修剪 + token_budget(trimmed:true) 事件 + CP-5 摘要 +
//          context_compacted 事件；reqBody 使用修剪后消息且 system 保留；
//       ③ 原数组引用就地替换（agent-runner 后续 push 安全）；
//       ④ 多轮迭代防抖——trimmed 事件只发一次（CP-5 摘要调用不劫持主调用计数）。
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

test('BLOCK-51 P2 — 超窗触发一次性修剪 + token_budget(trimmed) 事件 + CP-5 摘要 + 就地替换', async () => {
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

  // BLOCK-172 CP-7：预算环事件（trimmed=false）每轮先发，修剪后再发 trimmed=true。
  const budgetEvents = events.filter((e) => e.event === 'token_budget');
  assert.equal(budgetEvents.length, 2, '预算环(false)+修剪(true)两条');
  assert.equal(budgetEvents[0].trimmed, false, '首条=CP-7 预算环');
  assert.equal(budgetEvents[1].trimmed, true, '第二条=修剪');
  assert.ok(budgetEvents[1].messagesDropped > 0, '确有消息被修剪');
  assert.ok(budgetEvents[1].messagesTokensUsed < budgetEvents[1].contextWindow, '修剪后低于窗口');

  // BLOCK-172 CP-5：丢弃 ≥4 条时生成摘要（本 mock 恒有效），context_compacted 事件在案。
  const compacted = events.find((e) => e.event === 'context_compacted');
  assert.ok(compacted, 'context_compacted 事件在案');
  assert.equal(compacted.summarized, true, 'CP-5 摘要生成');
  assert.ok(compacted.dropped > 0);

  // reqBodies[0] = CP-5 摘要请求（压缩器形态：system 压缩指令 + 单 user 摘要源）；
  // reqBodies[1] = 主请求（使用修剪后数组）。
  assert.ok(reqBodies.length >= 2);
  const compactorReq = reqBodies[0];
  assert.equal(compactorReq.messages.length, 2, 'CP-5 摘要请求=压缩器+摘要源两条');
  assert.match(String(compactorReq.messages[0].content), /会话压缩器/);

  const sent = reqBodies[1].messages;
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

  // BLOCK-172 CP-7：预算环事件每轮发放（trimmed=false）；不修剪=无 trimmed 事件。
  const budgetEvents = events.filter((e) => e.event === 'token_budget');
  assert.equal(budgetEvents.length, 1, '预算环事件发放（trimmed=false）');
  assert.equal(budgetEvents[0].trimmed, false, '未修剪');
  assert.equal(events.filter((e) => e.event === 'token_budget' && e.trimmed === true).length, 0, '不超窗不发修剪事件');
  assert.equal(reqBodies[0].messages.length, 4, '消息原样发送');
});

test('BLOCK-51 P2 — 多轮迭代防抖：continuation 续写后 trimmed 事件仍只有一次', async () => {
  const events = [];
  const reqBodies = [];
  const messages = buildMessages(100);
  const mainCallBodies = [];

  // CP-5 摘要调用（temperature 0.2、两条消息）与主调用共用通道——按形态过滤，
  // 防摘要调用劫持主调用计数（曾致 continuation 场景静默空转）。
  const callChatProvider = async (_provider, _apiKey, reqBody) => {
    reqBodies.push(reqBody);
    const isCompactor = reqBody.temperature === 0.2 && reqBody.messages.length === 2;
    if (isCompactor) {
      return { choices: [{ message: { role: 'assistant', content: '早期对话摘要：用户验证上下文熔断。' }, finish_reason: 'stop' }] };
    }
    mainCallBodies.push(reqBody);
    if (mainCallBodies.length === 1) {
      return { choices: [{ message: { role: 'assistant', content: '部分回答…' }, finish_reason: 'length' }] };
    }
    return { choices: [{ message: { role: 'assistant', content: '完成' }, finish_reason: 'stop' }] };
  };

  await runLoop({
    messages,
    ...baseLoopArgs({ callChatProvider, events }),
    config: baseConfig(),
  });

  // 主调用≥2 轮（首轮 length 截断→continuation 续写）+ CP-5 摘要调用 1 次。
  assert.ok(mainCallBodies.length >= 2, '应有多轮主迭代（continuation 真实走通）');
  assert.ok(reqBodies.length >= mainCallBodies.length + 1, 'CP-5 摘要调用在场');
  const trimmedEvents = events.filter((e) => e.event === 'token_budget' && e.trimmed === true);
  assert.equal(trimmedEvents.length, 1, '防抖：多轮迭代 trimmed 事件只发一次');
  // 第二轮请求仍使用修剪后的规模（未超窗二次膨胀即不再 trim，交给 API 诚实失败）
  assert.ok(
    mainCallBodies[1].messages.length >= mainCallBodies[0].messages.length,
    '续写消息正常追加',
  );
});
