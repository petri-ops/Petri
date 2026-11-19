/**
 * BLOCK-507 票 1 附加交付② — 停滞恢复强化：多次重试+退避（HK-01 红绿先行）。
 *
 * 用户痛点：deepseek 直连大上下文请求中途停摆（stream_stalled）被折磨多次。
 * 旧形态：零可见输出停滞只自动重试 1 次——瞬时停摆若连续两次就断给用户。
 * 新契约（彻底解决第②层）：
 *   - 零可见交付输出（emittedOutput!==true）的 stream_stalled → 最多 2 次重试
 *     （总尝试 3 次），退避 2s/5s（options.stallRetryDelaysMs 可注入，测试注入 [1,1]）；
 *   - 每次重试前经 onEvent 发 provider_retry（attempt=实际尝试序号，带 delayMs）——重试可观测；
 *   - 重放安全不变：emittedOutput=true（已交付可见内容）不重试，防重复交付；
 *   - 全部重试仍 stall → 如实返回最后一次错误（不无限重试、不假成功）。
 * 依据：deepseek 前缀缓存使重试大 prefill 命中缓存（重试成本已最小化）；
 *       瞬时停摆大概率在后继尝试恢复（BLOCK-505 根因核实注记）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('BLOCK-507 ②①：连续两次零可见输出 stall → 第 3 次尝试恢复（calls=3，两次 provider_retry，退避可注入）', async () => {
  const { modelGateway } = require('../core/petri-server/helpers/model-gateway.js');
  const llm = require('../core/petri-server/helpers/llm-client.js');
  let calls = 0;
  const fakeChat = async () => {
    calls += 1;
    if (calls <= 2) return { error: 'stream_stalled', phase: 'idle', emittedOutput: false, elapsedMs: 60010 };
    return { choices: [{ message: { content: 'ok' } }] };
  };
  const events = [];
  const saved = modelGateway.chat;
  modelGateway.chat = fakeChat;
  try {
    const result = await llm.callChatProvider('deepseek', 'sk', { messages: [] }, {}, (e) => events.push(e), { stallRetryDelaysMs: [1, 1] });
    assert.equal(calls, 3, `总尝试 3 次（初始+2 重试），实际 ${calls}`);
    assert.ok(result && !result.error, '第 3 次恢复成功');
    const retries = events.filter((e) => e && e.type === 'provider_retry');
    assert.equal(retries.length, 2, '两次重试都可观测');
    assert.deepEqual(retries.map((r) => r.attempt), [2, 3]);
    assert.deepEqual(retries.map((r) => r.delayMs), [1, 1]);
  } finally {
    modelGateway.chat = saved;
  }
});

test('BLOCK-507 ②②：三次全 stall → 如实返回最后一次错误（不无限重试不假成功）', async () => {
  const { modelGateway } = require('../core/petri-server/helpers/model-gateway.js');
  const llm = require('../core/petri-server/helpers/llm-client.js');
  let calls = 0;
  const fakeChat = async () => {
    calls += 1;
    return { error: 'stream_stalled', phase: 'idle', emittedOutput: false, elapsedMs: 60010 };
  };
  const events = [];
  const saved = modelGateway.chat;
  modelGateway.chat = fakeChat;
  try {
    const result = await llm.callChatProvider('deepseek', 'sk', { messages: [] }, {}, (e) => events.push(e), { stallRetryDelaysMs: [1, 1] });
    assert.equal(calls, 3, '总尝试封顶 3 次');
    assert.equal(result && result.error, 'stream_stalled', '如实返回 stall 错误');
    assert.equal(events.filter((e) => e && e.type === 'provider_retry').length, 2, '恰好两次重试事件');
  } finally {
    modelGateway.chat = saved;
  }
});

test('BLOCK-507 ②③：已交付可见输出的 stall 不重试（防重复交付，既有语义保留）', async () => {
  const { modelGateway } = require('../core/petri-server/helpers/model-gateway.js');
  const llm = require('../core/petri-server/helpers/llm-client.js');
  let calls = 0;
  const fakeChat = async () => {
    calls += 1;
    return { error: 'stream_stalled', phase: 'idle', emittedOutput: true, elapsedMs: 60010 };
  };
  const saved = modelGateway.chat;
  modelGateway.chat = fakeChat;
  try {
    const result = await llm.callChatProvider('deepseek', 'sk', { messages: [] }, {}, () => {}, { stallRetryDelaysMs: [1, 1] });
    assert.equal(calls, 1, '已交付可见内容 → 不重试');
    assert.equal(result && result.error, 'stream_stalled', '如实返回');
  } finally {
    modelGateway.chat = saved;
  }
});
