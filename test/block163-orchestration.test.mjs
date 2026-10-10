/**
 * BLOCK-163 W3 P1（ORC-3）— 子 Agent 事件驱动聚合契约测试。
 *
 * 钉住：①childTerminalBus 终态通知（spawn_agent 派生链 resolved 后 emit，
 * notifyChildTerminal 导出）；②wait_agent 事件驱动等待（挂 bus 订阅即醒，
 * 醒后复查状态——行为等价：终态返回摘要/超时返回 wait_timeout/父取消让出）；
 * ③轮询兜底语义保持（未收事件也按片轮询复查）。
 * store 经 require 缓存打桩（getAgentTask/isAgentTaskCancellationRequested 运行时替换）。
 */

import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

// 临时 DB 自举（spawn-agent-tools → agent-task-store → db.js 需 schema；
// 与 agent-tool-registry.test.mjs 同一手法）
const fs = require('node:fs');
const os = require('node:os');
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b163-orch-'));
{
  const Database = require(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const boot = new Database(path.join(dbDir, 'petri.db'));
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = path.join(dbDir, 'petri.db');
}

const spawnTools = require(path.join(ROOT, 'core/petri-server/agent-tools/spawn-agent-tools.js'));
const agentTaskStore = require(path.join(ROOT, 'core/petri-server/agent-task-store.js'));

let currentTask = null;
let cancelRequested = false;
// 打桩：运行时替换 store 读面（require 缓存同对象）
const origGet = agentTaskStore.getAgentTask;
const origCancel = agentTaskStore.isAgentTaskCancellationRequested;
agentTaskStore.getAgentTask = (id) => currentTask && currentTask.id === id ? currentTask : (origGet ? origGet(id) : null);
agentTaskStore.isAgentTaskCancellationRequested = () => cancelRequested;

function setRunning(id) {
  currentTask = {
    id,
    userId: 'u1',
    status: 'running',
    params: { parentTaskId: 'parent-1', messages: [{ content: '子任务' }] },
  };
}

function setTerminal(id, status) {
  currentTask = {
    id, userId: 'u1', status,
    params: { parentTaskId: 'parent-1', messages: [{ content: '子任务' }] },
    result: { assistantText: 'done' },
  };
}

test('BLOCK-160 ORC-3 notifyChildTerminal 导出且 emit 到达订阅者', () => {
  assert.equal(typeof spawnTools.notifyChildTerminal, 'function');
  let got = null;
  const handler = (id) => { got = id; };
  spawnTools.childTerminalBus.on('terminal', handler);
  spawnTools.notifyChildTerminal('agent-x');
  spawnTools.childTerminalBus.off('terminal', handler);
  assert.equal(got, 'agent-x');
});

test('BLOCK-160 ORC-3 wait_agent 事件驱动：终态 emit 即醒（远快于超时），行为等价', async () => {
  setRunning('agent-evt');
  const startedAt = Date.now();
  const waitPromise = spawnTools.wait_agent({ agentId: 'agent-evt', timeout: 15000 }, {
    taskId: 'parent-1', userId: 'u1', isCancelled: () => false,
  });
  // 模拟子 agent 在 ~150ms 后进入终态（经通知链）
  setTimeout(() => {
    setTerminal('agent-evt', 'completed');
    spawnTools.notifyChildTerminal('agent-evt');
  }, 150);
  const result = await waitPromise;
  const elapsed = Date.now() - startedAt;
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 200));
  assert.equal(result.status, 'completed');
  assert.ok(elapsed < 3000, `事件唤醒应远小于超时（实际 ${elapsed}ms）`);
});

test('BLOCK-160 ORC-3 轮询兜底：无事件也按片复查（超时语义保持）', async () => {
  setRunning('agent-poll');
  const result = await spawnTools.wait_agent({ agentId: 'agent-poll', timeout: 300 }, {
    taskId: 'parent-1', userId: 'u1', isCancelled: () => false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'wait_timeout');
});

test('BLOCK-160 ORC-3 父取消让出语义保持（事件等待期取消即返）', async () => {
  setRunning('agent-cancel');
  const waitPromise = spawnTools.wait_agent({ agentId: 'agent-cancel', timeout: 15000 }, {
    taskId: 'parent-1', userId: 'u1', isCancelled: () => cancelRequested,
  });
  setTimeout(() => { cancelRequested = true; }, 120);
  const result = await waitPromise;
  assert.equal(result.ok, false);
  assert.equal(result.error, 'cancelled');
});

after(() => {
  agentTaskStore.getAgentTask = origGet;
  agentTaskStore.isAgentTaskCancellationRequested = origCancel;
});
