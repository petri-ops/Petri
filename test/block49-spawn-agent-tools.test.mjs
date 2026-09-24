import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R_SERVER = resolve(__dirname, '..', 'core', 'biof3-server');
const require = createRequire(import.meta.url);

// 与 agent-tool-registry.test.mjs 同一自举手法：临时 DB（src/migrations 全量），
// BIOF3_DB_PATH 必须在 require db.js 前生效。
{
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const Database = require(R_SERVER + '/node_modules/better-sqlite3');
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-block49-db-'));
  const boot = new Database(path.join(tempDbDir, 'biof3.db'));
  const migrationsDir = resolve(__dirname, '..', 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.BIOF3_DB_PATH = path.join(tempDbDir, 'biof3.db');
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch {}
  });
}

// fail-closed：清空所有 *_API_KEY，确保 spawn 成功路径下的 loop 在无凭据时
// 快速失败落库（不产生真实网络调用）。
for (const key of Object.keys(process.env)) {
  if (/_API_KEY$/.test(key)) delete process.env[key];
}

const { decideAgentToolCall } = require('../core/biof3-server/agent-tools/agent-tool-policy.js');
const { getToolContract } = require('../core/biof3-server/agent-tools/registry.js');
const { spawn_agent, list_agents, wait_agent, __test } = require('../core/biof3-server/agent-tools/spawn-agent-tools.js');
const agentTaskStore = require('../core/biof3-server/agent-task-store.js');
const { getOrCreateActiveConversation, appendMessageToConversation } = require('../core/biof3-server/helpers/conversations.js');
const { aiTaskConcurrencyAcquire, aiTaskConcurrencyRelease } = require('../core/biof3-server/helpers/runtime.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function contractOf(name) {
  return getToolContract(name);
}

function createUser() {
  return 'u49-' + Math.random().toString(36).slice(2, 10);
}

function createPrimaryParent(userId, extraParams = {}) {
  const conv = getOrCreateActiveConversation(userId, { titleHint: 'block49-test' });
  return agentTaskStore.createAgentTask({
    status: 'running',
    agentStatus: 'running',
    userId,
    params: {
      kind: 'primary',
      conversationId: conv.id,
      context: { accessMode: 'full', projectId: null },
      providerName: 'bogus_provider_block49',
      providerLabel: 'Bogus49',
      modelName: 'bogus-model-block49',
      ...extraParams,
    },
  });
}

function createChild(userId, parentTaskId, overrides = {}) {
  return agentTaskStore.createAgentTask({
    status: 'running',
    agentStatus: 'running',
    userId,
    params: {
      kind: 'subagent',
      parentTaskId,
      context: { accessMode: 'full' },
      messages: [{ role: 'user', content: overrides.task || 'block49 子任务' }],
      ...overrides.params,
    },
  });
}

test('BLOCK-49 三工具注册契约：spawn=state-write/R2，list=none/R0，wait=none/R1，新 category', () => {
  assert.equal(contractOf('spawn_agent').category, 'agent-management');
  assert.equal(contractOf('spawn_agent').sideEffect, 'state-write');
  assert.equal(contractOf('spawn_agent').riskTier, 'R2');
  assert.equal(contractOf('list_agents').sideEffect, 'none');
  assert.equal(contractOf('list_agents').riskTier, 'R0');
  assert.equal(contractOf('wait_agent').sideEffect, 'none');
  assert.equal(contractOf('wait_agent').riskTier, 'R1');
});

test('policy fail-closed：spawn_agent 在只读/项目写/禁执行模式下被拒，list/wait 放行', () => {
  const spawnContract = contractOf('spawn_agent');
  const readDenied = decideAgentToolCall({
    name: 'spawn_agent',
    args: { task: 'x' },
    ctx: { accessMode: 'read', allowExecution: true },
    contract: spawnContract,
  });
  assert.equal(readDenied.decision, 'deny');
  assert.equal(readDenied.error, 'access_mode_read_only');

  const wsWriteDenied = decideAgentToolCall({
    name: 'spawn_agent',
    args: { task: 'x' },
    ctx: { accessMode: 'workspace-write', allowExecution: true },
    contract: spawnContract,
  });
  assert.equal(wsWriteDenied.decision, 'deny');
  assert.equal(wsWriteDenied.error, 'access_mode_workspace_write');

  const execDenied = decideAgentToolCall({
    name: 'spawn_agent',
    args: { task: 'x' },
    ctx: { accessMode: 'full', allowExecution: false },
    contract: spawnContract,
  });
  assert.equal(execDenied.decision, 'deny');

  const fullAllowed = decideAgentToolCall({
    name: 'spawn_agent',
    args: { task: 'x' },
    ctx: { accessMode: 'full', allowExecution: true },
    contract: spawnContract,
  });
  assert.equal(fullAllowed.decision, 'allow');

  for (const name of ['list_agents', 'wait_agent']) {
    const allowed = decideAgentToolCall({
      name,
      args: {},
      ctx: { accessMode: 'read', allowExecution: false },
      contract: contractOf(name),
    });
    assert.equal(allowed.decision, 'allow', `${name} 应为只读工具`);
  }
});

test('spawn_agent 参数与父任务校验 fail-closed', async () => {
  const userId = createUser();

  const empty = await spawn_agent({ task: '   ' }, { userId, taskId: 'p-none' });
  assert.equal(empty.ok, false);
  assert.equal(empty.error, 'invalid_arguments');

  const noParent = await spawn_agent({ task: 'x' }, { userId });
  assert.equal(noParent.ok, false);
  assert.equal(noParent.error, 'no_parent');

  const missing = await spawn_agent({ task: 'x' }, { userId, taskId: 'p-not-exist' });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'parent_not_found');

  // 子 agent 不允许再生子 agent
  const primary = createPrimaryParent(userId);
  const child = createChild(userId, primary.taskId);
  const nested = await spawn_agent({ task: 'x' }, { userId, taskId: child.taskId });
  assert.equal(nested.ok, false);
  assert.equal(nested.error, 'parent_not_primary');

  // 父任务已结束
  const finished = createPrimaryParent(userId);
  agentTaskStore.markAgentTaskDone(finished.taskId);
  const doneSpawn = await spawn_agent({ task: 'x' }, { userId, taskId: finished.taskId });
  assert.equal(doneSpawn.ok, false);
  assert.equal(doneSpawn.error, 'parent_not_running');

  // 显式未知 model → fail-closed
  const parent = createPrimaryParent(userId);
  const badModel = await spawn_agent({ task: 'x', model: 'no-such-model-49' }, { userId, taskId: parent.taskId });
  assert.equal(badModel.ok, false);
  assert.equal(badModel.error, 'invalid_arguments');
});

test('spawn_agent 成功路径：进程内建 subagent 任务 + 权限继承 + 无凭据快速终态', async () => {
  const userId = createUser();
  const parent = createPrimaryParent(userId, {
    context: { accessMode: 'full', projectId: null, customMarker: 'block49' },
  });

  const res = await spawn_agent({ task: '分析 data.csv 并给出摘要', instructions: '只读操作即可' }, {
    userId,
    taskId: parent.taskId,
    accessMode: 'full',
  });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.kind, 'subagent');

  const child = agentTaskStore.getAgentTask(res.agentId);
  assert.equal(child.params.kind, 'subagent');
  assert.equal(child.params.parentTaskId, parent.taskId);
  assert.equal(child.params.spawnSource, 'tool:spawn_agent');
  assert.equal(child.params.providerName, 'bogus_provider_block49');
  assert.equal(child.params.context.accessMode, 'full');
  assert.equal(child.params.context.customMarker, 'block49');
  assert.match(child.params.messages[0].content, /分析 data\.csv/);
  assert.match(child.params.messages[0].content, /只读操作即可/);

  // 无凭据 + 伪造 provider：loop 应快速失败落库（不挂起、不真实联网）
  const deadline = Date.now() + 30000;
  let task = agentTaskStore.getAgentTask(res.agentId);
  while (task.status === 'running' && Date.now() < deadline) {
    await sleep(250);
    task = agentTaskStore.getAgentTask(res.agentId);
  }
  assert.notEqual(task.status, 'running', '子 agent 应在无凭据时快速终态');
});

test('spawn_agent 并发槽已满时拒绝并标 failed，释放槽位后可再派生', async () => {
  const userId = createUser();
  const parent = createPrimaryParent(userId);

  // 填满子 agent 槽位（isPrimary=false 直至 acquire 失败）
  const fills = [];
  for (let i = 0; i < 16; i++) {
    const r = aiTaskConcurrencyAcquire(userId, `fill-${userId}-${i}`, { isPrimary: false });
    if (!r || r.ok === false) break;
    fills.push(`fill-${userId}-${i}`);
  }
  assert.ok(fills.length > 0, '至少应能占一个子 agent 槽位');

  const denied = await spawn_agent({ task: 'x' }, { userId, taskId: parent.taskId, accessMode: 'full' });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'subagent_concurrency_limit');
  const deniedTask = agentTaskStore.getAgentTask(denied.agentId);
  assert.equal(deniedTask.status, 'failed');

  aiTaskConcurrencyRelease(userId, fills[0]);
  const allowed = await spawn_agent({ task: 'x' }, { userId, taskId: parent.taskId, accessMode: 'full' });
  assert.equal(allowed.ok, true, JSON.stringify(allowed));

  for (const id of fills) aiTaskConcurrencyRelease(userId, id);
});

test('wait_agent 身份与归属校验 fail-closed', async () => {
  const userId = createUser();
  const parent = createPrimaryParent(userId);
  const otherUser = createUser();
  const otherParent = createPrimaryParent(otherUser);

  const missing = await wait_agent({}, { userId, taskId: parent.taskId });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'invalid_arguments');

  const unknown = await wait_agent({ agentId: 'no-such-agent' }, { userId, taskId: parent.taskId });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error, 'agent_not_found');

  const foreign = createChild(otherUser, otherParent.taskId);
  const denied = await wait_agent({ agentId: foreign.taskId }, { userId, taskId: parent.taskId });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'permission_denied');

  // 不是自己派生的子 agent（他人任务挂在同一 userId 下也不可等待）
  const strangerChild = createChild(userId, otherParent.taskId);
  const notChild = await wait_agent({ agentId: strangerChild.taskId }, { userId, taskId: parent.taskId });
  assert.equal(notChild.ok, false);
  assert.equal(notChild.error, 'agent_not_child');
});

test('wait_agent 终态子 agent 立即返回摘要（正文 + filesChanged），running 子 agent 超时返回 wait_timeout', async () => {
  const userId = createUser();
  const parent = createPrimaryParent(userId);

  const doneChild = createChild(userId, parent.taskId, { task: '汇总统计结果' });
  appendMessageToConversation(
    getOrCreateActiveConversation(userId, {}).id,
    'assistant',
    '统计完成：共 3 个文件，均值 0.98。',
    {},
    doneChild.taskId
  );
  agentTaskStore.markAgentTaskDone(doneChild.taskId, ['results/summary.csv']);

  const done = await wait_agent({ agentId: doneChild.taskId }, { userId, taskId: parent.taskId });
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.status, 'completed');
  assert.match(done.summary.assistantText, /统计完成/);
  assert.deepEqual(done.summary.filesChanged, ['results/summary.csv']);
  assert.equal(done.summary.task, '汇总统计结果');

  // 失败子 agent：摘要携带 error
  const failedChild = createChild(userId, parent.taskId);
  agentTaskStore.markAgentTaskFailed(failedChild.taskId, '模型凭据缺失');
  const failed = await wait_agent({ agentId: failedChild.taskId }, { userId, taskId: parent.taskId });
  assert.equal(failed.ok, true);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.summary.error, '模型凭据缺失');

  // running 子 agent + 最小超时 → wait_timeout（不终止子任务本身）
  const runningChild = createChild(userId, parent.taskId);
  const timedOut = await wait_agent({ agentId: runningChild.taskId, timeout: 1000 }, { userId, taskId: parent.taskId });
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.error, 'wait_timeout');
  assert.equal(timedOut.status, 'running');
  const stillRunning = agentTaskStore.getAgentTask(runningChild.taskId);
  assert.equal(stillRunning.status, 'running');
});

test('list_agents 列出当前任务派生的全部子 agent（含终态），不混入他人子 agent', async () => {
  const userId = createUser();
  const parent = createPrimaryParent(userId);
  const otherParent = createPrimaryParent(createUser());

  const noCtx = await list_agents({}, {});
  assert.equal(noCtx.ok, false);
  assert.equal(noCtx.error, 'no_parent');

  createChild(userId, parent.taskId, { task: '子任务一' });
  const second = createChild(userId, parent.taskId, { task: '子任务二' });
  agentTaskStore.markAgentTaskDone(second.taskId);
  createChild(userId, otherParent.taskId, { task: '他人子任务' });

  const list = await list_agents({}, { userId, taskId: parent.taskId });
  assert.equal(list.ok, true);
  assert.equal(list.agents.length, 2);
  assert.deepEqual(list.agents.map((a) => a.task).sort(), ['子任务一', '子任务二']);
  assert.ok(list.agents.every((a) => a.agentId && a.status));
  const doneEntry = list.agents.find((a) => a.task === '子任务二');
  assert.equal(doneEntry.status, 'completed');
});

test('纯函数边界：timeout 夹取与摘要 token 预算截断', () => {
  const { clampWaitTimeoutMs, truncateToTokenBudget } = __test;
  assert.equal(clampWaitTimeoutMs(undefined), 300000);
  assert.equal(clampWaitTimeoutMs(0), 1000);
  assert.equal(clampWaitTimeoutMs(-5), 1000);
  assert.equal(clampWaitTimeoutMs(999999999), 600000);
  assert.equal(clampWaitTimeoutMs('5000'), 5000);

  const short = truncateToTokenBudget('短文本');
  assert.equal(short.truncated, false);
  assert.equal(short.text, '短文本');

  const long = truncateToTokenBudget('词'.repeat(60000), 100);
  assert.equal(long.truncated, true);
  assert.ok(long.text.includes('截断'));
});

test('模型可见投影：spawn/list/wait 保留 agentId 等关键字段（block49-live 实机回归）', () => {
  const { serializeToolResultForModel } = require(R_SERVER + '/agent-tools/tool-execution.js');
  const base = { contractVersion: '1.0.0', traceId: 't', callId: 'c', tool: 'spawn_agent' };

  // spawn_agent 成功路径：agentId 若被白名单投影剥掉，模型将无法 wait_agent
  const spawnEnvelope = { ...base, status: 'success', data: { ok: true, agentId: 'agent-1', status: 'running', kind: 'subagent', model: 'm1' } };
  const spawnSeen = JSON.parse(serializeToolResultForModel(spawnEnvelope));
  assert.equal(spawnSeen.data.agentId, 'agent-1');
  assert.equal(spawnSeen.data.status, 'running');
  assert.equal(spawnSeen.data.kind, 'subagent');

  // spawn_agent 并发超槽 fail：extra 携带的 agentId/reason 也要保留（供模型重试/等待）
  const deniedEnvelope = { ...base, status: 'success', data: { ok: false, error: 'subagent_concurrency_limit', message: '满', agentId: 'agent-2', reason: 'limit' } };
  const deniedSeen = JSON.parse(serializeToolResultForModel(deniedEnvelope));
  assert.equal(deniedSeen.data.agentId, 'agent-2');
  assert.equal(deniedSeen.data.reason, 'limit');

  // list_agents：agents 数组保留（含 agentId/status）
  const listEnvelope = { ...base, tool: 'list_agents', status: 'success', data: { ok: true, agents: [{ agentId: 'a1', status: 'done', agentStatus: 'done', task: '任务'.repeat(200) }] } };
  const listSeen = JSON.parse(serializeToolResultForModel(listEnvelope));
  assert.equal(listSeen.data.agents.length, 1);
  assert.equal(listSeen.data.agents[0].agentId, 'a1');
  assert.ok(listSeen.data.agents[0].task.length <= 130);

  // wait_agent：summary 原样保留
  const waitEnvelope = { ...base, tool: 'wait_agent', status: 'success', data: { ok: true, agentId: 'a1', status: 'completed', agentStatus: 'completed', summary: { text: '结论文本' } } };
  const waitSeen = JSON.parse(serializeToolResultForModel(waitEnvelope));
  assert.deepEqual(waitSeen.data.summary, { text: '结论文本' });
});

// ── BLOCK-119 加映 3 — goals 上岗 ──

test('加映 3：spawn_agent goals 落 params + 任务书判据段', async () => {
  const userId = createUser();
  const parent = createPrimaryParent(userId);
  const res = await spawn_agent(
    { task: '核对依赖数量', goals: ['给出 dependencies 总数', '列出 scripts 文件名'] },
    { userId, taskId: parent.taskId }
  );
  assert.equal(res.ok, true);
  const child = agentTaskStore.getAgentTask(res.agentId);
  assert.deepEqual(child.params.goals, ['给出 dependencies 总数', '列出 scripts 文件名']);
  assert.match(child.params.messages[0].content, /【完成判据（终态汇报将逐条核对完备性，未达成会被点名）】/);
  assert.match(child.params.messages[0].content, /1\. 给出 dependencies 总数/);
  assert.match(child.params.messages[0].content, /2\. 列出 scripts 文件名/);
});

test('加映 3：normalizeGoals 校验（fail-closed）', () => {
  const { normalizeGoals } = __test;
  assert.deepEqual(normalizeGoals(undefined).goals, []);
  assert.deepEqual(normalizeGoals([' a ', '', 'b ']).goals, ['a', 'b']);
  assert.equal(normalizeGoals('not-array').ok, false);
  assert.equal(normalizeGoals(['1', '2', '3', '4', '5', '6']).ok, false, '>5 条拒绝');
  assert.equal(normalizeGoals(['x'.repeat(201)]).ok, false, '单条超长拒绝');
});
