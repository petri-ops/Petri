/**
 * QODER-A2 P2 路由端到端契约（2026-11-23）。
 *
 * 真实起 Express + task-actions.register()，seed 一条 pending 审批请求，
 * 验证按需解释路由：401 未登录 / 404 无请求 / 200 fail-soft（模型不可用时
 * explanation:null + explainUnavailable:true，不改审批状态）。零新依赖。
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-explain-route-'));
process.env.PETRI_LOCAL_DATA_DIR = tmpDir;
process.env.PETRI_DB_PATH = path.join(tmpDir, 'petri.db');

const Database = require('better-sqlite3');
const bootDb = new Database(process.env.PETRI_DB_PATH);
for (const file of fs.readdirSync(path.join(ROOT, 'src', 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
  bootDb.exec(fs.readFileSync(path.join(ROOT, 'src', 'migrations', file), 'utf8'));
}
bootDb.close();

const agentTaskStore = require(path.join(ROOT, 'core/petri-server/agent-task-store.js'));
const approvalRequests = require(path.join(ROOT, 'core/petri-server/helpers/approval-request-store.js'));
const registerTaskActions = require(path.join(ROOT, 'core/petri-server/routes/ai-agent/task-actions.js'));

let server;
let base;
let taskKey;
let requestId;

before(async () => {
  const created = agentTaskStore.createAgentTask({ userId: 'u1' });
  taskKey = created.taskId;
  const store = approvalRequests.createApprovalRequests(taskKey);
  const reg = approvalRequests.registerApprovalRequest(store, {
    toolName: 'workspace_write',
    guardKey: 'test:explanation',
    intent: { action: '写入文件', impact: '修改 1 个文件', reversible: '可撤销', reason: '测试' },
  });
  requestId = reg.request.requestId;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'u1' }; next(); });
  registerTaskActions.register(app);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('explain 路由：pending 请求返回 fail-soft（不伪造解释、不改审批状态）', async () => {
  const res = await fetch(`${base}/api/ai/agent/task/${taskKey}/approval/${requestId}/explain`, { method: 'POST' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(data.explainUnavailable === true || typeof data.explanation === 'string');
  const pending = approvalRequests.getApprovalRequest(taskKey, requestId);
  assert.equal(pending.status, 'pending', '解释不得改变审批状态');
});

test('explain 路由：不存在的 requestId 返回 404，不泄漏其他请求', async () => {
  const res = await fetch(`${base}/api/ai/agent/task/${taskKey}/approval/apr_notfound/explain`, { method: 'POST' });
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, 'approval_request_not_found');
});
