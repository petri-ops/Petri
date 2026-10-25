/**
 * BLOCK-260 Q9 余项 — K3 退出摘要逐项 + 桌面外壳归一契约。
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b260-q9-items-'));
process.env.PETRI_LOCAL_DATA_DIR = tmpDir;
process.env.PETRI_DB_PATH = path.join(tmpDir, 'petri.db');

const Database = require('better-sqlite3');
const bootDb = new Database(process.env.PETRI_DB_PATH);
const migrationsDir = path.join(ROOT, 'src', 'migrations');
for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
  bootDb.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
}
bootDb.close();

// tool_jobs/tasks 的 DDL 在 core 侧 schema 初始化（非 src/migrations），先建全量。
const db = require(path.join(ROOT, 'core/petri-server/db.js')).getDatabase();
require(path.join(ROOT, 'core/petri-server/agent-task-store.js'));
const now = new Date().toISOString();
db.prepare(`INSERT OR REPLACE INTO tool_jobs
  (id,user_id,tool_id,params_json,status,created_at,name,project_id,conversation_id)
  VALUES (?,?,?,?,?,?,?,?,?)`)
  .run('job_live_1', 'local-user', 'demo-tool', '{}', 'running', now, '运行中的差异分析', 'p1', 'c1');
db.prepare(`INSERT OR REPLACE INTO tasks (id,type,params,status,created_at,user_id)
  VALUES (?,?,?,?,?,?)`)
  .run('task_live_1', 'agent', JSON.stringify({ kind: 'primary', projectId: 'p1', conversationId: 'c1', messages: [{ content: '跑一个长任务' }] }), 'running', now, 'local-user');

const registerAppActivity = require(path.join(ROOT, 'core/petri-server/routes/app-activity.js'));
const shellModel = require(path.join(ROOT, 'src/main/desktop-shell-model.js'));

let server = null;
let base = '';

before(async () => {
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 'local-user' }; next(); });
  registerAppActivity(app);
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* EPERM */ }
});

test('BLOCK-260 K3 — activity-summary 返回有界逐项定位信息（无参数正文）', async () => {
  const response = await fetch(`${base}/api/app/activity-summary`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.items));
  const job = body.items.find((item) => item.kind === 'toolJob' && item.id === 'job_live_1');
  assert.ok(job, JSON.stringify(body.items));
  assert.equal(job.projectId, 'p1');
  assert.equal(job.conversationId, 'c1');
  assert.match(job.label, /差异分析/);
  const task = body.items.find((item) => item.kind === 'task' && item.id === 'task_live_1');
  assert.ok(task, JSON.stringify(body.items));
  assert.equal(task.projectId, 'p1');
  assert.equal(task.conversationId, 'c1');
  assert.ok(!JSON.stringify(body.items).includes('params'), 'items 不得携带参数正文');
  assert.ok(body.items.length <= 20);
});

test('BLOCK-260 K3 — 外壳归一：未知 kind 丢弃、字段有界、最多 20 条', () => {
  const raw = {
    counts: { toolJobsRunning: 2 },
    items: [
      { kind: 'toolJob', id: 'j1', label: 'A', projectId: 'p1', conversationId: 'c1' },
      { kind: 'evil', id: 'x', label: 'drop' },
      { kind: 'task', id: 't1', label: 'B'.repeat(200), status: 'running' },
      ...Array.from({ length: 30 }, (_, i) => ({ kind: 'approval', id: `a${i}`, label: `ap${i}` })),
    ],
  };
  const normalized = shellModel.normalizeActivity(raw);
  assert.equal(normalized.total, 2);
  assert.equal(normalized.items.length, 20);
  assert.equal(normalized.items[0].kind, 'toolJob');
  assert.ok(normalized.items.every((item) => item.kind !== 'evil'));
  const long = shellModel.normalizeActivity({ counts: {}, items: [{ kind: 'task', id: 't2', label: 'B'.repeat(200) }] });
  assert.ok(long.items[0].label.length <= 80);
  assert.deepEqual(shellModel.normalizeActivity({ counts: {} }).items, []);
});
