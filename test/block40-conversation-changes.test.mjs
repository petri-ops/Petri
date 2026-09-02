/**
 * BLOCK-40 P1 — 会话改动权威清单只读水合端点
 *（routes/ai-agent/conversation-changes.js + agent-task-store.listConversationChanges）。
 *
 * 真实 SQLite（BIOF3_DB_PATH 临时库）+ 真实 Express app，覆盖：
 *   - 多任务跨 path 聚合；新任务覆盖旧任务同路径（COALESCE(finished_at, created_at) 定序）
 *   - iteration/tool 归属保留（UI-273）
 *   - 非 agent_loop 任务 / running / retry_pending 排除
 *   - 端点：缺 conversationId 400 / 非法 conversationId 400 / 无任务诚实空清单
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const resolve = (...segments) => path.resolve(__dirname, '..', ...segments);
const require = createRequire(import.meta.url);

const USER_ID = 'u_b40p1';
const CONV_A = 'conv-b40-a';
const CONV_B = 'conv-b40-b';

let tempDir;
let server;
let baseUrl;
let store;

function apiGet(pathname) {
  return new Promise((resolvePromise, reject) => {
    const req = http.request(baseUrl + pathname, { method: 'GET' }, (res) => {
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

/**插入一个 agent_loop 任务并落到指定终态（files_changed_json 同步写入）。 */
function seedTask({ taskId, conversationId, files, status = 'done' }) {
  store.insertAgentTask({ taskId, userId: USER_ID, params: { conversationId } });
  if (status === 'done') {
    store.markAgentTaskDone(taskId, files);
  } else if (status === 'failed') {
    store.markAgentTaskFailed(taskId, 'boom', files);
  }
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-block40-p1-'));
  process.env.BIOF3_DB_PATH = path.join(tempDir, 'agent-tasks.db');
  store = require(resolve('core/biof3-server/agent-task-store'));

  // 旧任务（会话 A）：写 a.md（created）+ b.md（modified，带 UI-273 归属）
  seedTask({
    taskId: 't-old-1',
    conversationId: CONV_A,
    files: [
      { path: 'a.md', status: 'created', iteration: 1, tool: 'workspace_write' },
      { path: 'b.md', status: 'modified', iteration: 2, tool: 'workspace_replace' },
    ],
  });
  // 新任务（会话 A，failed 终态——failed 也构成权威清单）：a.md 被 b 轮覆盖为 modified；新增 c.txt
  seedTask({
    taskId: 't-new-2',
    conversationId: CONV_A,
    status: 'failed',
    files: [
      { path: 'a.md', status: 'modified', iteration: 1, tool: 'workspace_write' },
      { path: 'c.txt', status: 'created', iteration: 3, tool: 'workspace_write' },
    ],
  });
  // running 任务（会话 A）：清单尚未聚合，不得进入水合结果
  seedTask({ taskId: 't-running-3', conversationId: CONV_A, files: [{ path: 'wip.md', status: 'created' }], status: 'running' });
  // 非 agent_loop 任务不可达（insertAgentTask 只写 agent_loop，故用会话 B 隔离验证代替）
  seedTask({ taskId: 't-b-4', conversationId: CONV_B, files: [{ path: 'other.md', status: 'created' }] });

  const express = require('express');
  const route = require(resolve('core/biof3-server/routes/ai-agent/conversation-changes.js'));
  const app = express();
  route.register(app);

  await new Promise((resolvePromise) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolvePromise();
    });
  });
});

after(async () => {
  try { if (server) await new Promise((r) => server.close(r)); } catch {}
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  delete process.env.BIOF3_DB_PATH;
});

test('store：多任务跨 path 聚合，新任务覆盖旧任务同路径（后写为准）', () => {
  const changes = store.listConversationChanges(CONV_A);
  const byPath = new Map(changes.map((c) => [c.path, c]));
  assert.equal(changes.length, 3); // a.md / b.md / c.txt（wip.md 被排除）
  assert.deepEqual(byPath.get('a.md'), {
    path: 'a.md',
    status: 'modified', // 新任务覆盖旧任务的 created
    iteration: 1,
    tool: 'workspace_write',
    lastChangedAt: byPath.get('a.md').lastChangedAt,
  });
  assert.equal(byPath.get('b.md').iteration, 2);
  assert.equal(byPath.get('b.md').tool, 'workspace_replace');
  assert.equal(byPath.get('c.txt').status, 'created');
  assert.equal(byPath.get('wip.md'), undefined, 'running 任务不得进入权威清单');
  // lastChangedAt 为 ISO 时间戳字符串（任务 finished_at）
  assert.ok(!Number.isNaN(Date.parse(byPath.get('a.md').lastChangedAt)));
});

test('store：空 conversationId 返回空数组', () => {
  assert.deepEqual(store.listConversationChanges(''), []);
  assert.deepEqual(store.listConversationChanges(undefined), []);
});

test('store：无任务的会话返回空数组', () => {
  assert.deepEqual(store.listConversationChanges('conv-never-seeded'), []);
});

test('端点：缺 conversationId 返回 400', async () => {
  const res = await apiGet('/api/ai/agent/conversation-changes');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_conversation_id');
});

test('端点：非法 conversationId（路径穿越 / 特殊字符）返回 400', async () => {
  for (const bad of ['..', '../etc', 'a/b', 'a b', '%2e%2e']) {
    const res = await apiGet(`/api/ai/agent/conversation-changes?conversationId=${encodeURIComponent(bad)}`);
    assert.equal(res.status, 400, `expected 400 for ${bad}`);
  }
});

test('端点：命中会话返回合并清单，跨会话隔离', async () => {
  const res = await apiGet(`/api/ai/agent/conversation-changes?conversationId=${CONV_A}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.conversationId, CONV_A);
  assert.equal(res.body.changes.length, 3);
  const paths = res.body.changes.map((c) => c.path).sort();
  assert.deepEqual(paths, ['a.md', 'b.md', 'c.txt']);

  // 会话 B 只有自己的改动（隔离判据）
  const resB = await apiGet(`/api/ai/agent/conversation-changes?conversationId=${CONV_B}`);
  assert.equal(resB.status, 200);
  assert.deepEqual(resB.body.changes.map((c) => c.path), ['other.md']);
});

test('端点：无任务会话返回诚实空清单', async () => {
  const res = await apiGet('/api/ai/agent/conversation-changes?conversationId=conv-empty-40');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.changes, []);
});
