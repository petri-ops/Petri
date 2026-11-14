/**
 * BLOCK-449 · POST /api/ai/agent/task/:taskId/resume 路由冲突回归测试。
 *
 * 缺陷（实机腿 m7-longtask-resume-live run3 抓真）：team.js（BLOCK-249 Q4a 暂停/恢复
 * 控制面）与 resume.js（BLOCK-38 P1 中断续跑）对同一路径 POST …/resume 都注册了
 * 处理器，Express 先注册先赢 → team.js 的 not_paused 409 遮蔽了中断续跑语义，
 * 生产面对 interrupted 任务恒 409（run3 证据：error=not_paused）。
 *
 * 契约（按任务态互斥分流，两语义零前端改动共存）：
 *  - agentStatus='paused'（status=running）→ team 暂停恢复语义 {ok:true,agentStatus:'running'}
 *  - interrupted_at 非空 + status=failed       → BLOCK-38 中断续跑 {taskId, resumeOfTaskId}
 *  - status=running 非 paused                  → 409「任务仍在运行」
 *  - status=failed 非 interrupted              → 409「仅服务中断的任务可以续跑」
 *
 * 红证据：acceptance/block-449/evidence/t2-flow-run3.log（resume status=409 error=not_paused）。
 * 挂载顺序与 routes/ai-agent/index.js 一致（team 先、resume 后）——本测试同时是次序回归锚。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-route-disambig-'));
process.env.PETRI_LOCAL_DATA_DIR = tempDir;
process.env.PETRI_CREDENTIAL_BACKEND = 'file';

// 隔离库自举（与 scripts/lib/evals-harness.mjs bootstrapDb 同一方法：重放 src/migrations），
// 必须在 require db 单例之前完成（db.js 加载期即查询 projects 表）。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.join(tempDir, 'petri.db');
process.env.PETRI_DB_PATH = dbPath;
{
  const coreRequire = createRequire(path.join(ROOT, 'core', 'petri-server', 'package.json'));
  const Database = coreRequire('better-sqlite3');
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  const raw = new Database(dbPath);
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    raw.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  raw.close();
}

const express = require('express');
const { db } = require('../core/petri-server/db.js');
const agentTaskStore = require('../core/petri-server/agent-task-store.js');
const teamRoute = require('../core/petri-server/routes/ai-agent/team.js');
const resumeRoute = require('../core/petri-server/routes/ai-agent/resume.js');

test.after(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

let base = null;
const stubLoopCalls = [];
test.before(async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => { req.user = { id: 'u-resume-test' }; next(); });
  // 挂载顺序复刻 routes/ai-agent/index.js：team（line 45）先于 resume（line 58）
  teamRoute.register(app);
  // runAgentLoop 注入桩：路由契约测的是「哪个语义接到请求、响应与溯源形状」，
  // 不是 loop 本体（真循环会打无凭据远端并拖住测试进程）——桩记录入参即断言面。
  resumeRoute.register(app, {
    runAgentLoop: async (args) => {
      stubLoopCalls.push(args);
      return { status: 'completed', summary: 'stub' };
    },
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

function call(method, url, body) {
  return fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer desktop-local' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
}

function createTask(overrides = {}) {
  return agentTaskStore.createAgentTask({
    status: 'running',
    agentStatus: 'running',
    userId: 'u-resume-test',
    params: {
      messages: [{ role: 'user', content: 'route-disambig probe' }],
      conversationId: null,
      context: {},
      kind: 'primary',
    },
    ...overrides,
  }).taskId;
}

test('契约 A：paused 任务 → team 暂停恢复语义（BLOCK-249 零变化）', async () => {
  const taskId = createTask();
  const paused = agentTaskStore.setAgentTaskPaused(taskId, true);
  assert.equal(paused.ok, true, `前置 paused：${JSON.stringify(paused)}`);
  const r = await call('POST', `/api/ai/agent/task/${taskId}/resume`, {});
  assert.equal(r.status, 200, `status=${r.status} body=${JSON.stringify(r.json)}`);
  assert.equal(r.json && r.json.ok, true);
  assert.equal(r.json && r.json.agentStatus, 'running');
});

test('契约 B：interrupted 任务 → BLOCK-38 中断续跑语义复活（缺陷修复面）', async () => {
  const taskId = createTask();
  // 模拟服务重启清扫产物：failed + interrupted_at（resume 端点的唯一续跑依据）
  db.prepare(`UPDATE tasks SET status='failed', agent_status='failed', interrupted_at=? WHERE id=?`)
    .run(new Date().toISOString(), taskId);
  const r = await call('POST', `/api/ai/agent/task/${taskId}/resume`, { modelPresetId: 'nonexistent-preset' });
  assert.equal(r.status, 200, `status=${r.status} body=${JSON.stringify(r.json).slice(0, 200)}`);
  const newTaskId = r.json && r.json.taskId;
  assert.ok(newTaskId && newTaskId !== taskId, `新任务 id=${newTaskId}`);
  assert.equal(r.json && r.json.resumeOfTaskId, taskId, '响应携带 resumeOfTaskId 溯源');
  // 原 task 追加 task_resumed 溯源事件（审计链只追加）
  const events = agentTaskStore.getAgentTaskEventsSince(taskId, 0, 100);
  const resumed = events.find((e) => e.eventType === 'task_resumed');
  assert.ok(resumed, 'task_resumed 溯源事件在场');
  assert.equal(resumed.payload && resumed.payload.newTaskId, newTaskId);
  // loop 装配契约：注入桩收到续跑 messages = 原请求历史 + 系统恢复指令（非用户输入）
  const loopCall = stubLoopCalls.find((c) => c && c.taskId === newTaskId);
  assert.ok(loopCall, 'runAgentLoop 以 newTaskId 被调用');
  const lastMsg = loopCall.messages && loopCall.messages[loopCall.messages.length - 1];
  assert.equal(lastMsg && lastMsg.role, 'user');
  assert.match(String((lastMsg && lastMsg.content) || ''), /任务恢复（系统注入，非用户输入）/);
});

test('契约 C：非中断 failed 任务 → 409「仅服务中断的任务可以续跑」', async () => {
  const taskId = createTask();
  // createAgentTask 落库恒 running（产品语义）——直改 failed 但**不写** interrupted_at
  db.prepare(`UPDATE tasks SET status='failed', agent_status='failed', interrupted_at=NULL WHERE id=?`)
    .run(taskId);
  const r = await call('POST', `/api/ai/agent/task/${taskId}/resume`, {});
  assert.equal(r.status, 409, `status=${r.status}`);
  assert.match(String((r.json && r.json.error) || ''), /仅服务中断/);
});

test('契约 D：running 非 paused 任务 → 409「任务仍在运行」', async () => {
  const taskId = createTask();
  const r = await call('POST', `/api/ai/agent/task/${taskId}/resume`, {});
  assert.equal(r.status, 409, `status=${r.status}`);
  assert.match(String((r.json && r.json.error) || ''), /任务仍在运行/);
});
