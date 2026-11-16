/**
 * nso-w1-retry-observable.test.mjs — BLOCK-365（NSO-W1）重试可观测（蓝图 W1-8）。
 *
 * 缺口：llm-client 对首 token stall 静默重试一次（BLOCK-338 P2），用户与轨迹面看不到重试。
 * 契约：重试前经 onEvent 发 { type:'provider_retry', reason:'stream_stalled_first_token' }；
 * orchestrator 把它投影为 agent_status(phase='provider_retry', reasonCode)；不把重试当错误。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

test('W1 llm-client 首 token stall 重试前发 provider_retry 事件（不静默）', async () => {
  const { modelGateway } = require('../core/petri-server/helpers/model-gateway.js');
  let calls = 0;
  const fakeChat = async () => {
    calls += 1;
    return calls === 1 ? { error: 'stream_stalled', phase: 'first_token', elapsedMs: 90000 } : { choices: [{ message: { content: 'ok' } }] };
  };
  const events = [];
  const llm = require('../core/petri-server/helpers/llm-client.js');
  const target = modelGateway;
  const saved = target.chat;
  target.chat = fakeChat;
  try {
    const result = await llm.callChatProvider('deepseek', 'sk', { messages: [] }, {}, (e) => events.push(e), {});
    assert.equal(calls, 2, '静默重试仍保留（一次）');
    assert.ok(result && !result.error);
    const retry = events.find((e) => e && e.type === 'provider_retry');
    assert.ok(retry, `重试必须可观测：${JSON.stringify(events)}`);
    assert.equal(retry.reason, 'stream_stalled_first_token');
  } finally {
    target.chat = saved;
  }
});

test('STALL-ROOT idle 段但无可见输出（只吐 reasoning 后卡死）→ 安全重试一次', async () => {
  // 根因实测：deepseek-flash 每轮先吐 reasoning_delta（把看门狗 phase 从 first_token
  // 推到 idle），若吐完 reasoning 卡死 60s，phase=idle 但 emittedOutput=false。
  // 旧判据 phase==='first_token' 会漏掉这种零交付输出的瞬态，直接报错给用户。
  const { modelGateway } = require('../core/petri-server/helpers/model-gateway.js');
  let calls = 0;
  const fakeChat = async () => {
    calls += 1;
    return calls === 1
      ? { error: 'stream_stalled', phase: 'idle', emittedOutput: false, elapsedMs: 60010 }
      : { choices: [{ message: { content: 'ok' } }] };
  };
  const events = [];
  const llm = require('../core/petri-server/helpers/llm-client.js');
  const saved = modelGateway.chat;
  modelGateway.chat = fakeChat;
  try {
    const result = await llm.callChatProvider('deepseek', 'sk', { messages: [] }, {}, (e) => events.push(e), {});
    assert.equal(calls, 2, 'idle + 无可见输出必须重试一次（救回一次上游抽风）');
    assert.ok(result && !result.error, '重试应拿到成功结果');
    const retry = events.find((e) => e && e.type === 'provider_retry');
    assert.ok(retry, `重试必须可观测：${JSON.stringify(events)}`);
  } finally {
    modelGateway.chat = saved;
  }
});

test('STALL-ROOT idle 段且已有可见输出 → 不重试（防重复交付内容）', async () => {
  const { modelGateway } = require('../core/petri-server/helpers/model-gateway.js');
  let calls = 0;
  const fakeChat = async () => {
    calls += 1;
    return { error: 'stream_stalled', phase: 'idle', emittedOutput: true, elapsedMs: 60010 };
  };
  const llm = require('../core/petri-server/helpers/llm-client.js');
  const saved = modelGateway.chat;
  modelGateway.chat = fakeChat;
  try {
    const result = await llm.callChatProvider('deepseek', 'sk', { messages: [] }, {}, () => {}, {});
    assert.equal(calls, 1, '已有 content/tool_call 输出不得重放（会重复交付）');
    assert.equal(result.error, 'stream_stalled', '如实保留错误');
  } finally {
    modelGateway.chat = saved;
  }
});

test('W1 orchestrator 把 provider_retry 投影为 agent_status(phase=provider_retry, reasonCode)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core', 'petri-server', 'loop-orchestrator.js'), 'utf8');
  assert.match(src, /event\.type === 'provider_retry'[\s\S]{0,400}phase: 'provider_retry'[\s\S]{0,200}reasonCode/, '投影接线在案');
});
