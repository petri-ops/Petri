/**
 * BLOCK-34 P3 — 后台进程浮窗只读端点（routes/ai-agent/background-processes.js）。
 *
 * 真实 HTTP 集成：真实 Express app + mock auth + 真实 workspace-tools 默认
 * 工具实例（与路由同源），覆盖：
 *   - 未登录 401 / 缺 conversationId 400
 *   - 会话列表：A 会话可见自己启动的进程，B 会话不可见（sessionKey 隔离）
 *   - 单进程日志尾部：A 会话 200 且含输出；B 会话 404（跨会话越权）
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const resolve = (...segments) => path.resolve(__dirname, '..', ...segments);
const require = createRequire(import.meta.url);

// 内存 DB 自举（同 agent-workspace-exec-background.test.mjs）
let tempDbDir;
{
  const Database = require('better-sqlite3');
  tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block34-p3-db-'));
  const db = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = resolve('src/migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try {
      fs.rmSync(tempDbDir, { recursive: true, force: true });
    } catch {}
  });
}

const isWindows = process.platform === 'win32';
const testMaybe = isWindows ? test.skip : test;

const USER_ID = 'u_p3';
let PROJECT_ID = '';
const CONV_A = 'conv_a';
const CONV_B = 'conv_b';

let server;
let baseUrl;
let spawnedProcessId = null;
let workspaceRoot;

function apiGet(pathname, { userId } = {}) {
  return new Promise((resolvePromise, reject) => {
    const headers = {};
    if (userId) headers['x-mock-user'] = userId;
    const req = http.request(baseUrl + pathname, { method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
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

async function waitFor(predicate, timeoutMs = 8000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return predicate();
}

before(async () => {
  workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'petri-block34-p3-ws-'));

  // 项目行（路由链路最终落到 db 模块 → 指向 PETRI_DB_PATH）
  const dbModule = require(resolve('core/petri-server/db.js'));
  const db = dbModule.default || dbModule;
  const project = db.createProject({
    name: 'P3 Route',
    modality: 'bulk-rna',
    userId: USER_ID,
    workspacePath: workspaceRoot,
  });
  db.setProjectUserId(project.id, USER_ID);
  PROJECT_ID = project.id;

  // 真实 Express + mock auth + 被测路由
  const express = require('express');
  const route = require(resolve('core/petri-server/routes/ai-agent/background-processes.js'));
  const app = express();
  app.use((req, _res, next) => {
    const uid = req.headers['x-mock-user'];
    if (uid) req.user = { id: String(uid), role: 'user' };
    next();
  });
  route.register(app);

  await new Promise((resolvePromise) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolvePromise();
    });
  });

  // 通过同一 defaultTools 实例启动真实后台进程（conv A）
  const ws = require(resolve('core/petri-server/agent-tools/workspace-tools.js'));
  const start = await ws.tool_workspace_exec_background(
    { command: 'echo hello-bg-p3 && sleep 30' },
    { projectId: PROJECT_ID, userId: USER_ID, accessMode: 'full', conversationId: CONV_A }
  );
  assert.equal(start.ok, true, `background start failed: ${JSON.stringify(start)}`);
  spawnedProcessId = start.processId;
});

after(async () => {
  if (spawnedProcessId) {
    try {
      const ws = require(resolve('core/petri-server/agent-tools/workspace-tools.js'));
      await ws.tool_process_stop(
        { processId: spawnedProcessId },
        { projectId: PROJECT_ID, userId: USER_ID, accessMode: 'full', conversationId: CONV_A }
      );
    } catch {}
  }
  try { if (server) await new Promise((r) => server.close(r)); } catch {}
  try { fs.rmSync(workspaceRoot, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch {}
});

test('未登录请求被拒绝 401', async () => {
  const res = await apiGet(`/api/ai/agent/background-processes?conversationId=${CONV_A}`);
  assert.equal(res.status, 401);
});

test('缺 conversationId 返回 400', async () => {
  const res = await apiGet('/api/ai/agent/background-processes', { userId: USER_ID });
  assert.equal(res.status, 400);
});

testMaybe('A 会话列出自己的后台进程（含日志尾部）', async () => {
  const ok = await waitFor(async () => {
    const res = await apiGet(
      `/api/ai/agent/background-processes?conversationId=${CONV_A}&projectId=${PROJECT_ID}`,
      { userId: USER_ID }
    );
    return res.status === 200
      && res.body.count === 1
      && typeof res.body.processes[0].logTail === 'string'
      && res.body.processes[0].logTail.includes('hello-bg-p3');
  });
  assert.ok(ok, 'expected conv A process with log tail containing marker');
  const res = await apiGet(
    `/api/ai/agent/background-processes?conversationId=${CONV_A}&projectId=${PROJECT_ID}`,
    { userId: USER_ID }
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 1);
  const proc = res.body.processes[0];
  assert.equal(proc.processId, spawnedProcessId);
  assert.equal(proc.status, 'running');
  assert.ok(proc.logTail.includes('hello-bg-p3'));
  assert.ok(proc.command.includes('hello-bg-p3'));
});

testMaybe('B 会话看不到 A 会话的进程（sessionKey 隔离）', async () => {
  const res = await apiGet(
    `/api/ai/agent/background-processes?conversationId=${CONV_B}&projectId=${PROJECT_ID}`,
    { userId: USER_ID }
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 0);
  assert.deepEqual(res.body.processes, []);
});

testMaybe('单进程日志端点：A 会话 200，B 会话 404', async () => {
  const okRes = await apiGet(
    `/api/ai/agent/background-processes/${spawnedProcessId}/log?conversationId=${CONV_A}&projectId=${PROJECT_ID}`,
    { userId: USER_ID }
  );
  assert.equal(okRes.status, 200);
  assert.equal(okRes.body.process.processId, spawnedProcessId);
  assert.ok(okRes.body.process.logTail.includes('hello-bg-p3'));

  const deniedRes = await apiGet(
    `/api/ai/agent/background-processes/${spawnedProcessId}/log?conversationId=${CONV_B}&projectId=${PROJECT_ID}`,
    { userId: USER_ID }
  );
  assert.equal(deniedRes.status, 404);
});
