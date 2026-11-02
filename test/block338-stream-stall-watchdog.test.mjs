/**
 * BLOCK-338 P1 — 流式 stall 看门狗契约。
 *
 * 红线（plan §2）：
 *   - 只有 content_delta / tool_call_delta / thinking_delta 续命；心跳、空 chunk、ping、
 *     其他事件一律**不续命**（否则看门狗形同虚设）。
 *   - 首 token 与 idle 两段分别计时：首 token 到达后转 idle 计时。
 *   - 触发一次即止（幂等），stop() 之后不再回调。
 *   - 阈值默认保守（45s / 60s），env 可调但有下限，不接受非法值。
 *   - 接入 ModelGateway 单点后：心跳上游在阈值内判死返回 `stream_stalled`，
 *     正常流零误杀。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const {
  createStreamStallWatchdog,
  resolveStallThresholds,
  RENEWAL_EVENT_TYPES,
  DEFAULT_FIRST_TOKEN_MS,
  DEFAULT_IDLE_TOKEN_MS,
} = require(path.join(ROOT, 'core', 'shared-backend', 'llm-providers', 'stream-stall-watchdog.js'));

/** 可控时钟：注入 now/setTimer/clearTimer，避免真实等待。 */
function makeClock() {
  let now = 0;
  let seq = 0;
  const timers = [];
  return {
    now: () => now,
    setTimer: (fn, ms) => { seq += 1; timers.push({ id: seq, at: now + ms, fn, cleared: false }); return seq; },
    clearTimer: (id) => { const timer = timers.find((item) => item.id === id); if (timer) timer.cleared = true; },
    advance: (ms) => {
      now += ms;
      for (const timer of timers) {
        if (!timer.cleared && timer.at <= now) { timer.cleared = true; timer.fn(); }
      }
    },
  };
}

function makeWatchdog(options = {}) {
  const clock = makeClock();
  const stalls = [];
  const watchdog = createStreamStallWatchdog({
    firstTokenMs: options.firstTokenMs ?? 45_000,
    idleTokenMs: options.idleTokenMs ?? 60_000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onStall: (info) => stalls.push(info),
  });
  return { watchdog, clock, stalls };
}

test('BLOCK-338 续命集合封闭：只有三类 delta 续命（心跳/空 chunk/ping 一律不续命）', () => {
  assert.deepEqual([...RENEWAL_EVENT_TYPES].sort(), ['content_delta', 'thinking_delta', 'tool_call_delta']);

  const { watchdog, clock, stalls } = makeWatchdog({ firstTokenMs: 1000, idleTokenMs: 1000 });
  // 心跳/空/未知事件连发 3 次，累计超过首 token 阈值仍应判死
  watchdog.observe({ type: 'ping' });
  watchdog.observe({ type: 'heartbeat' });
  watchdog.observe({ type: 'content_delta', content: '' });
  clock.advance(999);
  assert.equal(stalls.length, 0, '未到阈值不应触发');
  clock.advance(1);
  assert.equal(stalls.length, 1, '空 content_delta 与心跳不得续命，阈值到点必须触发');
  assert.equal(stalls[0].phase, 'first_token');
  watchdog.stop();
});

test('BLOCK-338 首 token 到达后转 idle 计时；真实 delta 续命', () => {
  const { watchdog, clock, stalls } = makeWatchdog({ firstTokenMs: 1000, idleTokenMs: 2000 });
  watchdog.observe({ type: 'content_delta', content: 'hi' });
  clock.advance(1500);
  assert.equal(stalls.length, 0, '已有首 token 且 idle 未到 2s');
  watchdog.observe({ type: 'thinking_delta' });
  clock.advance(1500);
  assert.equal(stalls.length, 0, 'thinking_delta 应续命');
  watchdog.observe({ type: 'tool_call_delta' });
  clock.advance(1999);
  assert.equal(stalls.length, 0, 'tool_call_delta 应续命');
  clock.advance(1);
  assert.equal(stalls.length, 1);
  assert.equal(stalls[0].phase, 'idle');
  assert.ok(Number.isFinite(stalls[0].elapsedMs) && stalls[0].elapsedMs >= 2000, `elapsedMs=${stalls[0].elapsedMs}`);
  watchdog.stop();
});

test('BLOCK-338 触发幂等 + stop() 后不再回调', () => {
  const { watchdog, clock, stalls } = makeWatchdog({ firstTokenMs: 500, idleTokenMs: 500 });
  clock.advance(500);
  assert.equal(stalls.length, 1);
  clock.advance(5000);
  assert.equal(stalls.length, 1, '触发一次即止，不得重复回调');
  watchdog.observe({ type: 'content_delta', content: 'late' });
  clock.advance(5000);
  assert.equal(stalls.length, 1, '已判死后迟到 delta 不得复活');

  const second = makeWatchdog({ firstTokenMs: 500, idleTokenMs: 500 });
  second.watchdog.stop();
  second.clock.advance(5000);
  assert.equal(second.stalls.length, 0, 'stop() 之后不得触发');
});

test('BLOCK-338 阈值解析：保守默认 + env 覆盖 + 下限与非法值回落', () => {
  assert.equal(DEFAULT_FIRST_TOKEN_MS, 45_000);
  assert.equal(DEFAULT_IDLE_TOKEN_MS, 60_000);
  assert.deepEqual(resolveStallThresholds({}), { firstTokenMs: 45_000, idleTokenMs: 60_000 });
  assert.deepEqual(
    resolveStallThresholds({ PETRI_STREAM_STALL_FIRST_MS: '30000', PETRI_STREAM_STALL_IDLE_MS: '90000' }),
    { firstTokenMs: 30_000, idleTokenMs: 90_000 }
  );
  // 非法/过低值回落默认（不可关到无穷、不可设 0）
  assert.deepEqual(resolveStallThresholds({ PETRI_STREAM_STALL_FIRST_MS: '0', PETRI_STREAM_STALL_IDLE_MS: 'abc' }),
    { firstTokenMs: 45_000, idleTokenMs: 60_000 });
  assert.deepEqual(resolveStallThresholds({ PETRI_STREAM_STALL_FIRST_MS: '10' }),
    { firstTokenMs: 45_000, idleTokenMs: 60_000 }, '低于下限不接受');
});

// ---------------------------------------------------------------------------
// 接入面：ModelGateway 单点（假 provider 驱动，不经网络）
// ---------------------------------------------------------------------------

function makeGateway(chatStreamImpl) {
  const { ModelGateway } = require(path.join(ROOT, 'core', 'shared-backend', 'llm-providers', 'model-gateway.js'));
  const profile = {
    id: 'p_stall_test',
    provider: 'deepseek',
    protocol: 'openai',
    model: 'stall-test-model',
    baseUrl: 'http://127.0.0.1:9',
    capabilities: {},
  };
  return new ModelGateway({
    getSettings: () => ({ model_role_bindings: { chat: profile.id }, model_profiles: [profile] }),
    getCredential: () => 'sk-test',
    getProvider: (name) => (name === profile.provider ? { chatStream: chatStreamImpl } : null),
    recordRouting() {},
    recordTranscript() {},
  });
}

test('BLOCK-338 接入：心跳上游在阈值内判死为 stream_stalled(first_token)', async () => {
  // 1s = 合法下限（低于此值按默认保守阈值，不可关到无穷）
  process.env.PETRI_STREAM_STALL_FIRST_MS = '1000';
  process.env.PETRI_STREAM_STALL_IDLE_MS = '1000';
  try {
    const gateway = makeGateway((apiKey, body, telemetry, onEvent) => new Promise((resolve) => {
      // 只发心跳类事件，永不结束
      const timer = setInterval(() => { onEvent({ type: 'ping' }); }, 20);
      setTimeout(() => { clearInterval(timer); resolve({ error: 'aborted', message: '请求已取消' }); }, 2200);
    }));

    const events = [];
    const result = await gateway.chat({ role: 'chat', body: { messages: [{ role: 'user', content: 'hi' }] }, onEvent: (event) => events.push(event) });
    assert.equal(result.error, 'stream_stalled', `期望 stream_stalled，实际 ${result.error}（${result.message}）`);
    assert.equal(result.phase, 'first_token');
    assert.ok(Number.isFinite(result.elapsedMs), 'stall 事件必须带 elapsedMs');
    assert.equal(events.filter((event) => event.type === 'content_delta').length, 0, '不得伪造 token');
  } finally {
    delete process.env.PETRI_STREAM_STALL_FIRST_MS;
    delete process.env.PETRI_STREAM_STALL_IDLE_MS;
  }
});

test('BLOCK-338 接入：中途静默判死为 stream_stalled(idle)，已出 token 不删', async () => {
  process.env.PETRI_STREAM_STALL_FIRST_MS = '1000';
  process.env.PETRI_STREAM_STALL_IDLE_MS = '1000';
  try {
    const gateway = makeGateway((apiKey, body, telemetry, onEvent) => new Promise((resolve) => {
      onEvent({ type: 'content_delta', content: 'hi' });
      const timer = setInterval(() => { onEvent({ type: 'ping' }); }, 20);
      setTimeout(() => { clearInterval(timer); resolve({ error: 'aborted', message: '请求已取消' }); }, 2200);
    }));

    const events = [];
    const result = await gateway.chat({ role: 'chat', body: { messages: [{ role: 'user', content: 'hi' }] }, onEvent: (event) => events.push(event) });
    assert.equal(result.error, 'stream_stalled');
    assert.equal(result.phase, 'idle');
    assert.equal(events.filter((event) => event.type === 'content_delta').length, 1, '已产出的 token 不得被回滚');
  } finally {
    delete process.env.PETRI_STREAM_STALL_FIRST_MS;
    delete process.env.PETRI_STREAM_STALL_IDLE_MS;
  }
});

test('BLOCK-338 P2：首 token stall 自动重试一次（idle 不重试，二次仍 stall 不无限重试）', async () => {
  const { modelGateway, callChatProvider } = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'llm-client.js'));
  const originalChat = modelGateway.chat;
  const originalConfig = modelGateway.getConfig;
  const calls = [];
  try {
    modelGateway.getConfig = () => ({ profiles: [] });

    modelGateway.chat = async () => {
      calls.push(1);
      return calls.length === 1
        ? { error: 'stream_stalled', phase: 'first_token', elapsedMs: 1200 }
        : { choices: [{ message: { role: 'assistant', content: 'ok' } }] };
    };
    const recovered = await callChatProvider('deepseek', 'sk', { messages: [] }, {}, () => {});
    assert.equal(recovered.error, undefined, '首 token stall 重试成功后应返回正常结果');
    assert.equal(calls.length, 2, '应恰好重试一次');

    calls.length = 0;
    modelGateway.chat = async () => {
      calls.push(1);
      return { error: 'stream_stalled', phase: 'idle', elapsedMs: 1300 };
    };
    const idle = await callChatProvider('deepseek', 'sk', { messages: [] }, {}, () => {});
    assert.equal(idle.phase, 'idle');
    assert.equal(calls.length, 1, 'idle 段已有输出，不得重试（避免重复内容）');

    calls.length = 0;
    modelGateway.chat = async () => {
      calls.push(1);
      return { error: 'stream_stalled', phase: 'first_token', elapsedMs: 1200 };
    };
    const twice = await callChatProvider('deepseek', 'sk', { messages: [] }, {}, () => {});
    assert.equal(twice.error, 'stream_stalled');
    assert.equal(calls.length, 2, '第二次仍 stall 直接返回，不无限重试');
  } finally {
    modelGateway.chat = originalChat;
    modelGateway.getConfig = originalConfig;
  }
});

test('BLOCK-338 P2：首 token stall 不发 error 事件（留给重试），idle stall 照发', async () => {
  const events = [];
  const firstTokenGateway = makeGateway(() => Promise.resolve({ error: 'stream_stalled', phase: 'first_token', elapsedMs: 1200 }));
  await firstTokenGateway.chat({ role: 'chat', body: { messages: [] }, onEvent: (event) => events.push(event) });
  assert.equal(events.filter((event) => event.type === 'error').length, 0, '可重试的 stall 不应先给前端报错');

  const idleGateway = makeGateway(() => Promise.resolve({ error: 'stream_stalled', phase: 'idle', elapsedMs: 1300 }));
  await idleGateway.chat({ role: 'chat', body: { messages: [] }, onEvent: (event) => events.push(event) });
  assert.equal(events.filter((event) => event.type === 'error').length, 1, 'idle stall 应发诚实 error 事件');
});

test('BLOCK-338 接入：正常流零误杀（阈值内持续出 token 时不得判死）', async () => {
  process.env.PETRI_STREAM_STALL_FIRST_MS = '1000';
  process.env.PETRI_STREAM_STALL_IDLE_MS = '1000';
  try {
    const gateway = makeGateway((apiKey, body, telemetry, onEvent) => new Promise((resolve) => {
      let count = 0;
      const timer = setInterval(() => {
        count += 1;
        onEvent({ type: 'content_delta', content: `t${count}` });
        if (count >= 5) {
          clearInterval(timer);
          resolve({ choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
        }
      }, 150);
    }));

    const events = [];
    const result = await gateway.chat({ role: 'chat', body: { messages: [{ role: 'user', content: 'hi' }] }, onEvent: (event) => events.push(event) });
    assert.equal(result.error, undefined, `正常流被误杀：${result.error} ${result.message || ''}`);
    assert.equal(events.filter((event) => event.type === 'content_delta').length, 5);
  } finally {
    delete process.env.PETRI_STREAM_STALL_FIRST_MS;
    delete process.env.PETRI_STREAM_STALL_IDLE_MS;
  }
});
