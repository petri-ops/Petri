/**
 * BLOCK-112 W1-2 — copilot 发送前意图路由契约（分类接点 + chitchat 快路径）。
 *
 * 契约红线（plan docs/block-112-copilot-intent-routing-plan.md §2/§6）：
 *  - guard 关（BIOF3_JEV_INTENT_ROUTE=1 显式开）＝零出站零行为变化；
 *  - 任何决策失败形态（缺 key/超时/校验失败）＝fastPath=false 回退现行 runAgentLoop，永不 throw；
 *  - 分流仅当 argmax=chitchat 且 confidence ≥ INTENT_ROUTE_THRESHOLD（D-3 θ=0.70）；
 *  - 快路径事件契约逐字镜像 agent-runner：run_started → delta(choices[0].delta.content) →
 *    markAgentTaskDone；模型直答失败发生在任何事件落库之前（调用方安全回退窗口）。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const {
  INTENT_ROUTE_THRESHOLD,
  INTENT_CLASSES,
  buildIntentDecisionRequest,
  isIntentRouteEnabled,
  shouldUseChitchatFastPath,
} = require(path.join(root, 'core', 'biof3-server', 'helpers', 'intent-router.js'));
const { runChitchatFastPath, CHITCHAT_SYSTEM_PROMPT } = require(path.join(root, 'core', 'biof3-server', 'helpers', 'chitchat-fast-path.js'));

const NO_SLEEP = async () => {};
const GUARD_ON = { BIOF3_JEV_INTENT_ROUTE: '1' };
const API_KEY_OVERRIDE = { apiKey: 'test-key-do-not-call-real-api' };

function useEnv(t, env) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  t.after(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

/** 成功响应桩：固定 answers.intent。 */
function okFetch(answer) {
  let calls = 0;
  const impl = async () => {
    calls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ model: 'jev-1.13.0', answers: { intent: answer } }),
    };
  };
  return { impl, count: () => calls };
}

function errorFetch(name) {
  let calls = 0;
  const impl = async () => {
    calls++;
    const err = new Error(name);
    err.name = name;
    throw err;
  };
  return { impl, count: () => calls };
}

test('D-1/D-3 定版契约：四类目 + θ=0.70', () => {
  assert.deepEqual(Object.keys(INTENT_CLASSES).sort(), ['chitchat', 'knowledge_qa', 'result_studio', 'task']);
  assert.equal(INTENT_ROUTE_THRESHOLD, 0.7, 'P0 校准 θ 定版（调整须先重校准）');
});

test('buildIntentDecisionRequest：state 截 600 字 + criteria 与类目集一致（校准同形）', () => {
  const { state, questions } = buildIntentDecisionRequest('你好呀');
  assert.match(state, /你好呀/);
  assert.match(state, /聊天框/);
  assert.equal(questions.intent.type, 'choice');
  assert.deepEqual(Object.keys(questions.intent.criteria), Object.keys(INTENT_CLASSES));
});

test('guard 默认关：零出站零行为变化（D-4）', async (t) => {
  useEnv(t, { BIOF3_JEV_INTENT_ROUTE: undefined });
  const spy = errorFetch('TimeoutError');
  const r = await shouldUseChitchatFastPath('你好呀', { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(isIntentRouteEnabled(), false);
  assert.equal(r.fastPath, false);
  assert.equal(r.reason, 'guard_disabled');
  assert.equal(r.decisioned, false);
  assert.equal(spy.count(), 0, 'guard 关必须零出站');
});

test('guard 开 + 缺 key：no_key 回退现行 loop', async (t) => {
  useEnv(t, { ...GUARD_ON, TYPESAFE_API_KEY: undefined });
  const r = await shouldUseChitchatFastPath('你好呀', {});
  assert.equal(r.fastPath, false);
  assert.equal(r.reason, 'no_key');
});

test('guard 开 + 超时：timeout 回退现行 loop', async (t) => {
  useEnv(t, GUARD_ON);
  const spy = errorFetch('TimeoutError');
  const r = await shouldUseChitchatFastPath('你好呀', { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(r.reason, 'timeout');
  assert.equal(r.fastPath, false);
  assert.equal(spy.count(), 3, 'wrapper 默认重试 3 次');
});

test('红线：choice 不在类目集内必拒（伪造类目）', async (t) => {
  useEnv(t, GUARD_ON);
  const probs = {};
  for (const k of Object.keys(INTENT_CLASSES)) probs[k] = 0.25;
  const spy = okFetch({ choice: '虚构类目', probabilities: probs, confidence: 0.99 });
  const r = await shouldUseChitchatFastPath('你好呀', { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(r.reason, 'invalid_response', '伪造类目须被 wrapper 响应校验拒收');
  assert.equal(r.fastPath, false);
});

test('采纳：chitchat + conf ≥ 0.70 → fastPath true', async (t) => {
  useEnv(t, GUARD_ON);
  const probs = { chitchat: 0.85, task: 0.05, knowledge_qa: 0.05, result_studio: 0.05 };
  const spy = okFetch({ choice: 'chitchat', probabilities: probs, confidence: 0.9 });
  const r = await shouldUseChitchatFastPath('你好呀', { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(r.fastPath, true);
  assert.equal(r.reason, 'adopted');
  assert.equal(r.intent, 'chitchat');
  assert.equal(r.confidence, 0.9);
});

test('低置信：chitchat + conf < 0.70 → 回退现行 loop', async (t) => {
  useEnv(t, GUARD_ON);
  const probs = { chitchat: 1, task: 0, knowledge_qa: 0, result_studio: 0 };
  const spy = okFetch({ choice: 'chitchat', probabilities: probs, confidence: 0.5 });
  const r = await shouldUseChitchatFastPath('帮我跑个 DEG', { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(r.fastPath, false);
  assert.equal(r.reason, 'below_threshold');
});

test('非 chitchat 类：task + 高置信 → 回退现行 loop', async (t) => {
  useEnv(t, GUARD_ON);
  const probs = { chitchat: 0.02, task: 0.9, knowledge_qa: 0.04, result_studio: 0.04 };
  const spy = okFetch({ choice: 'task', probabilities: probs, confidence: 0.99 });
  const r = await shouldUseChitchatFastPath('帮我跑个 DEG', { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(r.fastPath, false);
  assert.equal(r.reason, 'intent_task');
});

// ---------- chitchat 快路径 ----------

function makeFakeStore() {
  const events = [];
  return {
    events,
    doneCalls: [],
    appendAgentTaskEvent(taskId, seq, eventType, payload) {
      events.push({ taskId, seq, eventType, payload });
    },
    markAgentTaskDone(taskId, filesChanged) {
      this.doneCalls.push({ taskId, filesChanged });
    },
  };
}

function makeFakeConv() {
  const appended = [];
  return {
    appended,
    appendMessageToConversation(convId, role, content, meta) {
      appended.push({ convId, role, content, meta });
    },
  };
}

test('快路径：直答成功 → run_started/delta 事件形状镜像 agent-runner + 终态 + 会话落库', async () => {
  const store = makeFakeStore();
  const conv = makeFakeConv();
  const modelCalls = [];
  const text = await runChitchatFastPath(
    {
      taskId: 'task-1',
      effectiveMessages: [
        { role: 'user', content: '你好呀' },
      ],
      _activeConv: { id: 'conv-1' },
    },
    {
      store,
      conv,
      modelCall: async ({ historyMessages }) => {
        modelCalls.push(historyMessages);
        return '你好！我在呢～今天想聊点什么？';
      },
    }
  );
  assert.match(text, /你好/);
  assert.equal(store.events.length, 2);
  assert.equal(store.events[0].eventType, 'run_started');
  assert.equal(store.events[0].payload.event, 'run_started');
  assert.equal(store.events[0].payload.taskId, 'task-1');
  assert.equal(store.events[1].eventType, 'delta');
  assert.equal(store.events[1].payload.choices[0].delta.content, text, 'delta 载荷形状＝choices[0].delta.content');
  assert.deepEqual(store.doneCalls, [{ taskId: 'task-1', filesChanged: [] }], '终态＝markAgentTaskDone');
  assert.deepEqual(conv.appended, [{ convId: 'conv-1', role: 'assistant', content: text, meta: { chitchatFastPath: true } }]);
  assert.deepEqual(
    modelCalls[0],
    [{ role: 'user', content: '你好呀' }],
    'historyMessages＝组装消息尾部（system 提示词由生产通道注入）'
  );
});

test('快路径失败语义：模型 throw 发生在任何事件落库之前（调用方安全回退窗口）', async () => {
  const store = makeFakeStore();
  const conv = makeFakeConv();
  await assert.rejects(
    runChitchatFastPath(
      { taskId: 'task-2', effectiveMessages: [{ role: 'user', content: 'hi' }], _activeConv: { id: 'conv-2' } },
      { store, conv, modelCall: async () => { throw new Error('模型不可用'); } }
    ),
    /模型不可用/
  );
  assert.equal(store.events.length, 0, '失败必须零事件落库（无 seq 冲突，可安全回退 loop）');
  assert.equal(store.doneCalls.length, 0);
  assert.equal(conv.appended.length, 0);
});

test('快路径：尾部历史截断 ≤8 条', async () => {
  const store = makeFakeStore();
  const conv = makeFakeConv();
  const long = [];
  for (let i = 0; i < 20; i++) long.push({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` });
  let captured = null;
  await runChitchatFastPath(
    { taskId: 'task-3', effectiveMessages: long, _activeConv: { id: 'conv-3' } },
    {
      store, conv,
      modelCall: async ({ historyMessages }) => { captured = historyMessages; return 'ok'; },
    }
  );
  assert.equal(captured.length, 8, '轻量历史截断 8 条');
  assert.equal(captured[captured.length - 1].content, 'm19', '保留最近一条');
});

test('快路径系统提示词：陪伴面 + 禁工具（D-5）', () => {
  assert.match(CHITCHAT_SYSTEM_PROMPT, /不要调用工具/);
  assert.match(CHITCHAT_SYSTEM_PROMPT, /格物/);
});
