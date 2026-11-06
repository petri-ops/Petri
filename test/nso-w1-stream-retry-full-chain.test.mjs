/**
 * nso-w1-stream-retry-full-chain.test.mjs — BLOCK-365（NSO-W1 / F-01）流中断全链穿透。
 *
 * 缺口（评估 F-01，本测试实证）：loop-orchestrator 给 callChatProvider 传 errorsAsRejections:true，
 * 但 llm-client 构造网关参数时丢掉了它，ModelGateway 构造 provider options 时也不含它 →
 * deepseek provider 永远走 resolve-with-error，上层 callProviderWithNetworkRetry（只 catch throw）
 * 对流中 ECONNRESET 零重试。既有 block109 测试只直连 provider 覆盖，生产链路未被覆盖。
 *
 * 契约（真实本地 SSE 服务器 + 真实 DeepSeekProvider + 真实 ModelGateway，无 mock provider）：
 *  - 网关透传 errorsAsRejections → 流中 RST 以异常穿透（不再 resolve-with-error）
 *  - 未开开关的调用方行为零变化（仍 resolve-with-error）
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// loop-orchestrator 的 require 链会加载 db.js（模块加载即建连）——与 agent-workspace-exec-* 同款
// 自举迁移过的临时库，避免落到仓库内无 schema 的旧默认库（SQLITE_ERROR）。
{
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const Database = require('better-sqlite3');
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-w1-f01-db-'));
  const db = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.resolve('src/migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => { try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* best-effort */ } });
}

const { ModelGateway } = require('../core/shared-backend/llm-providers/model-gateway.js');
const { DeepSeekProvider } = require('../core/shared-backend/llm-providers/deepseek.js');

const sseFrame = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

function startResetServer() {
  const state = { hits: 0 };
  const server = http.createServer((req, res) => {
    state.hits += 1;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(sseFrame({ choices: [{ delta: { content: '部分输出' } }] }));
    setTimeout(() => {
      if (typeof res.socket.resetAndDestroy === 'function') res.socket.resetAndDestroy();
      else res.socket.destroy();
    }, 30);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      hits: () => state.hits,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

function makeGateway(baseUrl) {
  const provider = new DeepSeekProvider({ name: 'deepseek' });
  return new ModelGateway({
    getSettings: () => ({
      model_profiles: [{ id: 'p1', provider: 'deepseek', model: 'm', baseUrl, capabilities: ['chat', 'streaming', 'tools'] }],
      active_agent_model_id: 'p1',
    }),
    getCredential: () => 'sk-test',
    getProvider: () => provider,
  });
}

const BODY = { model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: true };

test('W1-F01 网关透传 errorsAsRejections：流中 RST 以异常穿透（生产链路，不再 resolve-with-error）', async () => {
  const server = await startResetServer();
  try {
    const gateway = makeGateway(server.url);
    await assert.rejects(
      gateway.chat({ role: 'agent', profileId: 'p1', body: BODY, onEvent: () => {}, errorsAsRejections: true, disableFallback: true }),
      (err) => /ECONNRESET|socket hang up|terminated|other side closed/i.test(String(err.message)),
    );
  } finally {
    await server.close();
  }
});

test('W1-F01 未开开关的调用方行为零变化：流中 RST 仍 resolve-with-error', async () => {
  const server = await startResetServer();
  try {
    const gateway = makeGateway(server.url);
    const result = await gateway.chat({ role: 'agent', profileId: 'p1', body: BODY, onEvent: () => {}, disableFallback: true });
    assert.ok(result && result.error, `应 resolve 出错误信封：${JSON.stringify(result).slice(0, 200)}`);
  } finally {
    await server.close();
  }
});

test('W1-F01 llm-client.callChatProvider 把 errorsAsRejections 交给网关（接线契约）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(process.cwd(), 'core', 'petri-server', 'helpers', 'llm-client.js'), 'utf8');
  const block = src.slice(src.indexOf('function callChatProvider'), src.indexOf('function callChatProvider') + 1400);
  assert.match(block, /errorsAsRejections:\s*!!\(options && options\.errorsAsRejections\)/, 'callChatProvider 必须透传 errorsAsRejections');
});

test('W1-F01 终局 attempt 流中断时不向前端发 error 事件（上层整轮重试会再来）', async () => {
  const server = await startResetServer();
  try {
    const gateway = makeGateway(server.url);
    const events = [];
    await assert.rejects(gateway.chat({ role: 'agent', profileId: 'p1', body: BODY, onEvent: (e) => events.push(e), errorsAsRejections: true, disableFallback: true }));
    assert.equal(events.filter((e) => e && e.type === 'error').length, 0, JSON.stringify(events));
    assert.ok(events.some((e) => e && e.type === 'content_delta'), '中断前的增量照常下发');
  } finally {
    await server.close();
  }
});

test('W1-F01 上层网络重试包装对穿透的流中断真正重试（第二轮成功）', async () => {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(sseFrame({ choices: [{ delta: { content: hits === 1 ? '断' : '好' } }] }));
    if (hits === 1) {
      setTimeout(() => (res.socket.resetAndDestroy ? res.socket.resetAndDestroy() : res.socket.destroy()), 30);
      return;
    }
    res.write(sseFrame({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
    res.write('data: [DONE]\n\n');
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const gateway = makeGateway(`http://127.0.0.1:${server.address().port}`);
    const { callProviderWithNetworkRetry: retry } = require('../core/petri-server/loop-orchestrator.js');
    assert.equal(typeof retry, 'function');
    const result = await retry(
      () => gateway.chat({ role: 'agent', profileId: 'p1', body: BODY, onEvent: () => {}, errorsAsRejections: true, disableFallback: true }),
      { retries: 2, baseDelayMs: 10 },
    );
    assert.equal(hits, 2, '第一轮 RST、第二轮成功');
    assert.ok(result && !result.error, JSON.stringify(result).slice(0, 200));
  } finally {
    await new Promise((r) => server.close(r));
  }
});
