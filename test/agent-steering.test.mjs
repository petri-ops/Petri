/*
 * test/agent-steering.test.mjs — 子智能体实时 steering 契约（2026-09-23 增量）。
 *
 * send_message / queueUserMessage 复用 BLOCK-98 M4 输入插队队列实时送达：
 * 队列条目扩展 {text, meta}（preformatted + parentMessageSeq）；送达后由
 * agent-runner 发 parent_message_delivered 回执；followup_task /
 * launchUserFollowup 经 collectUndeliveredParentMessages 去重已实时送达的
 * 父消息。M4 注入同步 fullMessages 使其跨迭代持久。
 *
 * DB 为临时自举库（block49 同款基建）；M4 队列为进程内存（drain 即清）。
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R_SERVER = path.resolve(__dirname, '..', 'core', 'petri-server');
const require = createRequire(import.meta.url);

// 临时 DB 自举（须在 require db.js 前生效）
{
  const Database = require(path.join(R_SERVER, 'node_modules', 'better-sqlite3'));
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-agent-steering-db-'));
  const boot = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.resolve(__dirname, '..', 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch {}
  });
}

const agentTaskStore = require(path.join(R_SERVER, 'agent-task-store.js'));
const agentResilience = require(path.join(R_SERVER, 'helpers', 'agent-resilience.js'));
const spawnTools = require(path.join(R_SERVER, 'agent-tools', 'spawn-agent-tools.js'));
const { collectUndeliveredParentMessages } = spawnTools.__test;

/** 真实 store 调用造任务（id 由 store 生成并返回）。 */
function spawnTask({ userId, kind, parentTaskId = null, content = '任务' }) {
  return agentTaskStore.createAgentTask({
    status: 'running',
    agentStatus: 'running',
    userId,
    params: {
      messages: [{ role: 'user', content }],
      context: { accessMode: 'full' },
      kind,
      ...(parentTaskId ? { parentTaskId } : {}),
    },
  }).taskId;
}

function uniqueUser() {
  return 'u-steer-' + Math.random().toString(36).slice(2, 10);
}

// ── M4 队列条目契约 ─────────────────────────────────────────────

describe('agent-resilience M4 队列（{text, meta} 条目）', () => {
  test('meta 保留 + drain 即清 + 无 meta → null', () => {
    const taskId = 'steer-q-' + uniqueUser();
    assert.equal(agentResilience.pendingInputCount(taskId), 0);
    const enq = agentResilience.enqueueUserInput(taskId, '先只看汇总表', { preformatted: true, parentMessageSeq: 7 });
    assert.equal(enq.ok, true);
    assert.equal(agentResilience.pendingInputCount(taskId), 1);
    const entries = agentResilience.drainUserInput(taskId);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].text, '先只看汇总表');
    assert.deepEqual(entries[0].meta, { preformatted: true, parentMessageSeq: 7 });
    assert.equal(agentResilience.drainUserInput(taskId).length, 0);
    assert.equal(agentResilience.enqueueUserInput(taskId, '无 meta').ok, true);
    const [bare] = agentResilience.drainUserInput(taskId);
    assert.equal(bare.meta, null);
  });

  test('上限 20 条：超出 queue_full（fail-closed 不静默丢）', () => {
    const taskId = 'steer-cap-' + uniqueUser();
    for (let i = 0; i < 20; i++) {
      assert.equal(agentResilience.enqueueUserInput(taskId, 'm' + i).ok, true);
    }
    const over = agentResilience.enqueueUserInput(taskId, 'overflow');
    assert.equal(over.ok, false);
    assert.equal(over.error, 'queue_full');
  });
});

// ── send_message / queueUserMessage 实时通道 ────────────────────

describe('send_message 实时 steering（父 loop 工具通道）', () => {
  test('运行中子 agent：M4 队列在位 + parent_message 事件落流 + 前缀与回执 refs', async () => {
    const userId = uniqueUser();
    const parentId = spawnTask({ userId, kind: 'primary', content: '主任务' });
    const childId = spawnTask({ userId, kind: 'subagent', parentTaskId: parentId, content: '在跑的子任务' });

    const res = await spawnTools.send_message(
      { agentId: childId, message: '先只核对汇总表，其余跳过' },
      { taskId: parentId, userId },
    );
    assert.equal(res.ok, true);
    assert.equal(res.deliveredVia, 'steering');

    const events = agentTaskStore.getAgentTaskEventsSince(childId, 0, 100);
    const pm = events.filter((e) => e.eventType === 'parent_message');
    assert.equal(pm.length, 1);
    assert.equal(pm[0].payload.message, '先只核对汇总表，其余跳过');
    assert.equal(pm[0].payload.from, 'parent');

    assert.equal(agentResilience.pendingInputCount(childId), 1);
    const [entry] = agentResilience.drainUserInput(childId);
    assert.ok(entry.text.startsWith('【父智能体消息】'), '实时注入带来源前缀');
    assert.equal(entry.meta.preformatted, true);
    assert.equal(entry.meta.parentMessageSeq, pm[0].seq);
  });

  test('终态子 agent：拒绝并引导 followup_task（原语义不变）', async () => {
    const userId = uniqueUser();
    const parentId = spawnTask({ userId, kind: 'primary', content: '主任务' });
    const childId = spawnTask({ userId, kind: 'subagent', parentTaskId: parentId, content: '已结束' });
    agentTaskStore.markAgentTaskDone(childId);
    const res = await spawnTools.send_message({ agentId: childId, message: 'hello' }, { taskId: parentId, userId });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'agent_terminal');
  });
});

describe('queueUserMessage 实时 steering（HTTP 用户通道）', () => {
  test('运行中子 agent：留言入 M4 队列，前缀「用户留言」', () => {
    const userId = uniqueUser();
    const childId = spawnTask({ userId, kind: 'subagent', parentTaskId: spawnTask({ userId, kind: 'primary', content: '父' }), content: '在跑' });
    const res = spawnTools.queueUserMessage({ childTaskId: childId, message: '优先输出 CSV 而不是表格' });
    assert.equal(res.ok, true);
    assert.equal(res.deliveredVia, 'steering');
    assert.equal(agentResilience.pendingInputCount(childId), 1);
    const [entry] = agentResilience.drainUserInput(childId);
    assert.ok(entry.text.startsWith('【用户留言】'));
    assert.ok(Number.isInteger(entry.meta.parentMessageSeq));
  });
});

// ── followup 去重（delivered refs）───────────────────────────────

describe('collectUndeliveredParentMessages（followup 续派去重）', () => {
  test('已实时送达的剔除，未送达的保留', () => {
    const userId = uniqueUser();
    const childId = spawnTask({ userId, kind: 'subagent', parentTaskId: spawnTask({ userId, kind: 'primary', content: '父' }), content: '子' });
    agentTaskStore.appendAgentTaskEvent(childId, 3, 'parent_message', { message: '已实时看到的消息', from: 'parent' });
    agentTaskStore.appendAgentTaskEvent(childId, 4, 'parent_message', { message: '终态后才到的消息', from: 'parent' });
    agentTaskStore.appendAgentTaskEvent(childId, 5, 'parent_message_delivered', { refs: [3] });
    assert.deepEqual(collectUndeliveredParentMessages(childId), ['终态后才到的消息']);
  });

  test('无回执事件时全量保留（followup 注入兜底语义不变）', () => {
    const userId = uniqueUser();
    const childId = spawnTask({ userId, kind: 'subagent', parentTaskId: spawnTask({ userId, kind: 'primary', content: '父' }), content: '子' });
    agentTaskStore.appendAgentTaskEvent(childId, 1, 'parent_message', { message: 'm1', from: 'user_window' });
    assert.deepEqual(collectUndeliveredParentMessages(childId), ['m1']);
  });
});

// ── agent-runner 源码契约（block109-reporting-reconcile 同型扫描）──

describe('agent-runner 注入点源码契约', () => {
  const runnerSrc = fs.readFileSync(path.join(R_SERVER, 'agent-runner.js'), 'utf8');

  test('M4 注入跨迭代持久：drain 后同步 fullMessages', () => {
    const drainIdx = runnerSrc.indexOf('drainUserInput(taskId)');
    assert.ok(drainIdx > -1, 'drain 块在位');
    const persistIdx = runnerSrc.indexOf('fullMessages.push', drainIdx);
    assert.ok(persistIdx > drainIdx, 'drain 后必须同步进 fullMessages（仅投影请求体会下一轮丢失）');
  });

  test('delivered 回执事件发射在位', () => {
    const drainIdx = runnerSrc.indexOf('drainUserInput(taskId)');
    assert.ok(runnerSrc.indexOf("event: 'parent_message_delivered'", drainIdx) > drainIdx);
  });
});
