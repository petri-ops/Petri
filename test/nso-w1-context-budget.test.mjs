/**
 * nso-w1-context-budget.test.mjs — BLOCK-365（NSO-W1 F-02 / F-15 / F-14）上下文预算每轮化与诚实摘要。
 *
 * 缺口（评估 + 本包实证）：
 *  F-02 一次性 latch：首次修剪后 contextBudgetTrimmed=true，之后每轮不再估算/修剪/发 token_budget，
 *       长任务涨破窗口；同时修剪预算未计入 CP-5 摘要与工具定义 → 修剪后总量反超窗口
 *       （context-breaker 存量红实测 24015 > 24000）。
 *  F-15 trimmer 无条件注入「上面"对话历史摘要"块中包含其要点」——摘要失败/缺席时对模型是不实声明；
 *       摘要源按 messages.slice(0, droppedCount) 取前缀，而 trimmer 按评分保留，前缀≠真实被丢集合。
 *  F-14 压缩失败无事件；二次压缩把旧摘要当系统提示，原系统提示可能被挤出。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-w1-budget-'));
process.env.PETRI_DB_PATH = path.join(tempDir, 'w1-budget.db');
process.on('exit', () => { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort */ } });
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.PETRI_DB_PATH, path.join(TEST_DIR, '../src/migrations'));
const { runLoop } = require('../core/petri-server/loop-orchestrator');
const { trimMessagesToBudget } = require('../core/petri-server/helpers/message-trimmer');

const SYSTEM = '你是测试系统提示。';
const FILLER = 'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(20);
function buildMessages(count) {
  const messages = [{ role: 'system', content: SYSTEM }];
  for (let i = 0; i < count; i++) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `历史消息 ${i}:` + FILLER });
  }
  return messages;
}
const config = () => ({
  userId: 'user-w1-budget', modelName: 'test-model', kind: 'primary', contextWindow: 24000,
  executionPolicy: { allowExecution: false }, context: {},
});
const loopArgs = (events, callChatProvider) => ({
  toolCtx: { accessMode: 'read' }, shouldAbort: () => false, emitToolResult: () => {},
  emitAssistant: (e) => events.push(e), emitDone: () => {}, callChatProvider,
});
const isCompactor = (body) => body.temperature === 0.2 && body.messages.length === 2;

test('W1-F02 每轮重估：首轮修剪后真实增长再次越线 → 再次修剪（不再一次性 latch）', async () => {
  const events = [];
  let main = 0;
  const callChatProvider = async (_p, _k, body) => {
    if (isCompactor(body)) return { choices: [{ message: { role: 'assistant', content: '摘要：早期对话。' }, finish_reason: 'stop' }] };
    main += 1;
    // 首轮截断续写并灌入大段正文 → 下一轮再次越线；第二轮正常收尾
    if (main === 1) return { choices: [{ message: { role: 'assistant', content: `大段输出${FILLER.repeat(12)}` }, finish_reason: 'length' }] };
    return { choices: [{ message: { role: 'assistant', content: '完成' }, finish_reason: 'stop' }] };
  };
  await runLoop({ messages: buildMessages(100), ...loopArgs(events, callChatProvider), config: config() });
  const budget = events.filter((e) => e.event === 'token_budget');
  assert.ok(budget.filter((e) => e.trimmed === false).length >= 2, '预算环每轮都发（不止首轮）');
  assert.equal(budget.filter((e) => e.trimmed === true).length, 2, '真实增长再次越线必须再修剪');
  for (const e of budget.filter((x) => x.trimmed === true)) {
    assert.ok(e.messagesTokensUsed < e.contextWindow * 0.85, `修剪后须低于触发线（滞回防抖）：${e.messagesTokensUsed}`);
  }
});

test('W1-F02 修剪后原系统提示恒为首条，摘要紧随其后（不顶替系统提示）', async () => {
  const events = [];
  const bodies = [];
  const callChatProvider = async (_p, _k, body) => {
    if (isCompactor(body)) return { choices: [{ message: { role: 'assistant', content: '摘要：早期对话。' }, finish_reason: 'stop' }] };
    bodies.push(body);
    return { choices: [{ message: { role: 'assistant', content: '完成' }, finish_reason: 'stop' }] };
  };
  await runLoop({ messages: buildMessages(100), ...loopArgs(events, callChatProvider), config: config() });
  const sent = bodies[0].messages;
  assert.equal(sent[0].content, SYSTEM, '原系统提示必须仍是首条');
  assert.equal(sent[1].role, 'system');
  assert.match(String(sent[1].content), /自动压缩摘要/);
});

test('W1-F15 摘要失败：不得声称「上面有摘要」，改为诚实告知 + compaction_failed 事件', async () => {
  const events = [];
  const bodies = [];
  const callChatProvider = async (_p, _k, body) => {
    if (isCompactor(body)) return { choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }] };
    bodies.push(body);
    return { choices: [{ message: { role: 'assistant', content: '完成' }, finish_reason: 'stop' }] };
  };
  await runLoop({ messages: buildMessages(100), ...loopArgs(events, callChatProvider), config: config() });
  const text = bodies[0].messages.map((m) => String(m.content || '')).join('\n');
  assert.doesNotMatch(text, /对话历史摘要"块中包含其要点/, '摘要缺席时不得对模型做不实声明');
  assert.match(text, /未生成摘要|未能生成摘要/, '须诚实告知早期消息已移除且无摘要');
  const failed = events.find((e) => e.event === 'compaction_failed');
  assert.ok(failed, 'compaction_failed 事件在案');
  assert.equal(failed.reason, 'empty_summary');
});

test('W1-F14 增量摘要（行为）：已有摘要时再次压缩，摘要源合并上一份、原系统提示仍首条、摘要只一份', async () => {
  const { runContextBudgetStep } = require('../core/petri-server/agent-tools/context-budget-step');
  const compactorBodies = [];
  const callChatProvider = async (_p, _k, body) => {
    compactorBodies.push(body);
    return { choices: [{ message: { role: 'assistant', content: '摘要第2版' }, finish_reason: 'stop' }] };
  };
  const messages = [{ role: 'system', content: SYSTEM },
    { role: 'system', content: '（BLOCK-172 CP-5 自动压缩摘要 · 覆盖较早 30 条对话，原文见 llm-transcripts）\n摘要第1版：用户目标已确认。' },
    ...Array.from({ length: 80 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `新历史 ${i}:${FILLER}` })),
    { role: 'user', content: '继续' }];
  const events = [];
  await runContextBudgetStep({
    messages, loopContextWindow: 24000, reqMaxTokens: 16384, toolDefinitionsTokens: 0, modelName: 'test-model',
    callChatProvider, providerName: 'p', apiKey: 'k', userId: 'u', emit: (e) => events.push(e),
  });
  assert.equal(compactorBodies.length, 1, '发生一次压缩');
  assert.match(String(compactorBodies[0].messages[1].content), /摘要第1版/, '摘要源须合并上一份摘要（增量）');
  assert.equal(messages[0].content, SYSTEM, '原系统提示仍为首条');
  const summaries = messages.filter((m) => /自动压缩摘要/.test(String(m.content || '')));
  assert.equal(summaries.length, 1, '摘要替换不叠加');
  assert.match(String(summaries[0].content), /摘要第2版/);
  assert.equal(messages[messages.length - 1].content, '继续', '活动轮保留');
});

test('W1-F14 二次修剪不重生摘要时（被丢 <4 条），上一份摘要原样延续不丢失', async () => {
  const events = [];
  let main = 0;
  const callChatProvider = async (_p, _k, body) => {
    if (isCompactor(body)) return { choices: [{ message: { role: 'assistant', content: '摘要第1版' }, finish_reason: 'stop' }] };
    main += 1;
    if (main === 1) return { choices: [{ message: { role: 'assistant', content: `大段输出${FILLER.repeat(12)}` }, finish_reason: 'length' }] };
    return { choices: [{ message: { role: 'assistant', content: '完成' }, finish_reason: 'stop' }] };
  };
  const messages = buildMessages(100);
  await runLoop({ messages, ...loopArgs(events, callChatProvider), config: config() });
  assert.equal(events.filter((e) => e.event === 'token_budget' && e.trimmed === true).length, 2);
  assert.ok(messages.some((m) => /摘要第1版/.test(String(m.content || ''))), '上一份摘要必须延续');
  assert.equal(messages[0].content, SYSTEM);
});

test('W1-F15 trimmer：返回真实被丢集合、不注入不实注释、永不丢弃当前活动轮', () => {
  const msgs = buildMessages(40);
  msgs.push({ role: 'user', content: '当前问题：' + FILLER });
  const result = trimMessagesToBudget({ fullMessages: msgs, contextWindow: 3000, headroom: 2900, systemPromptTokens: 10 });
  assert.ok(Array.isArray(result.dropped) && result.dropped.length > 0, '返回真实被丢消息集合');
  const kept = new Set(result.messages);
  for (const m of result.dropped) assert.ok(!kept.has(m), 'dropped 与保留集合不相交');
  assert.equal(result.messages[result.messages.length - 1].content, msgs[msgs.length - 1].content, '当前活动轮（最后一条 user）必须保留');
  assert.ok(!result.messages.some((m) => /对话历史摘要"块中包含其要点/.test(String(m.content || ''))), 'trimmer 不再注入摘要声明');
});
