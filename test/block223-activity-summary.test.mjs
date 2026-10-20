/**
 * BLOCK-223 — 退出摘要只读端点（routes/app-activity.js）。
 *
 * 真实集成：临时 SQLite + 真实 Express 路由 + 真实计数出口
 * （tool_jobs / tasks / approval-request-store / 后台进程内存表）。
 * 覆盖：空库全零、五类计数与 total 求和对账、已完成/已退出记录不计入、
 * 审批 TTL sweep 后 pending 归零、响应只读形状。
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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block223-'));
process.env.PETRI_DB_PATH = path.join(tempDir, 'petri.db');
{
  // 桌面侧 migrations 建 projects/tasks 等基础表（与 block34 同法）：
  // core 的 initSchema 只补自身表，projects 在 src/migrations。
  const Database = require('better-sqlite3');
  const bootstrap = new Database(process.env.PETRI_DB_PATH);
  const migrationsDir = resolve('src/migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    bootstrap.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  bootstrap.close();
}
process.on('exit', () => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

const USER_ID = 'local-user';
const TASK_ID = 'task-block223-primary';

let server;
let baseUrl;
let db;
let approvalStore;
let agentTasks;
let internals;

function apiGet(pathname) {
  return new Promise((resolvePromise, reject) => {
    const req = http.request(baseUrl + pathname, { method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let body = null;
        try { body = data ? JSON.parse(data) : null; } catch { body = data; }
        resolvePromise({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function insertToolJob(id, status) {
  db.prepare(`
    INSERT INTO tool_jobs (id, user_id, tool_id, params_json, status, created_at, is_test_run)
    VALUES (?, ?, 'demo', '{}', ?, ?, 0)
  `).run(id, USER_ID, status, Date.now());
}

function insertTask(id, status, params) {
  db.prepare(`
    INSERT INTO tasks (id, type, params, status, created_at, user_id)
    VALUES (?, 'agent_loop', ?, ?, ?, ?)
  `).run(id, JSON.stringify(params), status, new Date().toISOString(), USER_ID);
}

before(async () => {
  const express = require('express');
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: USER_ID, role: 'admin' };
    next();
  });
  require(resolve('core/petri-server/routes/app-activity.js'))(app);

  db = require(resolve('core/petri-server/db.js')).getDatabase();
  approvalStore = require(resolve('core/petri-server/helpers/approval-request-store.js'));
  agentTasks = require(resolve('core/petri-server/agent-task-store.js'));
  internals = require(resolve('core/petri-server/agent-tools/workspace-tools/internals.js'));
  assert.ok(agentTasks && typeof agentTasks.countRunningAgentTasks === 'function');

  server = await new Promise((resolvePromise) => {
    const listening = app.listen(0, '127.0.0.1', () => resolvePromise(listening));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  try { approvalStore.releaseApprovalRequests(TASK_ID); } catch {}
  try {
    for (const id of ['bp-running', 'bp-exited']) internals.backgroundProcesses.delete(id);
  } catch {}
  try { server.close(); } catch {}
  try { db.close(); } catch {}
});

test('空活动面：五类计数全零、total=0、只读形状', async () => {
  const { status, body } = await apiGet('/api/app/activity-summary');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.counts, {
    toolJobsRunning: 0,
    toolJobsPending: 0,
    approvalsPending: 0,
    primaryTasks: 0,
    subagentTasks: 0,
    backgroundProcesses: 0,
  });
  assert.equal(body.total, 0);
  assert.ok(typeof body.fetchedAt === 'string');
});

test('五类活动全部计入：running/pending tool_jobs、主/子任务、后台进程、pending 审批', async () => {
  insertToolJob('tj-running', 'running');
  insertToolJob('tj-pending', 'pending');
  insertToolJob('tj-completed', 'completed');
  insertTask('task-block223-primary', 'running', { kind: 'primary', conversationId: 'conv-1' });
  insertTask('task-block223-child', 'running', { kind: 'subagent', parentTaskId: 'task-block223-primary' });
  insertTask('task-block223-done', 'completed', { kind: 'primary' });
  internals.backgroundProcesses.set('bp-running', { id: 'bp-running', status: 'running', startedAt: Date.now() });
  internals.backgroundProcesses.set('bp-exited', { id: 'bp-exited', status: 'exited', startedAt: Date.now() });

  approvalStore.createApprovalRequests(TASK_ID);
  const registered = approvalStore.registerApprovalRequest(approvalStore.getApprovalRequests(TASK_ID), {
    toolName: 'workspace_exec',
    args: { command: 'rm -rf build' },
    guardKey: 'exec-destructive',
    dimension: 'destructive',
  });
  assert.equal(registered.ok, true);

  const { status, body } = await apiGet('/api/app/activity-summary');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.counts.toolJobsRunning, 1, 'completed 不得计入运行中');
  assert.equal(body.counts.toolJobsPending, 1);
  assert.equal(body.counts.approvalsPending, 1);
  assert.equal(body.counts.primaryTasks, 1, 'completed 任务不得计入');
  assert.equal(body.counts.subagentTasks, 1);
  assert.equal(body.counts.backgroundProcesses, 1, '已退出进程不得计入');
  const expectedTotal = Object.values(body.counts).reduce((sum, n) => sum + n, 0);
  assert.equal(body.total, expectedTotal);
  assert.equal(body.total, 6);
});

test('审批决策后不再计入 pending（sweep 语义）', async () => {
  const store = approvalStore.getApprovalRequests(TASK_ID);
  const pending = [...store.requests.values()].find((request) => request.status === 'pending');
  assert.ok(pending, '前置：应有一条 pending 审批');
  const decided = approvalStore.decideApprovalRequest({
    taskId: TASK_ID,
    requestId: pending.requestId,
    decision: 'approve',
    mode: 'once',
  });
  assert.equal(decided.ok, true);

  const { body } = await apiGet('/api/app/activity-summary');
  assert.equal(body.counts.approvalsPending, 0);
});
