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

test('W1 orchestrator 把 provider_retry 投影为 agent_status(phase=provider_retry, reasonCode)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core', 'petri-server', 'loop-orchestrator.js'), 'utf8');
  assert.match(src, /event\.type === 'provider_retry'[\s\S]{0,400}phase: 'provider_retry'[\s\S]{0,200}reasonCode/, '投影接线在案');
});
