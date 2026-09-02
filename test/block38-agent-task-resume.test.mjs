/**
 * BLOCK-38 P1 — Agent 任务中断续跑（store 清扫 + readLastRecord 取证 + resume 端点）。
 *
 * 覆盖：
 * - store：sweepInterruptedRunningTasks 写显式 interrupted_at / getResumableTask 只认中断任务
 * - io-transcript：readLastRecord 末条命中 / 轮转留存回退 / 诚实空态
 * - 端点：401 / 404 / 403 / 409 running / 409 非中断失败 / 正常续跑
 *   （新 task 带 resumeOfTaskId + 合成恢复指令 + 原 task 不可变 + task_resumed 溯源事件 + 取证摘要）
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const resolve = (...segments) => path.resolve(__dirname, '..', ...segments);
const require = createRequire(import.meta.url);

// db / store 必须在 env 设置后加载（BIOF3_DB_PATH 单例解析）
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-block38-'));
process.env.BIOF3_DB_PATH = path.join(tmpRoot, 'agent-tasks.db');
const DATA_DIR = path.join(tmpRoot, 'local-data');
process.env.BIOF3_LOCAL_DATA_DIR = DATA_DIR;

const store = require(resolve('core/biof3-server/agent-task-store'));
const { createIoTranscriptSink, readLastRecord } = require(
  resolve('core/shared-backend/llm-providers/io-transcript.js')
);

const USER_ID = 'u_b38';
const OTHER_USER = 'u_other';
const CONV = 'conv-b38';

let server;
let baseUrl;
let stubLoopCalls = [];

function apiPost(pathname, { userId, body } = {}) {
  return new Promise((resolvePromise, reject) => {
    const headers = { 'content-type': 'application/json' };
    if (userId) headers['x-mock-user'] = userId;
    const req = http.request(baseUrl + pathname, { method: 'POST', headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
        resolvePromise({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

function apiGet(pathname, { userId } = {}) {
  return new Promise((resolvePromise, reject) => {
    const headers = {};
    if (userId) headers['x-mock-user'] = userId;
    const req = http.request(baseUrl + pathname, { method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
        resolvePromise({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  const express = require('express');
  const route = require(resolve('core/biof3-server/routes/ai-agent/resume.js'));
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use((req, _res, next) => {
    const uid = req.headers['x-mock-user'];
    if (uid) req.user = { id: String(uid), role: 'user' };
    next();
  });
  route.register(app, {
    // 测试注入：不触达真实 provider；记录调用参数并模拟正常完成
    runAgentLoop(opts) {
      stubLoopCalls.push(opts);
      const runtime = require(resolve('core/biof3-server/helpers/runtime.js'));
      try { runtime.aiTaskConcurrencyRelease(opts.userId, opts.taskId); } catch {}
      return Promise.resolve({ assistantText: 'resumed-done' });
    },
  });

  await new Promise((resolvePromise) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolvePromise();
    });
  });
});

after(async () => {
  try { if (server) await new Promise((r) => server.close(r)); } catch {}
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  delete process.env.BIOF3_DB_PATH;
  delete process.env.BIOF3_LOCAL_DATA_DIR;
});

// ---------- store：启动清扫 + 可续跑判定 ----------

test('sweepInterruptedRunningTasks：running agent_loop → failed + 显式 interrupted_at', () => {
  store.insertAgentTask({
    taskId: 'task-sweep-1',
    userId: USER_ID,
    params: { conversationId: CONV, messages: [{ role: 'user', content: 'running job' }] },
  });
  // 复用 store 单例 db（dbMod 传 undefined 走缺省），避免第二连接触发 SQLITE_IOERR_SHORT_READ
  const fixedNow = '2026-09-02T12:00:00.000Z';
  const changed = store.sweepInterruptedRunningTasks(undefined, { now: () => fixedNow });
  assert.ok(changed >= 1, 'sweep should mark at least the running task');

  const swept = store.getAgentTask('task-sweep-1');
  assert.equal(swept.status, 'failed');
  assert.equal(swept.agentStatus, 'failed');
  assert.equal(swept.error, '服务重启，Agent 任务中断');
  assert.equal(swept.interruptedAt, fixedNow);

  // 可续跑判定：中断任务命中；非中断失败任务不命中
  const resumable = store.getResumableTask('task-sweep-1');
  assert.ok(resumable, 'interrupted task must be resumable');
  assert.equal(resumable.interruptedAt, fixedNow);

  store.insertAgentTask({ taskId: 'task-fail-plain', userId: USER_ID, params: {} });
  store.markAgentTaskFailed('task-fail-plain', '模型上游错误');
  assert.equal(store.getResumableTask('task-fail-plain'), null, 'non-interrupted failed task is not resumable');
});

// ---------- io-transcript：readLastRecord 取证读取 ----------

test('readLastRecord：末条命中 / 轮转留存回退 / 诚实空态', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-b38-transcript-'));
  const sink = createIoTranscriptSink({ dataDir: dir });

  // 空态：文件不存在
  assert.equal(readLastRecord('conv-none', { dataDir: dir }), null);

  sink.record({
    telemetry: { conversationId: 'conv-read', kind: 'agent_iter' },
    requestBody: { messages: [{ role: 'user', content: 'first' }] },
    result: { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'workspace_write' } }] } }] },
    provider: 'deepseek',
    model: 'deepseek-chat',
  });
  sink.record({
    telemetry: { conversationId: 'conv-read', kind: 'agent_iter' },
    requestBody: { messages: [{ role: 'user', content: 'second' }] },
    result: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'done' } }] },
    provider: 'deepseek',
    model: 'deepseek-chat',
  });

  const last = readLastRecord('conv-read', { dataDir: dir });
  assert.ok(last);
  assert.equal(last.request.messages[0].content, 'second');
  assert.equal(last.response.finishReason, 'stop');

  // 轮转留存回退：活跃文件删掉后从 <id>.<ts>.jsonl 取末条
  const transcriptDir = path.join(dir, 'llm-transcripts');
  const activeFile = path.join(transcriptDir, 'conv-read.jsonl');
  const archivedFile = path.join(transcriptDir, `conv-read.1893456000000.jsonl`);
  fs.renameSync(activeFile, archivedFile);
  const fromArchive = readLastRecord('conv-read', { dataDir: dir });
  assert.ok(fromArchive, 'archive fallback should hit');
  assert.equal(fromArchive.response.finishReason, 'stop');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- resume 端点 ----------

test('未登录 401 / task 不存在 404 / 越权 403', async () => {
  const res401 = await apiPost('/api/ai/agent/task/whatever/resume', {});
  assert.equal(res401.status, 401);

  const res404 = await apiPost('/api/ai/agent/task/task-none-b38/resume', { userId: USER_ID });
  assert.equal(res404.status, 404);

  const res403 = await apiPost('/api/ai/agent/task/task-sweep-1/resume', { userId: OTHER_USER });
  assert.equal(res403.status, 403);
});

test('running 任务 409 / 非中断失败任务 409（诚实拒绝）', async () => {
  store.insertAgentTask({ taskId: 'task-running', userId: USER_ID, params: { messages: [{ role: 'user', content: 'x' }] } });

  const resRunning = await apiPost('/api/ai/agent/task/task-running/resume', { userId: USER_ID });
  assert.equal(resRunning.status, 409);
  assert.match(resRunning.body.error, /仍在运行/);

  const resNotInterrupted = await apiPost('/api/ai/agent/task/task-fail-plain/resume', { userId: USER_ID });
  assert.equal(resNotInterrupted.status, 409);
  assert.match(resNotInterrupted.body.error, /仅服务中断的任务/);
});

test('正常续跑：新 task 带 resumeOfTaskId + 合成恢复指令 + 原 task 不可变 + task_resumed 溯源 + 取证摘要', async () => {
  // 取证层：会话信息流末条（中断前最后一次模型调用）
  const sink = createIoTranscriptSink({ dataDir: DATA_DIR });
  sink.record({
    telemetry: { conversationId: CONV, kind: 'agent_iter', userId: USER_ID },
    requestBody: { model: 'deepseek-chat', messages: [{ role: 'user', content: '继续写文件' }] },
    result: {
      choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: 'c9', function: { name: 'workspace_write' } }] } }],
    },
    provider: 'deepseek',
    model: 'deepseek-chat',
  });

  // 原 task 已被前面的清扫用例标记为可续跑（task-sweep-1），并补两条执行进度事件
  const priorEvents = store.getAgentTaskEventsSince('task-sweep-1', 0, 1000000);
  const baseSeq = priorEvents.length > 0 ? priorEvents[priorEvents.length - 1].seq : 0;
  store.appendAgentTaskEvent('task-sweep-1', baseSeq + 1, 'tool_call', {
    event: 'tool_call', name: 'workspace_write', args: { path: '/tmp/a.md', content: 'x' }, iteration: 1,
  });
  store.appendAgentTaskEvent('task-sweep-1', baseSeq + 2, 'tool_result', {
    event: 'tool_result', name: 'workspace_write', summary: 'ok', iteration: 1,
  });

  const res = await apiPost('/api/ai/agent/task/task-sweep-1/resume', { userId: USER_ID });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'running');
  assert.equal(res.body.resumeOfTaskId, 'task-sweep-1');
  assert.equal(res.body.conversationId, CONV);
  assert.ok(res.body.taskId, 'response should carry the new taskId');

  // 取证摘要：中断前最后一次模型调用
  assert.ok(res.body.lastModelCall, 'lastModelCall should be present (transcript record written above)');
  assert.equal(res.body.lastModelCall.finishReason, 'tool_calls');
  assert.deepEqual(res.body.lastModelCall.toolCallNames, ['workspace_write']);
  assert.equal(res.body.lastModelCall.error, null);

  // 新 task：params 带 resumeOfTaskId，messages = 原始历史 + 合成恢复指令
  const newTask = store.getAgentTask(res.body.taskId);
  assert.equal(newTask.status, 'running');
  assert.equal(newTask.params.resumeOfTaskId, 'task-sweep-1');
  assert.equal(newTask.params.conversationId, CONV);
  assert.ok(Array.isArray(newTask.params.messages) && newTask.params.messages.length >= 2);
  const injected = newTask.params.messages[newTask.params.messages.length - 1];
  assert.equal(injected.role, 'user');
  assert.match(injected.content, /任务恢复（系统注入，非用户输入）/);
  assert.match(injected.content, /workspace_write/);
  assert.match(injected.content, /已完成的步骤不要重复执行/);

  // 原 task 不可变：仍为 failed + interrupted_at 不变
  const original = store.getAgentTask('task-sweep-1');
  assert.equal(original.status, 'failed');
  assert.equal(original.agentStatus, 'failed');
  assert.ok(original.interruptedAt);

  // 溯源事件：原 task 追加 task_resumed（指向新 task）
  const events = store.getAgentTaskEventsSince('task-sweep-1', 0, 1000000);
  const resumedEv = events.find((e) => e.eventType === 'task_resumed');
  assert.ok(resumedEv, 'task_resumed event should be appended to the original task');
  assert.equal(resumedEv.payload.newTaskId, res.body.taskId);

  // 注入的 loop 收到新 taskId 与重建消息
  await new Promise((r) => setImmediate(r));
  assert.equal(stubLoopCalls.length, 1);
  assert.equal(stubLoopCalls[0].taskId, res.body.taskId);
  assert.equal(stubLoopCalls[0].kind, 'primary');
  assert.ok(Array.isArray(stubLoopCalls[0].messages));
});

test('缺少可复用上下文的中断任务 409（诚实拒绝）', async () => {
  // 直接构造一条 interrupted 但 params 无 messages 的任务：insertAgentTask 默认 running，
  // 用同一条启动清扫链路标记为 failed + interrupted_at（复用单例 db，不开第二连接）
  store.insertAgentTask({ taskId: 'task-bare', userId: USER_ID, params: {} });
  store.sweepInterruptedRunningTasks(undefined, { now: () => '2026-09-02T12:30:00.000Z' });

  const res = await apiPost('/api/ai/agent/task/task-bare/resume', { userId: USER_ID });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /缺少可复用的请求上下文/);
});

// ---------- BLOCK-38 P2：GET resume 只读预览（确认弹层数据源） ----------

test('GET resume：401 / 404 / 403 与 POST 同语义', async () => {
  const res401 = await apiGet('/api/ai/agent/task/task-sweep-1/resume', {});
  assert.equal(res401.status, 401);

  const res404 = await apiGet('/api/ai/agent/task/task-none-b38/resume', { userId: USER_ID });
  assert.equal(res404.status, 404);

  const res403 = await apiGet('/api/ai/agent/task/task-sweep-1/resume', { userId: OTHER_USER });
  assert.equal(res403.status, 403);
});

test('GET resume：中断任务返回 resumable + interruptedAt + 取证摘要（无副作用）', async () => {
  const res = await apiGet('/api/ai/agent/task/task-sweep-1/resume', { userId: USER_ID });
  assert.equal(res.status, 200);
  assert.equal(res.body.resumable, true);
  assert.equal(res.body.interruptedAt, '2026-09-02T12:00:00.000Z');
  // 取证摘要：正常续跑用例写入的会话末条模型调用
  assert.ok(res.body.lastModelCall, 'lastModelCall should be present');
  assert.equal(res.body.lastModelCall.finishReason, 'tool_calls');
  assert.deepEqual(res.body.lastModelCall.toolCallNames, ['workspace_write']);
  // 执行进度摘要：正常续跑用例追加的 tool_call/tool_result 事件
  assert.ok(typeof res.body.progressDigest === 'string' && res.body.progressDigest.includes('workspace_write'));

  // 无副作用：task 状态不变，仍可再次 GET
  const again = await apiGet('/api/ai/agent/task/task-sweep-1/resume', { userId: USER_ID });
  assert.equal(again.status, 200);
  assert.equal(again.body.resumable, true);
  const task = store.getAgentTask('task-sweep-1');
  assert.equal(task.status, 'failed');
});

test('GET resume：非中断任务诚实返回 resumable:false（不报错）', async () => {
  const res = await apiGet('/api/ai/agent/task/task-fail-plain/resume', { userId: USER_ID });
  assert.equal(res.status, 200);
  assert.equal(res.body.resumable, false);
  assert.equal(res.body.interruptedAt, null);
  assert.equal(res.body.lastModelCall, null);
});
