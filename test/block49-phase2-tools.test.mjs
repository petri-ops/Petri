'use strict';

/**
 * BLOCK-49 二期 — 多智能体协作三工具单测：interrupt_agent / send_message /
 * followup_task（registry 契约 + 政策矩阵 + handler 行为）。
 *
 * agent-runner 以 require-cache 假件注入（followup 启动不触发真实模型），
 * 记录启动参数供组合断言。DB 为临时自举库（存量基建同款）。
 */

import assert from 'node:assert/strict';
import { test, describe, before, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R_SERVER = path.resolve(__dirname, '..', 'core', 'biof3-server');
const require = createRequire(import.meta.url);

// 临时 DB 自举（须在 require db.js 前生效）
{
  const Database = require(path.join(R_SERVER, 'node_modules', 'better-sqlite3'));
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-block49p2-db-'));
  const boot = new Database(path.join(tempDbDir, 'biof3.db'));
  const migrationsDir = path.resolve(__dirname, '..', 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.BIOF3_DB_PATH = path.join(tempDbDir, 'biof3.db');
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch {}
  });
}

// ── agent-runner 假件注入（followup 启动不触真实模型；记录启动参数）────
const runnerPath = require.resolve(path.join(R_SERVER, 'agent-runner.js'));
const fakeRunnerState = { launches: [] };
require.cache[runnerPath] = {
  id: runnerPath,
  filename: runnerPath,
  loaded: true,
  exports: {
    runAgentLoop: async (opts) => {
      fakeRunnerState.launches.push({
        messages: opts.messages,
        taskId: opts.taskId,
        kind: opts.kind,
        parentLoopRunId: opts.parentLoopRunId ?? null,
      });
      return { assistantText: 'fake-ok' };
    },
  },
};

const agentTaskStore = require(path.join(R_SERVER, 'agent-task-store.js'));
const { getToolContract, getToolRegistry } = require(path.join(R_SERVER, 'agent-tools', 'registry.js'));
const { decideAgentToolCall } = require(path.join(R_SERVER, 'agent-tools', 'agent-tool-policy.js'));
const { executeToolCall } = require(path.join(R_SERVER, 'agent-tools', 'index.js'));
const spawnTools = require(path.join(R_SERVER, 'agent-tools', 'spawn-agent-tools.js'));

const USER = 'u_p2';
let PARENT_ID = null;
const childCtx = () => ({ taskId: PARENT_ID, userId: USER, accessMode: 'full' });

/** 真实 store 调用造任务（id 由 store 生成并返回）。 */
function spawnTask({ kind, parentTaskId = null, content = '任务' }) {
  return agentTaskStore.createAgentTask({
    status: 'running',
    agentStatus: 'running',
    userId: USER,
    params: {
      messages: [{ role: 'user', content }],
      context: { accessMode: 'full' },
      kind,
      ...(parentTaskId ? { parentTaskId } : {}),
    },
  }).taskId;
}

before(() => {
  PARENT_ID = spawnTask({ kind: 'primary', content: '父任务' });
});

// ── 注册表契约 + 政策矩阵 ───────────────────────────────────────

describe('注册表与政策矩阵', () => {
  const expectations = {
    interrupt_agent: { category: 'agent-management', sideEffect: 'state-write', riskTier: 'R2' },
    send_message: { category: 'agent-management', sideEffect: 'state-write', riskTier: 'R1' },
    followup_task: { category: 'agent-management', sideEffect: 'state-write', riskTier: 'R2' },
  };

  test('三工具契约与 schema/handler 注册', () => {
    const registry = getToolRegistry();
    for (const [name, want] of Object.entries(expectations)) {
      const entry = registry.find((item) => item.definition?.function?.name === name);
      assert.ok(entry, `${name} 未注册`);
      assert.equal(typeof entry.handler, 'function', `${name} handler 缺失`);
      assert.ok(entry.definition.function.parameters, `${name} schema 缺失`);
      assert.equal(entry.contract.category, want.category, `${name} category`);
      assert.equal(entry.contract.sideEffect, want.sideEffect, `${name} sideEffect`);
      assert.equal(entry.contract.riskTier, want.riskTier, `${name} riskTier`);
    }
  });

  test('政策矩阵：三工具与 spawn_agent 同门（read/planMode/ws-write 拒，full 放行）', () => {
    for (const name of Object.keys(expectations)) {
      const c = getToolContract(name);
      const decide = (ctx) => decideAgentToolCall({ name, args: {}, ctx, contract: c });
      assert.equal(decide({ accessMode: 'full' }).decision, 'allow', `${name}@full`);
      assert.equal(decide({ accessMode: 'read' }).decision, 'deny', `${name}@read`);
      assert.equal(decide({ accessMode: 'full', planMode: true }).decision, 'deny', `${name}@planMode`);
      assert.equal(decide({ accessMode: 'workspace-write' }).decision, 'deny', `${name}@ws-write`);
    }
  });
});

// ── interrupt_agent ─────────────────────────────────────────────

describe('interrupt_agent', () => {
  test('非本任务子 agent → not_your_agent（fail-closed）', async () => {
    const res = await spawnTools.interrupt_agent({ agentId: 'task_stranger' }, childCtx());
    assert.equal(res.ok, false);
    assert.equal(res.error, 'not_your_agent');
  });

  test('运行中子 agent → cancel_requested（级联 id 回传）+ 事件流审计', async () => {
    const childId = spawnTask({ kind: 'subagent', parentTaskId: PARENT_ID, content: '长任务' });
    const res = await spawnTools.interrupt_agent({ agentId: childId }, childCtx());
    assert.equal(res.ok, true);
    assert.equal(res.agentStatus, 'cancel_requested');
    assert.ok(res.cancelledTaskIds.includes(childId));
    const events = agentTaskStore.getAgentTaskEventsSince(childId, 0, 100);
    assert.ok(events.some((e) => e.eventType === 'interrupt_requested'), '事件流留审计');
    const task = agentTaskStore.getAgentTask(childId);
    assert.equal(task.agentStatus, 'cancel_requested');
  });

  test('已终态子 agent → 幂等 alreadyTerminal', async () => {
    const childId = spawnTask({ kind: 'subagent', parentTaskId: PARENT_ID, content: '已完成' });
    agentTaskStore.markAgentTaskDone(childId, null);
    const res = await spawnTools.interrupt_agent({ agentId: childId }, childCtx());
    assert.equal(res.ok, true);
    assert.equal(res.alreadyTerminal, true);
    assert.equal(res.status, 'completed');
  });
});

// ── send_message ────────────────────────────────────────────────

describe('send_message', () => {
  test('运行中子 agent → 消息入队（parent_message 事件持久化）', async () => {
    const childId = spawnTask({ kind: 'subagent', parentTaskId: PARENT_ID, content: '在跑' });
    const res = await spawnTools.send_message(
      { agentId: childId, message: '请补充数据来源说明' },
      childCtx(),
    );
    assert.equal(res.ok, true);
    assert.equal(res.queued, true);
    const events = agentTaskStore.getAgentTaskEventsSince(childId, 0, 100);
    const pm = events.find((e) => e.eventType === 'parent_message');
    assert.ok(pm, 'parent_message 事件已持久化');
    const pmPayload = typeof pm.payload === 'string' ? JSON.parse(pm.payload) : pm.payload;
    assert.ok(pmPayload.message.includes('数据来源'));
  });

  test('空消息 → invalid_params', async () => {
    const childId = spawnTask({ kind: 'subagent', parentTaskId: PARENT_ID, content: '空消息靶' });
    const res = await spawnTools.send_message({ agentId: childId, message: '  ' }, childCtx());
    assert.equal(res.ok, false);
    assert.equal(res.error, 'invalid_arguments');
  });

  test('终态子 agent → agent_terminal（引导 followup_task）', async () => {
    const childId = spawnTask({ kind: 'subagent', parentTaskId: PARENT_ID, content: '已结束' });
    agentTaskStore.markAgentTaskDone(childId, null);
    const res = await spawnTools.send_message({ agentId: childId, message: 'hello' }, childCtx());
    assert.equal(res.ok, false);
    assert.equal(res.error, 'agent_terminal');
  });
});

// ── followup_task ───────────────────────────────────────────────

describe('followup_task', () => {
  test('运行中子 agent → agent_running（拒绝，引导 interrupt）', async () => {
    const childId = spawnTask({ kind: 'subagent', parentTaskId: PARENT_ID, content: '运行中' });
    const res = await spawnTools.followup_task(
      { agentId: childId, task: '追加任务' },
      childCtx(),
    );
    assert.equal(res.ok, false);
    assert.equal(res.error, 'agent_running');
  });

  test('终态子 agent 续派：新任务启动，提示组合含摘要 + 队列消息注入', async () => {
    const childId = spawnTask({
      kind: 'subagent',
      parentTaskId: PARENT_ID,
      content: '第一轮任务：整理数据',
    });
    // 先入队一条消息再终态（队列消费语义）
    await spawnTools.send_message({ agentId: childId, message: '请补充数据来源说明' }, childCtx());
    agentTaskStore.markAgentTaskDone(childId, null);

    const res = await spawnTools.followup_task(
      { agentId: childId, task: '基于前情继续整理结论' },
      childCtx(),
    );
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.match(res.agentId, /^task_|^[0-9a-f-]{36}$/);
    assert.equal(res.followupOf, childId);
    assert.equal(res.queuedMessagesInjected, 1);

    await new Promise((r) => setTimeout(r, 60)); // setImmediate 启动
    const launch = fakeRunnerState.launches.at(-1);
    assert.ok(launch, 'fake runAgentLoop 被调用');
    assert.equal(launch.kind, 'subagent');
    assert.equal(launch.taskId, res.agentId);
    const prompt = launch.messages[0].content;
    assert.ok(prompt.includes('【续派任务】'), '续派语义头');
    assert.ok(prompt.includes('原任务：'), '前情（原任务）');
    assert.ok(prompt.includes('基于前情继续整理结论'), '新任务文本');
    assert.ok(prompt.includes('请补充数据来源说明'), '队列消息注入');
  });

  test('无任务文本 → invalid_params', async () => {
    const childId = spawnTask({ kind: 'subagent', parentTaskId: PARENT_ID, content: '终态靶' });
    agentTaskStore.markAgentTaskDone(childId, null);
    const res = await spawnTools.followup_task({ agentId: childId, task: '' }, childCtx());
    assert.equal(res.ok, false);
    assert.equal(res.error, 'invalid_arguments');
  });
});

// ── executeToolCall 链路（模型同款路径冒烟）─────────────────────

describe('executeToolCall 链路', () => {
  test('interrupt_agent 走完整拦截链（policy → handler）', async () => {
    const childId = spawnTask({ kind: 'subagent', parentTaskId: PARENT_ID, content: '链路靶' });
    const envelope = await executeToolCall(
      'interrupt_agent',
      { agentId: childId },
      { taskId: PARENT_ID, userId: USER, accessMode: 'full' },
    );
    assert.equal(envelope.status, 'success');
    assert.equal(envelope.data.ok, true);
  });

  test('只读档位下 interrupt_agent 被 policy 拒（envelope denied）', async () => {
    const envelope = await executeToolCall(
      'interrupt_agent',
      { agentId: 'task_nonexistent' },
      { taskId: PARENT_ID, userId: USER, accessMode: 'read' },
    );
    assert.equal(envelope.status, 'denied');
    assert.equal(envelope.terminationReason, 'read_only');
  });
});
