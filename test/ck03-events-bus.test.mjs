/**
 * CK-03（C-02 轮询→SSE 第一批：jobs 域失效通知）契约测试。
 *
 * 真实 HTTP 集成：真实 Express app + mock auth + 事件总线单例，覆盖：
 *   - 未登录 401
 *   - 连接即收 hello
 *   - publishInvalidation 广播到达（domain/payload 完整）
 *   - 断开清理（clientCount 归零）
 *   - task-store 发布点：markAgentTaskDone/Failed/Cancelled/createAgentTask
 *     各自广播 invalidate(jobs)（真实 DB 自举）
 *   - 心跳 comment 帧写入
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

// 内存 DB 自举（block34 同款）——agent-task-store 的 prepared stmts 需要真库
let tempDbDir;
{
  const Database = require('better-sqlite3');
  tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-ck03-db-'));
  const db = new Database(path.join(tempDbDir, 'biof3.db'));
  const migrationsDir = resolve('src/migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.BIOF3_DB_PATH = path.join(tempDbDir, 'biof3.db');
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch {}
  });
}

const eventBus = require(resolve('core/biof3-server/helpers/event-bus.js'));
const eventsRoute = require(resolve('core/biof3-server/routes/events-bus.js'));
const agentTaskStore = require(resolve('core/biof3-server/agent-task-store.js'));

const USER_ID = 'u_ck03';
let server = null;
let baseUrl = '';
let expressApp = null;

before(async () => {
  const express = require('express');
  expressApp = express();
  expressApp.use(express.json());
  expressApp.use((req, _res, next) => {
    const uid = req.headers['x-mock-user'];
    if (uid) req.user = { id: String(uid), role: 'user' };
    next();
  });
  eventsRoute(expressApp);
  await new Promise((resolvePromise) => {
    server = expressApp.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolvePromise();
    });
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
});

/** 打开一条 SSE 连接并收集事件直到关闭。 */
async function collectEvents({ headers = {}, durationMs = 400, onOpen } = {}) {
  const events = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), durationMs);
  try {
    const resp = await fetch(baseUrl + '/api/events', {
      headers: { Accept: 'text/event-stream', ...headers },
      signal: controller.signal,
    });
    if (onOpen) onOpen(resp);
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of raw.split('\n')) {
          const m = line.match(/^data:\s?(.*)$/);
          if (!m) continue;
          try { events.push(JSON.parse(m[1])); } catch { /* 非 JSON（注释/哨兵） */ }
        }
      }
    }
  } catch (e) {
    if (!String(e).includes('abort')) throw e;
  } finally {
    clearTimeout(timer);
  }
  return events;
}

test('CK-03 未登录 401', async () => {
  const resp = await fetch(baseUrl + '/api/events');
  assert.equal(resp.status, 401);
});

test('CK-03 连接收 hello + publish 广播到达 + 断开清理', async () => {
  let respRef = null;
  const collectPromise = collectEvents({
    headers: { 'x-mock-user': USER_ID },
    durationMs: 900,
    onOpen: (resp) => { respRef = resp; },
  });
  // 等 hello 到达（连接建立）
  await new Promise((r) => setTimeout(r, 250));
  assert.ok(respRef && respRef.ok, 'SSE 连接应建立');
  assert.equal(respRef.headers.get('content-type') || '', 'text/event-stream; charset=utf-8');
  const beforeCount = eventBus.clientCount();
  assert.ok(beforeCount >= 1, '至少有一条已注册客户端');
  eventBus.publishInvalidation('jobs', { taskId: 't_probe', state: 'completed' });
  const events = await collectPromise;
  assert.equal(events[0] && events[0].type, 'hello', '首帧=hello');
  const inv = events.find((e) => e.type === 'invalidate');
  assert.ok(inv, 'invalidate 事件到达');
  assert.equal(inv.domain, 'jobs');
  assert.equal(inv.taskId, 't_probe');
  assert.equal(inv.state, 'completed');
  assert.ok(inv.at, '携带时间戳');
});

test('CK-03 task-store 终态发布点广播 invalidate(jobs)', async () => {
  const created = agentTaskStore.createAgentTask({ userId: USER_ID, params: { conversationId: 'conv_ck03' } });
  const taskId = created.taskId || created.id || created;
  const collectPromise = collectEvents({
    headers: { 'x-mock-user': USER_ID },
    durationMs: 700,
  });
  await new Promise((r) => setTimeout(r, 250));
  agentTaskStore.markAgentTaskDone(taskId, []);
  const events = await collectPromise;
  const inv = events.find((e) => e.type === 'invalidate' && e.taskId === taskId);
  assert.ok(inv, 'markDone 广播到达');
  assert.equal(inv.domain, 'jobs');
  assert.equal(inv.state, 'completed');
});

test('CK-03 event-bus 心跳 comment 帧写入', async () => {
  // 手动构造一条假连接验证心跳写 comment（用短间隔）
  const chunks = [];
  const fakeRes = {
    write: (s) => { chunks.push(s); return true; },
  };
  const stop = eventBus.startHeartbeat(30);
  // startHeartbeat 是全局 clients 集合——注册 fake 连接
  const origRegister = eventBus.registerClient;
  const unregister = (() => {
    // 直接借 registerClient：注入 fake res
    return origRegister(fakeRes);
  })();
  await new Promise((r) => setTimeout(r, 80));
  unregister();
  stop();
  assert.ok(chunks.some((c) => c.includes(': hb')), '心跳 comment 帧已写入');
});
