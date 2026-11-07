/**
 * nso-s1-stream-rejection.test.mjs — BLOCK-376（S1 / G-03）流中断穿透补全。
 *
 * S0 分片归因（蓝图 G-03）：errorsAsRejections 在 NSO-W1 已透传 deepseek 生产链，
 * 但 ①anthropic.js chatStream catch 恒 resolve-with-error（开关对其无效）；
 * ②llm-client.callDeepSeekStream 兼容入口不透传开关；③启用 fallback 绑定的组合
 * 从未被集成覆盖（既有 RST 固定 disableFallback:true）。
 *
 * 契约：
 *  - anthropic chatStream：errorsAsRejections=true → 流中网络错误以异常穿透；
 *    未开开关 → resolve-with-error（零回归）。
 *  - callDeepSeekStream：options.errorsAsRejections 透传网关（缺省 false）。
 *  - 网关 fallback 优先级（显式契约）：可重试错误 + 有绑定 → 先请求级降级（不断链），
 *    全部候选失败 → 终局 attempt 才把 rejection 抛给上层整轮重试；
 *    硬不可降级（401 鉴权）rejection → 不降级、立即抛（诚实暴露）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

{
  // loop 链模块加载期建连防护（与 nso-w1 同款自举临时库）
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const Database = require('better-sqlite3');
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-s1-g03-db-'));
  const db = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.resolve('src/migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => { try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* best-effort */ } });
}

const { AnthropicProvider } = require('../core/shared-backend/llm-providers/anthropic.js');
const { ModelGateway } = require('../core/shared-backend/llm-providers/model-gateway.js');
const { DeepSeekProvider } = require('../core/shared-backend/llm-providers/deepseek.js');

const sseFrame = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

function startResetServer() {
  // 零输出即 RST：网关契约=已产出内容的 attempt 不降级不重试（防重放重复正文，
  // emittedOutput 守卫）——降级路径的坏候选必须是「首 token 前失败」。
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    setTimeout(() => {
      if (typeof res.socket.resetAndDestroy === 'function') res.socket.resetAndDestroy();
      else res.socket.destroy();
    }, 20);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

function startOkServer(text = '降级成功输出') {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(sseFrame({ choices: [{ delta: { content: text } }] }));
    res.write(sseFrame({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
    res.write('data: [DONE]\n\n');
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

const ANTHROPIC_BODY = { model: 'claude-m', messages: [{ role: 'user', content: 'hi' }], stream: true };

test('S1-G03 anthropic chatStream：errorsAsRejections=true → 流中 RST 异常穿透', async () => {
  const server = await startResetServer();
  try {
    const provider = new AnthropicProvider({ name: 'anthropic' });
    await assert.rejects(
      provider.chatStream('sk-test', ANTHROPIC_BODY, {}, () => {}, {
        baseUrl: server.url,
        errorsAsRejections: true,
      }),
      (err) => Boolean(err && (err.code || err.message)),
      'errorsAsRejections 开启时网络错误必须 throw（不再 resolve-with-error）',
    );
  } finally {
    await server.close();
  }
});

test('S1-G03 anthropic chatStream：未开开关 → resolve-with-error（零回归）', async () => {
  const server = await startResetServer();
  try {
    const provider = new AnthropicProvider({ name: 'anthropic' });
    const result = await provider.chatStream('sk-test', ANTHROPIC_BODY, {}, () => {}, { baseUrl: server.url });
    assert.equal(result.error, 'network_error');
  } finally {
    await server.close();
  }
});

test('S1-G03 callDeepSeekStream 兼容入口透传 errorsAsRejections', async () => {
  const captured = [];
  const { modelGateway } = require('../core/petri-server/helpers/llm-client.js');
  const original = modelGateway.chat;
  modelGateway.chat = async (opts) => { captured.push(opts); return { ok: true }; };
  try {
    const { callDeepSeekStream } = require('../core/petri-server/helpers/llm-client.js');
    await callDeepSeekStream('sk-test', { model: 'm', messages: [] }, {}, () => {}, { errorsAsRejections: true });
    await callDeepSeekStream('sk-test', { model: 'm', messages: [] }, {}, () => {}, {});
    assert.equal(captured[0].errorsAsRejections, true, '显式开启必须透传');
    assert.equal(captured[1].errorsAsRejections, undefined, '缺省不注入（零行为变化）');
  } finally {
    modelGateway.chat = original;
  }
});

function makeFallbackGateway({ badUrl, goodUrl }) {
  const badProvider = new DeepSeekProvider({ name: 'deepseek' });
  const goodProvider = new DeepSeekProvider({ name: 'deepseek' });
  const providers = new Map([['deepseek', badProvider], ['deepseek-good', goodProvider]]);
  return new ModelGateway({
    getSettings: () => ({
      model_profiles: [
        { id: 'p1', provider: 'deepseek', model: 'm1', baseUrl: badUrl, capabilities: ['chat', 'streaming', 'tools'], roles: ['agent'] },
        { id: 'p2', provider: 'deepseek-good', model: 'm2', baseUrl: goodUrl, capabilities: ['chat', 'streaming', 'tools'], roles: ['agent'] },
      ],
      model_role_bindings: { agent: 'p1' },
      model_fallback_enabled: true,
      model_fallback_bindings: { agent: ['p2'] },
    }),
    getCredential: () => 'sk-test',
    getProvider: (name) => providers.get(name) || null,
  });
}

test('S1-G03 网关 fallback 优先级：可重试错误 + 有绑定 → 先降级不断链（rejection 不中途抛）', async () => {
  const bad = await startResetServer();
  const good = await startOkServer();
  try {
    const gateway = makeFallbackGateway({ badUrl: bad.url, goodUrl: good.url });
    const events = [];
    const result = await gateway.chat({
      role: 'agent',
      body: { model: 'm1', messages: [{ role: 'user', content: 'hi' }], stream: true },
      onEvent: (e) => events.push(e),
      errorsAsRejections: true,
    });
    assert.equal(result.error, undefined, '降级后必须成功返回，不抛');
    assert.match(String(result.choices?.[0]?.delta?.content || result.choices?.[0]?.message?.content || ''), /降级成功输出/);
    assert.ok(events.some((e) => e.type === 'model_fallback'), '必须发出 model_fallback 事件');
  } finally {
    await bad.close();
    await good.close();
  }
});

test('S1-G03 网关 fallback 优先级：全部候选失败 → 终局 rejection 抛给上层（整轮重试可接）', async () => {
  const bad1 = await startResetServer();
  const bad2 = await startResetServer();
  try {
    const gateway = makeFallbackGateway({ badUrl: bad1.url, goodUrl: bad2.url });
    await assert.rejects(
      gateway.chat({
        role: 'agent',
        body: { model: 'm1', messages: [{ role: 'user', content: 'hi' }], stream: true },
        onEvent: () => {},
        errorsAsRejections: true,
      }),
      (err) => Boolean(err && (err.code || err.message)),
      '全部候选耗尽必须抛（上层整轮重试的唯一触发通道）',
    );
  } finally {
    await bad1.close();
    await bad2.close();
  }
});

test('S1-G03 网关 fallback 优先级：硬不可降级（401）rejection → 不降级立即抛（诚实暴露）', async () => {
  const state = { hits: 0 };
  const server = http.createServer((req, res) => {
    state.hits += 1;
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Unauthorized' } }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const good = await startOkServer();
  try {
    const gateway = makeFallbackGateway({ badUrl: `http://127.0.0.1:${server.address().port}`, goodUrl: good.url });
    await assert.rejects(
      gateway.chat({
        role: 'agent',
        body: { model: 'm1', messages: [{ role: 'user', content: 'hi' }], stream: true },
        onEvent: () => {},
        errorsAsRejections: true,
      }),
      (err) => Boolean(err && (err.code || err.message)),
      '401 鉴权错误必须立即抛，不换模型掩盖',
    );
    assert.equal(state.hits, 1, 'fallback 绑定不得被消耗（未降级）');
  } finally {
    server.close();
    await good.close();
  }
});
