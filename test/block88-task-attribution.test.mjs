/**
 * BLOCK-88 P2 — 任务归属隔离契约测试（D3）。
 *
 * 覆盖：
 * 1. createFederatedDelegationConversation：委托会话落 origin 标记 + 「来自 X」标题
 * 2. 反向污染防护：宿主 getOrCreateActiveConversation 复用路径恒排除委托会话
 *    （85 验收缺口「委托未开独立会话」的两个方向：委托不进宿主活跃会话，
 *    宿主本地消息也不落进委托会话）
 * 3. 会话列表默认视图隔离：GET /api/ai/conversations 默认排除委托会话，
 *    ?includeFederated=1 显式可见（origin 字段出投影）
 * 4. 俯瞰面板归属：GET /api/ai/agent/tasks 映射 federatedFrom（「来自工程师 X」）
 *
 * 运行：node --test test/block88-task-attribution.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block88-p2-'));
process.env.PETRI_DB_PATH = path.join(tempDir, 'block88-p2.db');

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..');

// db.js 加载期即 prepare projects 语句——先跑 schema 迁移再加载业务模块
const { runMigrations } = require(path.join(ROOT, 'src/migration-runner.js'));
await runMigrations(path.join(tempDir, 'block88-p2.db'), path.join(ROOT, 'src', 'migrations'));

const conversations = require(path.join(ROOT, 'core/petri-server/helpers/conversations.js'));
const agentTaskStore = require(path.join(ROOT, 'core/petri-server/agent-task-store.js'));

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}
async function body(response) {
  return response.json();
}
async function getJson(url) {
  return body(await fetch(url));
}

test('BLOCK-88 P2: delegation conversation carries origin marker and 来自X title', () => {
  const conv = conversations.createFederatedDelegationConversation(
    'local-user',
    { displayName: '工程师 A', device: 'macOS' },
    '帮我跑一个 deseq2 分析'
  );
  assert.equal(conv.origin, 'federation-delegation');
  assert.equal(conv.user_id, 'local-user');
  // displayName 原文进标题（含空格照排）——诚实展示声明署名
  assert.ok(conv.title.startsWith('来自工程师 A的委托'), `title: ${conv.title}`);
  assert.ok(conv.title.includes('deseq2'), `title carries task excerpt: ${conv.title}`);

  // 无署名身份兜底
  const conv2 = conversations.createFederatedDelegationConversation('local-user', null, null);
  assert.equal(conv2.origin, 'federation-delegation');
  assert.ok(conv2.title.startsWith('来自协作工程师的委托'), `fallback title: ${conv2.title}`);
});

test('BLOCK-88 P2: host active-conversation reuse never lands in delegation conversation', () => {
  // 委托会话已存在（上一条用例落了两条，updated_at 最新）；宿主本地新消息
  // 经 getOrCreateActiveConversation 复用时必须绕开它们（反向污染防护）。
  const host = conversations.getOrCreateActiveConversation('local-user', { titleHint: '宿主本地对话' });
  assert.notEqual(host.origin, 'federation-delegation', 'host reuse must not land in a delegation conversation');

  // 带显式 conversationId 的复用同样排除委托会话
  const fedConv = conversations.createFederatedDelegationConversation('local-user', { displayName: '工程师 A' }, null);
  const hinted = conversations.getOrCreateActiveConversation('local-user', { conversationId: fedConv.id });
  assert.notEqual(hinted.id, fedConv.id, 'hinted reuse must not resolve to a delegation conversation');
});

test('BLOCK-88 P2: conversation list default view excludes delegation; includeFederated shows', async () => {
  const express = require('express');
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 'local-user' }; next(); });
  require(path.join(ROOT, 'core/petri-server/routes/ai-conversations.js'))(app);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // 正常会话（非委托）
    await body(await fetch(`${base}/api/ai/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '宿主本地对话' }),
    }));

    const def = await getJson(`${base}/api/ai/conversations?status=all`);
    assert.equal(def.status, 'ok');
    const fedInDefault = (def.conversations || []).filter((c) => c.origin === 'federation-delegation');
    assert.equal(fedInDefault.length, 0, 'default view must exclude delegation conversations');

    const incl = await getJson(`${base}/api/ai/conversations?status=all&includeFederated=1`);
    const fed = (incl.conversations || []).filter((c) => c.origin === 'federation-delegation');
    assert.ok(fed.length >= 3, `includeFederated=1 must reveal delegation conversations, got ${fed.length}`);
    for (const c of fed) assert.ok(c.title.startsWith('来自'), `fed title carries 来自X: ${c.title}`);
  } finally {
    await closeServer(server);
  }
});

test('BLOCK-88 P2: agent tasks list maps federatedFrom for delegation tasks', async () => {
  const userId = 'local-user';
  // 俯瞰列表只收 kind=subagent（UI-405 下推过滤）——委托主任务的「来自 X」
  // 可见面=独立会话标题；此处验证委托派生 subagent（继承 federated）与本地派生。
  agentTaskStore.insertAgentTask({
    taskId: 'fed-task-1',
    userId,
    params: {
      kind: 'subagent',
      parentTaskId: 'fed-parent',
      conversationId: 'conv-fed',
      federated: { displayName: '工程师 A', device: 'macOS', sessionId: 'mdev_x' },
      messages: [{ role: 'user', content: '帮我跑一个 deseq2 分析' }],
    },
  });
  agentTaskStore.insertAgentTask({
    taskId: 'local-task-1',
    userId,
    params: { kind: 'subagent', parentTaskId: 'local-parent', conversationId: 'conv-local', messages: [{ role: 'user', content: '本地工作' }] },
  });

  const express = require('express');
  const app = express();
  app.use((req, _res, next) => { req.user = { id: userId }; next(); });
  require(path.join(ROOT, 'core/petri-server/routes/ai-agent/task-actions.js')).register(app);
  const server = await listen(app);
  try {
    const data = await getJson(`http://127.0.0.1:${server.address().port}/api/ai/agent/tasks?limit=50`);
    assert.equal(data.ok, true);
    const fed = (data.tasks || []).find((t) => t.taskId === 'fed-task-1');
    const local = (data.tasks || []).find((t) => t.taskId === 'local-task-1');
    assert.ok(fed, 'fed task listed');
    assert.equal(fed.federatedFrom, '工程师 A', 'federatedFrom mapped for badge');
    assert.ok(local, 'local task listed');
    assert.equal(local.federatedFrom ?? null, null, 'local task carries no federatedFrom');
  } finally {
    await closeServer(server);
  }
});

test.after(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (e) {
    if (process.platform !== 'win32') throw e;
  }
});
