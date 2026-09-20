/**
 * BLOCK-56 P1 — 模型降级（model fallback）定向测试。
 *
 * 覆盖：
 * - 纯策略：classifyDegradableError 三类可降级 / 不可降级 / InvalidRequest 包裹超限仍可降级
 * - 纯策略：resolveTaskFallbackProfile 启用开关 / 排除主 profile / 跳过无效候选 / 角色绑定
 * - 纯策略：buildFallbackResumeMessages 保留原消息 + 注入恢复指令 + 降级注明要求
 * - 编排：maybeLaunchTaskLevelFallback 三重闸（not_primary / fallback_already_used /
 *   already_resumed）+ 不可降级诚实失败 + 未配置备用诚实失败
 * - 编排：成功路径 —— 原 task 保持 failed、新 task 带 fallbackOfTaskId/resumeOfTaskId、
 *   model_fallback 溯源事件落原 task、runAgentLoop 以 disableProviderFallback=true 拉起
 */
import { after, test } from 'node:test';
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

// db / store 必须在 env 设置后加载（BIOF3_DB_PATH 单例解析）
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-block56-'));
process.env.BIOF3_DB_PATH = path.join(tmpRoot, 'agent-tasks.db');
process.env.BIOF3_LOCAL_DATA_DIR = path.join(tmpRoot, 'local-data');

const {
  classifyDegradableError,
  resolveTaskFallbackProfile,
  buildFallbackResumeMessages,
} = require(resolve('core/biof3-server/helpers/model-fallback-policy'));
const { maybeLaunchTaskLevelFallback } = require(resolve('core/biof3-server/helpers/agent-fallback'));
const agentTaskStore = require(resolve('core/biof3-server/agent-task-store'));

const USER_ID = 'u_b56';

// ---------- 纯策略：classifyDegradableError ----------

test('classify: 三类可降级错误（context_window / quota / server）', () => {
  assert.deepEqual(classifyDegradableError("This model's maximum context length is 128000 tokens"), {
    degradable: true,
    category: 'context_window',
  });
  assert.deepEqual(classifyDegradableError('context_length_exceeded: reduce the length of messages'), {
    degradable: true,
    category: 'context_window',
  });
  assert.deepEqual(classifyDegradableError('Usage limit reached for this organization'), {
    degradable: true,
    category: 'quota',
  });
  assert.deepEqual(classifyDegradableError('insufficient_quota: You exceeded your current quota'), {
    degradable: true,
    category: 'quota',
  });
  assert.deepEqual(classifyDegradableError('The server is overloaded. Please try again later.'), {
    degradable: true,
    category: 'server',
  });
  assert.deepEqual(classifyDegradableError('HTTP 503 Service Unavailable'), {
    degradable: true,
    category: 'server',
  });
  assert.deepEqual(classifyDegradableError('429 Too Many Requests'), {
    degradable: true,
    category: 'server',
  });
  assert.deepEqual(classifyDegradableError('network timeout of 30000ms exceeded'), {
    degradable: true,
    category: 'server',
  });
});

test('classify: 不可降级错误诚实失败', () => {
  for (const text of [
    'invalid request: messages must be an array',
    '401 Unauthorized',
    'forbidden: no access to this model',
    'no_api_key: provider credential missing',
    'provider_not_registered: ollama',
    'Request was aborted by the user',
    'cancelled',
  ]) {
    const result = classifyDegradableError(text);
    assert.equal(result.degradable, false, text);
    assert.equal(result.category, null, text);
  }
});

test('classify: InvalidRequest 包裹的 context length（OpenAI 风格 400）仍可降级', () => {
  const result = classifyDegradableError(
    "invalid_request_error: This model's maximum context length is 131072 tokens. However, your messages resulted in 150000 tokens."
  );
  assert.equal(result.degradable, true);
  assert.equal(result.category, 'context_window');
});

test('classify: 空输入与非错误文本', () => {
  assert.deepEqual(classifyDegradableError(null), { degradable: false, category: null });
  assert.deepEqual(classifyDegradableError(''), { degradable: false, category: null });
  const err = new Error('some random failure without keywords');
  assert.deepEqual(classifyDegradableError(err), { degradable: false, category: null });
});

// ---------- 纯策略：resolveTaskFallbackProfile ----------

const CONFIG = {
  fallbackEnabled: true,
  fallbackBindings: { agent: ['agent-b', 'missing-id', 'agent-b2'], chat: ['chat-b'] },
  profiles: [
    { id: 'agent-a', provider: 'p1', model: 'm-a', label: '主模型' },
    { id: 'agent-b', provider: 'p2', model: 'm-b', label: '备用模型B' },
    { id: 'agent-b2', provider: 'p3', model: 'm-b2', label: '备用模型B2' },
    { id: 'chat-b', provider: 'p4', model: 'm-c', label: '备用对话模型' },
  ],
};

test('resolve: 未启用降级 → null', () => {
  assert.equal(resolveTaskFallbackProfile({ ...CONFIG, fallbackEnabled: false }, 'agent-a'), null);
  assert.equal(resolveTaskFallbackProfile(null, 'agent-a'), null);
});

test('resolve: 排除主 profile，返回首个有效备用', () => {
  const profile = resolveTaskFallbackProfile(CONFIG, 'agent-a', 'agent');
  assert.equal(profile.id, 'agent-b');
});

test('resolve: 主 profile 是首个候选时跳过它取下一个有效候选', () => {
  const profile = resolveTaskFallbackProfile(CONFIG, 'agent-b', 'agent');
  assert.equal(profile.id, 'agent-b2');
});

test('resolve: 角色隔离 —— chat 绑定不会用于 agent 角色', () => {
  const chatProfile = resolveTaskFallbackProfile(CONFIG, 'agent-a', 'chat');
  assert.equal(chatProfile.id, 'chat-b');
  const noneProfile = resolveTaskFallbackProfile(CONFIG, 'agent-a', 'embedding');
  assert.equal(noneProfile, null);
});

// ---------- 纯策略：buildFallbackResumeMessages ----------

test('resume messages: 保留原消息 + 尾部注入恢复指令', () => {
  const original = [
    { role: 'user', content: '帮我分析这个数据集' },
    { role: 'assistant', content: '好的，我先读取数据' },
  ];
  const messages = buildFallbackResumeMessages(original, '已执行 workspace_read×2', {
    reason: 'The server is overloaded',
    label: '备用模型B',
  });
  assert.equal(messages.length, 3);
  assert.deepEqual(messages[0], original[0]);
  assert.deepEqual(messages[1], original[1]);
  assert.equal(messages[2].role, 'user');
  assert.match(messages[2].content, /系统注入，非用户输入/);
  assert.match(messages[2].content, /备用模型B/);
  assert.match(messages[2].content, /The server is overloaded/);
  assert.match(messages[2].content, /已执行 workspace_read×2/);
  assert.match(messages[2].content, /降级生成/);
});

// ---------- 编排：maybeLaunchTaskLevelFallback ----------

function seedTask(overrides = {}) {
  const { taskId: _ignored, ...paramOverrides } = overrides;
  const created = agentTaskStore.createAgentTask({
    userId: USER_ID,
    params: {
      messages: [{ role: 'user', content: '原始任务消息' }],
      conversationId: 'conv-b56',
      context: { page: 'chat', projectId: 'proj-b56' },
      kind: 'primary',
      ...paramOverrides,
    },
  });
  return created.taskId;
}

const FALLBACK_CONFIG = {
  fallbackEnabled: true,
  fallbackBindings: { agent: ['agent-b'] },
  profiles: [{ id: 'agent-b', provider: 'p2', model: 'm-b', label: '备用模型B' }],
};

test('gate: 非 primary 任务不自动降级', () => {
  const taskId = seedTask();
  const outcome = maybeLaunchTaskLevelFallback({
    taskId, error: 'The server is overloaded', kind: 'subagent', emit: () => {},
  }, { gatewayConfig: FALLBACK_CONFIG, runAgentLoop: async () => {} });
  assert.equal(outcome.launched, false);
  assert.equal(outcome.reason, 'not_primary');
});

test('gate: 已发生过请求级降级 → 单级不连环', () => {
  const taskId = seedTask();
  const outcome = maybeLaunchTaskLevelFallback({
    taskId, error: 'The server is overloaded', kind: 'primary', modelFallbackOccurred: true, emit: () => {},
  }, { gatewayConfig: FALLBACK_CONFIG, runAgentLoop: async () => {} });
  assert.equal(outcome.launched, false);
  assert.equal(outcome.reason, 'fallback_already_used');
});

test('gate: 已是续跑任务（resumeOfTaskId）→ 不再触发', () => {
  const taskId = seedTask({ resumeOfTaskId: 't_earlier' });
  const outcome = maybeLaunchTaskLevelFallback({
    taskId, error: 'The server is overloaded', kind: 'primary', emit: () => {},
  }, { gatewayConfig: FALLBACK_CONFIG, runAgentLoop: async () => {} });
  assert.equal(outcome.launched, false);
  assert.equal(outcome.reason, 'already_resumed');
});

test('gate: 不可降级错误 → 诚实失败零回归', () => {
  const taskId = seedTask();
  const outcome = maybeLaunchTaskLevelFallback({
    taskId, error: '401 Unauthorized', kind: 'primary', emit: () => {},
  }, { gatewayConfig: FALLBACK_CONFIG, runAgentLoop: async () => {} });
  assert.equal(outcome.launched, false);
  assert.equal(outcome.reason, 'not_degradable');
});

test('gate: 未启用降级配置 → 诚实失败零回归', () => {
  const taskId = seedTask();
  const outcome = maybeLaunchTaskLevelFallback({
    taskId, error: 'The server is overloaded', kind: 'primary', emit: () => {},
  }, { gatewayConfig: { fallbackEnabled: false }, runAgentLoop: async () => {} });
  assert.equal(outcome.launched, false);
  assert.equal(outcome.reason, 'no_fallback_profile');
});

test('成功路径: 新任务降级续跑 + 溯源事件 + disableProviderFallback', async () => {
  const taskId = seedTask();
  // 真实流程：agent-runner 先将原 task 置 failed，再尝试降级
  agentTaskStore.markAgentTaskFailed(taskId, 'The server is overloaded. Please try again later.');
  // 原任务落一条工具进度事件，供 buildProgressDigest 摘要
  try {
    agentTaskStore.appendAgentTaskEvent(taskId, 1, 'tool_activity', {
      tool: 'workspace_read', summary: '读取 data.csv',
    });
  } catch { /* append API 形态差异不阻塞本断言 */ }

  const events = [];
  const loopCalls = [];
  let resolveLoop;
  const loopCalled = new Promise((r) => { resolveLoop = r; });

  const outcome = maybeLaunchTaskLevelFallback({
    taskId,
    error: 'The server is overloaded. Please try again later.',
    kind: 'primary',
    previousProfileId: 'agent-a',
    emit: (e) => events.push(e),
  }, {
    gatewayConfig: FALLBACK_CONFIG,
    runAgentLoop: (input) => {
      loopCalls.push(input);
      resolveLoop();
      return Promise.resolve();
    },
  });

  assert.equal(outcome.launched, true);
  assert.equal(outcome.category, 'server');
  assert.equal(outcome.toProfileLabel, '备用模型B');
  assert.ok(outcome.newTaskId, '应创建新 task');

  // 溯源事件落原 task emit 通道
  const fallbackEvent = events.find((e) => e.event === 'model_fallback');
  assert.ok(fallbackEvent, '应发 model_fallback 事件');
  assert.equal(fallbackEvent.scope, 'task_level');
  assert.equal(fallbackEvent.fromProfileId, 'agent-a');
  assert.equal(fallbackEvent.toProfileId, 'agent-b');
  assert.equal(fallbackEvent.newTaskId, outcome.newTaskId);
  const statusEvent = events.find((e) => e.event === 'agent_status' && e.phase === 'model_fallback_resumed');
  assert.ok(statusEvent, '应发降级续跑状态事件');

  // 原 task 保持 failed / 新 task 运行中且带溯源
  const original = agentTaskStore.getAgentTask(taskId);
  const resumed = agentTaskStore.getAgentTask(outcome.newTaskId);
  assert.equal(original.status, 'failed');
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.params.fallbackOfTaskId, taskId);
  assert.equal(resumed.params.resumeOfTaskId, taskId);
  assert.equal(resumed.params.providerName, 'p2');
  assert.equal(resumed.params.modelName, 'm-b');

  await loopCalled;
  assert.equal(loopCalls.length, 1);
  assert.equal(loopCalls[0].taskId, outcome.newTaskId);
  assert.equal(loopCalls[0].profileId, 'agent-b');
  assert.equal(loopCalls[0].disableProviderFallback, true, '降级续跑必须关闭请求级 fallback');
  assert.ok(loopCalls[0].messages.some((m) => String(m.content || '').includes('系统注入，非用户输入')));
});

after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});
