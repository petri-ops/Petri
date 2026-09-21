/**
 * BLOCK-109-CORE-ARCH P1 — 事件模型（附录 A E1/E3 裁决落地）。
 *
 * ① coalesceTaskDeltas 行为（E3）：按 iter 重建迭代边界、逐（迭代×类型）合并
 *    content/reasoning delta 为透明快照行——回放文本恒等、结构事件保留、行数缩减；
 *    阈值以下不动；未知形状/结构 delta 原样保留。
 * ② agent-runner 生命周期事件源码契约（E1）：run_started / run_terminal 与
 *    coalesceTaskDeltas 终态接线在位。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const here = path.dirname(__filename);
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

// 内存 DB 自举（同 block34/block109-p0-baseline 先例）
{
  const Database = require('better-sqlite3');
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'biof3-b109-p1-events-'));
  const db = new Database(path.join(tempDbDir, 'biof3.db'));
  const migrationsDir = path.join(root, 'src', 'migrations');
  for (const file of fssync.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fssync.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.BIOF3_DB_PATH = path.join(tempDbDir, 'biof3.db');
  process.on('exit', () => {
    try { fssync.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟释放 */ }
  });
}

const agentTaskStore = require(path.join(root, 'core', 'biof3-server', 'agent-task-store.js'));

const deltaContent = (text) => ({ choices: [{ delta: { content: text } }] });
const deltaReasoning = (text) => ({ choices: [{ delta: { reasoning_content: text } }] });

/** 重建回放文本（与面板同口径：逐迭代拼接 content / reasoning）。 */
function replayFrom(events) {
  let iteration = 0;
  const content = new Map();
  const reasoning = new Map();
  for (const e of events) {
    if (e.eventType === 'iter') { iteration += 1; continue; }
    if (e.eventType !== 'delta') continue;
    const d = e.payload && e.payload.choices && e.payload.choices[0] && e.payload.choices[0].delta;
    if (!d) continue;
    if (typeof d.content === 'string' && d.content.length > 0) {
      content.set(iteration, (content.get(iteration) || '') + d.content);
    } else if (typeof d.reasoning_content === 'string' && d.reasoning_content.length > 0) {
      reasoning.set(iteration, (reasoning.get(iteration) || '') + d.reasoning_content);
    }
  }
  return {
    content: [...content.keys()].sort((a, b) => a - b).map((k) => content.get(k)).join(''),
    reasoning: [...reasoning.keys()].sort((a, b) => a - b).map((k) => reasoning.get(k)).join(''),
  };
}

test('P1 E3 — coalesceTaskDeltas：回放文本恒等 + 结构事件保留 + 行数缩减 + seq 严格递增', () => {
  const task = agentTaskStore.createAgentTask({ userId: 'u_p1', params: { kind: 'baseline', note: 'coalesce' } });
  const taskId = task && (task.taskId || task.id);
  assert.ok(taskId);

  // 两轮迭代 + 结构事件交错（与 P0 基线钉死的形态同构）
  const write = agentTaskStore.appendAgentTaskEvent;
  let seq = 0;
  const put = (type, payload) => { seq += 1; write(taskId, seq, type, payload); };
  put('run_started', { event: 'run_started', taskId, at: 't0' });
  put('iter', { event: 'iter', iteration: 1 });
  put('delta', deltaReasoning('第一轮思考。'));
  put('delta', deltaContent('第'));
  put('delta', deltaContent('一'));
  put('delta', deltaContent('轮'));
  put('delta', deltaContent('正文。'));
  put('tool_call', { event: 'tool_call', name: 'system_info' });
  put('tool_result', { event: 'tool_result', status: 'success' });
  put('agent_progress', { event: 'agent_progress', iteration: 1, content: '查完了' });
  put('iter', { event: 'iter', iteration: 2 });
  put('delta', deltaReasoning('第二轮想'));
  put('delta', deltaReasoning('了两句。'));
  put('delta', deltaContent('第二轮'));
  put('delta', deltaContent('正文'));
  put('delta', deltaContent('汇报。'));
  put('run_terminal', { event: 'run_terminal', taskId, status: 'completed' });

  const before = agentTaskStore.getAgentTaskEventsSince(taskId, 0, 1000);
  const beforeReplay = replayFrom(before);
  const beforeDeltaRows = before.filter((e) => e.eventType === 'delta').length;

  const result = agentTaskStore.coalesceTaskDeltas(taskId);
  assert.ok(result.coalesced > 0 && result.snapshots === 4, `合并发生：${JSON.stringify(result)}（2 迭代 × 2 类型）`);

  const after = agentTaskStore.getAgentTaskEventsSince(taskId, 0, 1000);
  const afterReplay = replayFrom(after);

  // 回放文本恒等（逐迭代拼接顺序保持）
  assert.equal(afterReplay.content, beforeReplay.content);
  assert.equal(afterReplay.content, '第一轮正文。第二轮正文汇报。');
  assert.equal(afterReplay.reasoning, beforeReplay.reasoning);
  assert.equal(afterReplay.reasoning, '第一轮思考。第二轮想了两句。');

  // 结构事件原样保留（run_started/tool_call/tool_result/agent_progress/iter/run_terminal）
  const typesAfter = new Set(after.map((e) => e.eventType));
  for (const t of ['run_started', 'iter', 'tool_call', 'tool_result', 'agent_progress', 'run_terminal']) {
    assert.ok(typesAfter.has(t), `结构事件 ${t} 保留`);
  }
  assert.equal(after.filter((e) => e.eventType === 'tool_call').length, 1);

  // 行数缩减 + seq 严格递增唯一
  const afterDeltaRows = after.filter((e) => e.eventType === 'delta').length;
  assert.ok(afterDeltaRows < beforeDeltaRows, `delta 行缩减 ${beforeDeltaRows}→${afterDeltaRows}`);
  let prev = 0;
  for (const e of after) {
    assert.ok(e.seq > prev, `seq 严格递增 @${e.seq}`);
    prev = e.seq;
  }
});

test('P1 E3 — 阈值以下不合并（小运行零扰动）', () => {
  const task = agentTaskStore.createAgentTask({ userId: 'u_p1', params: { kind: 'baseline', note: 'small' } });
  const taskId = task && (task.taskId || task.id);
  let seq = 0;
  for (let i = 0; i < 3; i++) { seq += 1; agentTaskStore.appendAgentTaskEvent(taskId, seq, 'delta', deltaContent('短' + i)); }
  const before = agentTaskStore.getAgentTaskEventsSince(taskId, 0, 100);
  const result = agentTaskStore.coalesceTaskDeltas(taskId);
  assert.deepEqual(result, { coalesced: 0, snapshots: 0 }, '低于阈值（<10 delta 行）不动');
  const after = agentTaskStore.getAgentTaskEventsSince(taskId, 0, 100);
  assert.equal(after.length, before.length);
});

test('P1.2 — listInFlightPrimaryTasks：只列 running 主任务、子任务不混入、会话过滤生效', () => {
  const primary = agentTaskStore.createAgentTask({ userId: 'u-inflight', params: { kind: 'primary', conversationId: 'conv-A' } });
  const primaryOther = agentTaskStore.createAgentTask({ userId: 'u-inflight', params: { kind: 'primary', conversationId: 'conv-B' } });
  const sub = agentTaskStore.createAgentTask({ userId: 'u-inflight', params: { kind: 'subagent', conversationId: 'conv-A', parentTaskId: primary.taskId } });
  agentTaskStore.createAgentTask({ userId: 'u-other', params: { kind: 'primary', conversationId: 'conv-A' } });
  // 完态主任务不在途
  const doneTask = agentTaskStore.createAgentTask({ userId: 'u-inflight', params: { kind: 'primary', conversationId: 'conv-A' } });
  agentTaskStore.markAgentTaskDone(doneTask.taskId);

  const all = agentTaskStore.listInFlightPrimaryTasks('u-inflight');
  const ids = all.map((t) => t.taskId);
  assert.ok(ids.includes(primary.taskId), 'running 主任务在列');
  assert.ok(!ids.includes(sub.taskId), '子任务不混入主任务在途清单');
  assert.ok(!ids.includes(doneTask.taskId), '终态任务不在途');
  assert.ok(!ids.some((id) => ids.filter((x) => x === id).length > 1), '无重复');

  const convA = agentTaskStore.listInFlightPrimaryTasks('u-inflight', 'conv-A');
  assert.deepEqual(convA.map((t) => t.taskId), [primary.taskId]);
  assert.equal(agentTaskStore.listInFlightPrimaryTasks('u-other', 'conv-A').length, 1);
  assert.ok(primaryOther.taskId, '他用户任务不越权（见上 u-other 过滤）');
});

test('P1.4 — legacy SSE 双轨退役 + 组装单链断言（源码契约，plan §4）', () => {
  const chatSrc = fs.readFileSync(path.join(root, 'core', 'biof3-server', 'routes', 'ai-agent', 'chat.js'), 'utf8');
  // legacy 直连 SSE handler 物理删除
  assert.ok(!chatSrc.includes('text/event-stream'), 'chat.js 不再产生 SSE 流（legacy handler 已删）');
  assert.ok(chatSrc.includes('legacy_sse_retired'), 'legacy 请求返回 410 诚实拒绝');
  // 组装单链：chat.js 不再直 require 拼装件（与 agent-runner 双轨的 legacy require 清零）
  for (const banned of [
    'helpers/system-prompt',
    'helpers/knowledge-space',
    'helpers/llm-client',
    'helpers/site-snapshot',
    'helpers/user-facts',
    'helpers/desktop-agent-prompt',
    'agent-tools/knowledge-console-tools',
  ]) {
    const requirePattern = new RegExp(`require\\([^)]*${banned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    assert.ok(!requirePattern.test(chatSrc), `chat.js 不再直 require ${banned}（组装单链=history-assembly）`);
  }
  assert.ok(chatSrc.includes('helpers/history-assembly'), 'chat.js 组装走 history-assembly 单链');
  // 前端 legacy 逃生口退役
  const streamSrc = fs.readFileSync(path.join(root, 'frontend', 'src', 'components', 'copilot', 'copilotClient', 'agentTaskStream.ts'), 'utf8');
  assert.ok(!streamSrc.includes('streamChatLegacy'), '前端 streamChatLegacy 已删除');
  const clientSrc = fs.readFileSync(path.join(root, 'frontend', 'src', 'components', 'copilot', 'copilotClient.ts'), 'utf8');
  assert.ok(!clientSrc.includes('import.meta.env.VITE_AGENT_TASK_MODE'), 'VITE_AGENT_TASK_MODE 读取已退役（注释留痕除外）');
});

test('P1 E1 — agent-runner 生命周期事件与终态合并接线（源码契约）', () => {
  const src = fs.readFileSync(path.join(root, 'core', 'biof3-server', 'agent-runner.js'), 'utf8');
  assert.ok(src.includes("event: 'run_started'"), 'run_started 生命周期事件在位（E1）');
  assert.ok(src.includes("event: 'run_terminal'"), 'run_terminal 生命周期事件在位（E1）');
  assert.ok(/_emit\(\{\s*event: 'run_terminal'[^}]*status: terminal\.status/.test(src.replace(/\n/g, ' ')),
    'run_terminal 携带终态 status');
  assert.ok(src.includes('agentTaskStore.coalesceTaskDeltas(taskId)'), '终态后接线 delta 合并（E3）');
  // run_started 必须先于 runLoop 调用（生命周期起点在循环前）
  const startedIdx = src.indexOf("event: 'run_started'");
  const loopIdx = src.indexOf('await runLoop(');
  assert.ok(startedIdx > -1 && loopIdx > -1 && startedIdx < loopIdx, 'run_started 在 runLoop 之前发出');
});
