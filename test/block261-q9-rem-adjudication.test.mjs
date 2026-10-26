/**
 * BLOCK-261 Q9-REM 裁决 — 逐项停止的最小协议契约。
 *
 * 钉住三件事：①UI 调用的确实是后端既有的两个停止端点（不新建执行器/控制面）；
 * ②toolJob 取消面的三种回执（已取消 / 本就已结束 / 终止未确认 409）形状不变；
 * ③审批项带的 taskId 与任务取消端点是同一 id 空间（否则逐项停止会 404）。
 */

import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b261-q9-adjudication-'));
process.env.PETRI_LOCAL_DATA_DIR = tmpDir;
process.env.PETRI_DB_PATH = path.join(tmpDir, 'petri.db');

const Database = require('better-sqlite3');
const bootDb = new Database(process.env.PETRI_DB_PATH);
const migrationsDir = path.join(ROOT, 'src', 'migrations');
for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
  bootDb.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
}
bootDb.close();

const db = require(path.join(ROOT, 'core/petri-server/db.js')).getDatabase();
const agentTaskStore = require(path.join(ROOT, 'core/petri-server/agent-task-store.js'));
const approvalRequests = require(path.join(ROOT, 'core/petri-server/helpers/approval-request-store.js'));
const { createToolsPlatformRoutes } = require(path.join(ROOT, 'core/petri-server/routes/tools-platform.js'));
const registerAppActivity = require(path.join(ROOT, 'core/petri-server/routes/app-activity.js'));
const agentContextRoutes = require(path.join(ROOT, 'core/petri-server/routes/ai-agent/context.js'));

const killedJobs = [];

function seedToolJob(id, status) {
  db.prepare(`INSERT OR REPLACE INTO tool_jobs
    (id,user_id,tool_id,params_json,status,created_at,name,project_id,conversation_id)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, 'local-user', 'demo-tool', '{}', status, new Date().toISOString(), `作业 ${id}`, 'p1', 'c1');
}

// 只注入取消路由真正用到的依赖；其余路由处理器在本测试里不出场。
const registerToolsPlatform = createToolsPlatformRoutes({
  db,
  canAccessToolJob: (req, job) => Boolean(req.user && job.user_id === req.user.id),
  isCancellableJob: (job) => job.status === 'pending' || job.status === 'running',
  killLocalToolJob: (jobId) => {
    killedJobs.push(jobId);
    if (jobId === 'job_b261_orphan') {
      return {
        active: true,
        processStarted: true,
        termination: Promise.resolve({ terminated: false, reason: 'owner_unproven' }),
      };
    }
    return { active: true, processStarted: false };
  },
});

let server = null;
let base = '';

before(async () => {
  seedToolJob('job_b261_pending', 'pending');
  seedToolJob('job_b261_orphan', 'running');
  seedToolJob('job_b261_done', 'completed');
  db.prepare(`INSERT OR REPLACE INTO tasks (id,type,params,status,created_at,user_id)
    VALUES (?,?,?,?,?,?)`)
    .run('task_b261', 'agent_loop', JSON.stringify({ kind: 'primary', projectId: 'p1', conversationId: 'c1', messages: [] }), 'running', new Date().toISOString(), 'local-user');

  const store = approvalRequests.createApprovalRequests('task_b261');
  approvalRequests.registerApprovalRequest(store, {
    toolName: 'run_tool',
    args: { command: 'sleep 60' },
    guardKey: 'guard_b261',
    dimension: 'tool:run_tool',
    ctxSnapshot: { projectId: 'p1' },
  });

  const app = express();
  app.use((req, _res, next) => { req.user = { id: 'local-user' }; next(); });
  registerToolsPlatform(app);
  registerAppActivity(app);
  agentContextRoutes.register(app);
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* EPERM */ }
});

async function post(pathname) {
  const response = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  return { status: response.status, body: await response.json() };
}

test('BLOCK-261 K3 — 取消待执行作业：200 且落库 cancelled（UI「已取消。」的来源）', async () => {
  const result = await post('/api/tools/cancel/job_b261_pending');
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.status, 'cancelled');
  assert.equal(db.prepare('SELECT status FROM tool_jobs WHERE id=?').get('job_b261_pending').status, 'cancelled');
});

test('BLOCK-261 K3 — 终态作业幂等：不报错误，UI 显示「本就已结束」', async () => {
  const result = await post('/api/tools/cancel/job_b261_done');
  assert.equal(result.status, 200);
  assert.equal(result.body.message, 'already_finished');
});

test('BLOCK-261 K3 — 终止未确认：409 + 机器可读码，作业留在 running（UI 不得显示已停止）', async () => {
  const result = await post('/api/tools/cancel/job_b261_orphan');
  assert.equal(result.status, 409);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error, 'termination_unconfirmed');
  assert.ok(killedJobs.includes('job_b261_orphan'));
  assert.equal(db.prepare('SELECT status FROM tool_jobs WHERE id=?').get('job_b261_orphan').status, 'running');
});

test('BLOCK-261 K3 — 审批项带的 taskId 就是任务取消端点的 id 空间', async () => {
  const summary = await (await fetch(`${base}/api/app/activity-summary`)).json();
  const approval = summary.items.find((item) => item.kind === 'approval' && item.taskId === 'task_b261');
  assert.ok(approval, JSON.stringify(summary.items));
  const cancel = await post(`/api/ai/agent/task/${approval.taskId}/cancel`);
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.status, 'cancel_requested');
  assert.equal(agentTaskStore.getAgentTask('task_b261').agentStatus, 'cancel_requested');
});

test('BLOCK-261 K3 — 映射面只认后端既有两个端点，且不复制审批决策面', () => {
  const source = fs.readFileSync(path.join(ROOT, 'frontend/src/lib/activity-control.ts'), 'utf8');
  assert.deepEqual(source.match(/`\$\{prefix\}[^`]+`/g), [
    '`${prefix}/tools/cancel/${id}`',
    '`${prefix}/ai/agent/task/${taskId}/cancel`',
    '`${prefix}/ai/agent/task/${id}/cancel`',
  ]);
  assert.ok(!source.includes('guard-ack'), '退出摘要不得复制审批决策面');
  assert.ok(!source.includes('/api/'), '基址一律来自 getPlatformApiPrefix()，不写死第二套');
});

test('BLOCK-261 K3 — 活动摘要面不扩成第二控制面（只读，无新增写路由）', () => {
  const source = fs.readFileSync(path.join(ROOT, 'core/petri-server/routes/app-activity.js'), 'utf8');
  // BLOCK-264（C-35）追加 onboarding-status 只读端点（仍无写路由）
  assert.deepEqual(source.match(/app\.(get|post|put|delete)\('[^']+'/g), [`app.get('/api/app/activity-summary'`, `app.get('/api/app/onboarding-status'`]);
});
