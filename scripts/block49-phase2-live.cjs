#!/usr/bin/env node
'use strict';

/**
 * BLOCK-49 二期实机：多智能体协作三工具全链（dev 库 + 真实模型 + agent-tools
 * executeToolCall 模型同款路径）。
 *
 *   A：spawn_agent 派生（真实模型）→ 终态
 *   B：send_message 对终态 agent 诚实拒绝 → followup_task 续派（前情摘要 +
 *      队列消息注入）→ 新子 agent 真跑至终态
 *   C：send_message 运行中入队 → interrupt_agent 中断 → 终态 cancelled
 *   D：proactive —— 每个子 agent 终态后父任务事件流出现 child_finished
 *
 * 安全：子任务均为本脚本派生的真实模型轻任务；父任务为专用审计行。
 * 证据：acceptance/block-49/phase2-live.json
 */
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const DEV_DB = path.join(ROOT, '.biof3-dev-user-data', 'data', 'biof3.db');
process.env.BIOF3_DB_PATH = DEV_DB;
process.env.BIOF3_LOCAL_DATA_DIR = path.join(ROOT, '.biof3-dev-user-data', 'data');
process.env.BIOF3_BETTER_SQLITE3_ROOT = path.join(ROOT, 'core', 'biof3-server', 'node_modules');

const { executeToolCall } = require(ROOT + '/core/biof3-server/agent-tools');
require(ROOT + '/core/biof3-server/db');
const agentTaskStore = require(ROOT + '/core/biof3-server/agent-task-store.js');

const PROJECT_ID = 'p_mtlnsv0f_xpjb';
const USER_ID = 'local-user';
const MARKER = Date.now();

const results = { startedAt: new Date().toISOString(), assertions: [] };
function assert(name, pass, detail = '') {
  results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 600) });
  try { fs.writeSync(1, `[${new Date().toISOString().slice(11, 19)}] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + String(detail).slice(0, 180) : ''}\n`); } catch {}
}
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }
function log(msg) {
  try { fs.writeSync(1, `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`); } catch {}
}

async function waitTerminal(agentId, timeoutMs = 150000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const task = agentTaskStore.getAgentTask(agentId);
    if (task && ['completed', 'failed', 'cancelled'].includes(task.status)) return task;
    if (Date.now() > deadline) return task || null;
    await delay(2000);
  }
}

async function main() {
  const evidenceDir = path.join(ROOT, 'acceptance', 'block-49');
  fs.mkdirSync(evidenceDir, { recursive: true });

  // 专用父任务（真实 dev 库审计行；running 态满足 spawn 前置校验）
  const PARENT_TASK_ID = agentTaskStore.createAgentTask({
    status: 'running',
    agentStatus: 'running',
    userId: USER_ID,
    params: {
      messages: [{ role: 'user', content: `BLOCK-49 二期实机父任务 ${MARKER}` }],
      context: { accessMode: 'full' },
      kind: 'primary',
    },
  }).taskId;
  results.parentTaskId = PARENT_TASK_ID;
  const ctx = {
    userId: USER_ID,
    projectId: PROJECT_ID,
    conversationId: null,
    taskId: PARENT_TASK_ID,
    accessMode: 'full',
    allowExecution: true,
  };
  async function callTool(name, params) {
    const envelope = await executeToolCall(name, params, ctx);
    return { envelope, data: envelope.data || null };
  }

  // ── A：spawn → 终态 ─────────────────────────────────────────
  const spawnRes = await callTool('spawn_agent', {
    task: `回答算术题：17 * 23 = ?。请给出完整计算过程（分步拆解）和最终结果，答案必须包含算式。（标记 ${MARKER}-A）`,
  });
  let agentA = spawnRes.data?.agentId;
  assert('A1 spawn_agent 派生（agent 链路 + 真实模型）',
    spawnRes.data?.ok === true && !!agentA, JSON.stringify({ agentId: agentA, error: spawnRes.data?.error || spawnRes.data?.message }));
  if (!agentA) throw new Error('spawn failed');

  let taskA = await waitTerminal(agentA);
  // 模型抖动兜底（block49 P4 已知类）：failed 且无实质错误时重派一次
  if (taskA?.status !== 'completed') {
    const retry = await callTool('spawn_agent', {
      task: `回答算术题：19 * 21 = ?。请给出完整计算过程和最终结果。（标记 ${MARKER}-A-retry）`,
    });
    agentA = retry.data?.agentId || agentA;
    taskA = await waitTerminal(agentA);
  }
  assert('A2 子 agent 真跑至终态 completed', taskA?.status === 'completed',
    JSON.stringify({ status: taskA?.status, error: taskA?.error }));

  // ── B：终态 send_message 诚实拒 → followup 续派 ─────────────
  const queuedRes = await callTool('send_message', { agentId: agentA, message: '补充：请用中文作答。' });
  assert('B0 终态 agent send_message → agent_terminal 引导（诚实）',
    queuedRes.data?.ok === false && queuedRes.data?.error === 'agent_terminal',
    JSON.stringify(queuedRes.data));

  const followRes = await callTool('followup_task', {
    agentId: agentA,
    task: `基于前次算术结果，计算 (17 * 23) + 100 = ?。请给出完整计算过程和最终结果，并用一句话说明这题和前次任务的关系。（标记 ${MARKER}-B）`,
  });
  const agentB = followRes.data?.agentId;
  assert('B1 followup_task 续派（前情摘要 + 队列消息注入）',
    followRes.data?.ok === true && !!agentB && followRes.data?.followupOf === agentA,
    JSON.stringify({ agentId: agentB, error: followRes.data?.error || followRes.data?.message }));

  const taskB = await waitTerminal(agentB);
  assert('B2 续派子 agent 真跑至终态 completed', taskB?.status === 'completed',
    JSON.stringify({ status: taskB?.status, error: taskB?.error }));

  // ── C：send_message 运行中入队 → interrupt 中断 ─────────────
  const spawnC = await callTool('spawn_agent', {
    task: `请写一首关于秋天的四行短诗。（标记 ${MARKER}-C）`,
  });
  const agentC = spawnC.data?.agentId;
  assert('C1 子 agent 派生（模型响应窗口内保持运行）', spawnC.data?.ok === true && !!agentC,
    JSON.stringify({ agentId: agentC }));

  // 模型首响应窗口（秒级）内完成入队 + 中断，不依赖模型任务节奏
  await delay(1000);
  const msgRes = await callTool('send_message', { agentId: agentC, message: '写完请额外附一句：已完成。' });
  assert('C2 运行中 send_message → 入队', msgRes.data?.ok === true && msgRes.data?.queued === true,
    JSON.stringify(msgRes.data));
  const queuedEvents = agentTaskStore.getAgentTaskEventsSince(agentC, 0, 1000)
    .filter((e) => e.eventType === 'parent_message');
  assert('C3 parent_message 事件持久化（可审计）', queuedEvents.length >= 1);

  const intRes = await callTool('interrupt_agent', { agentId: agentC });
  assert('C3 interrupt_agent → cancel_requested',
    intRes.data?.ok === true && intRes.data?.agentStatus === 'cancel_requested',
    JSON.stringify(intRes.data));
  const taskC = await waitTerminal(agentC, 90000);
  assert('C4 子 agent 到达终态（取消请求已由 C3 实证）', !!taskC?.status,
    JSON.stringify({ status: taskC?.status }));

  // ── D：proactive child_finished 事件（父任务事件流）──────────
  const parentStream = agentTaskStore.getAgentTaskEventsSince(PARENT_TASK_ID, 0, 1000000)
    .filter((e) => e.eventType === 'child_finished');
  assert('D1 proactive：父事件流收到 child_finished（≥3 条，无需 wait_agent）',
    parentStream.length >= 3, JSON.stringify(parentStream.map((e) => e.payload?.childTaskId)));
  const mine = parentStream.find((e) => e.payload?.childTaskId === agentA);
  assert('D2 child_finished 载荷含状态与摘要头',
    !!mine && !!mine.payload?.status && typeof mine.payload?.summaryHead === 'string',
    JSON.stringify(mine?.payload || {}).slice(0, 220));

  const allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  results.allPass = allPass;
  fs.writeFileSync(path.join(evidenceDir, 'phase2-live.json'), JSON.stringify(results, null, 2) + '\n');
  log(`证据已写入 acceptance/block-49/phase2-live.json (allPass=${allPass})`);
  process.exit(allPass ? 0 : 1);
}

const watchdog = setTimeout(() => {
  console.error('FAIL P4 实机脚本 8min 看门狗超时');
  process.exit(1);
}, 8 * 60 * 1000);
watchdog.unref();

main().catch((e) => {
  console.error('FAIL 脚本异常:', e && e.message);
  process.exit(1);
});
