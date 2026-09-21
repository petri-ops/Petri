/**
 * BLOCK-109-CORE-ARCH 增量（2026-09-21 用户裁决「按你的建议来」）— 流中断重试覆盖契约。
 *
 * 病灶：provider 流式 promise 从不 reject——fail() 以 {error, message} 形状 resolve，
 * 流中死亡（ECONNRESET 等）对重试包装永远表现为「成功返回」→ 网络重试零触发
 * （run 80669989 三败 + 实测 2/4 轮复现）。
 *
 * 修复：options.errorsAsRejections 时 fail() 以异常穿透（message/code 原样；aborted
 * 保持 resolve 语义）；loop-orchestrator 的模型调用开启开关 → 瞬断整轮重试，耗尽
 * 仍走既有 fatal 路径（P0 基线④已钉）。未开开关的调用方零变化。
 *
 * 测试矩阵（本地 http SSE 服务器）：
 *   ① errorsAsRejections：流中重置 → reject（code=req_error）
 *   ② 默认：流中重置 → resolve-with-error（legacy 形状保留）
 *   ③ 整轮重试集成：第 1 连接流中重置、第 2 连接完整成功 → 重试后拿到完整正文
 *   ④ 成功路径（开开关）零回归
 *   ⑤ aborted 保持 resolve（取消语义不变）
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

// 内存 DB 自举（loop-orchestrator 依赖链顶层 prepare projects，同 block109-p0-baseline 先例）
{
  const Database = require('better-sqlite3');
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'biof3-b109-stream-retry-'));
  const db = new Database(path.join(tempDbDir, 'biof3.db'));
  const migrationsDir = path.join(root, 'src', 'migrations');
  for (const file of fssync.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fssync.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.BIOF3_DB_PATH = path.join(tempDbDir, 'biof3.db');
  process.on('exit', () => {
    try { fssync.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟释放 */ }
  });
}

const { DeepSeekProvider } = require(path.join(root, 'core', 'shared-backend', 'llm-providers', 'deepseek.js'));
const { callProviderWithNetworkRetry } = require(path.join(root, 'core', 'biof3-server', 'loop-orchestrator.js'));

const sseFrame = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

/**
 * 本地 SSE 服务器。mode:
 *   'reset-then-die'  — 发 2 个 content delta 后硬断连接（模拟流中 read ECONNRESET）
 *   'ok'              — 发 2 个 content delta + finish_reason + [DONE] 正常收尾
 * 返回 { url, hitCount(), close() }。
 */
function startSseServer(mode) {
  const state = { hits: 0 };
  const server = http.createServer((req, res) => {
    state.hits += 1;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const shouldDie = mode === 'reset-then-die' && state.hits === 1;
    res.write(sseFrame({ choices: [{ delta: { content: '部分输出' } }] }));
    res.write(sseFrame({ choices: [{ delta: { content: '然后连接被掐断' } }] }));
    if (shouldDie) {
      // 强制 RST（resetAndDestroy）而非优雅 FIN——客户端须收到 ECONNRESET/socket 错误
      setTimeout(() => {
        if (typeof res.connection.resetAndDestroy === 'function') res.connection.resetAndDestroy();
        else res.connection.destroy();
      }, 30);
      return;
    }
    res.write(sseFrame({ choices: [{ delta: { content: '收尾' }, finish_reason: 'stop' }] }));
    res.write('data: [DONE]\n\n');
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        hits: () => state.hits,
        close: () => server.close(),
      });
    });
  });
}

const provider = new DeepSeekProvider({ name: 'deepseek-test' });
const BODY = { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] };

test('① errorsAsRejections — 流中重置以异常穿透（code=req_error）', async () => {
  const server = await startSseServer('reset-then-die');
  try {
    await assert.rejects(
      provider.chatStream('k', BODY, {}, () => {}, { baseUrl: server.url, errorsAsRejections: true }),
      (err) => /ECONNRESET|socket hang up|连接被/i.test(err.message) && err.code === 'req_error'
    );
  } finally {
    server.close();
  }
});

test('② 默认（未开开关）— 流中重置 resolve-with-error（legacy 形状零变化）', async () => {
  const server = await startSseServer('reset-then-die');
  try {
    const result = await provider.chatStream('k', BODY, {}, () => {}, { baseUrl: server.url });
    assert.equal(result.error, 'req_error');
    assert.match(result.message, /ECONNRESET|socket hang up/);
  } finally {
    server.close();
  }
});

test('③ 整轮重试集成 — 第 1 连接流中重置、第 2 连接成功 → 网络重试后拿到完整正文', async () => {
  const server = await startSseServer('reset-then-die');
  try {
    const events = [];
    const result = await callProviderWithNetworkRetry(
      () => provider.chatStream('k', BODY, {}, (e) => events.push(e), {
        baseUrl: server.url, errorsAsRejections: true,
      }),
      { retries: 2, baseDelayMs: 1 }
    );
    assert.equal(server.hits(), 2, '两次连接（1 失败 + 1 重试成功）');
    assert.equal(result.choices[0].message.content, '部分输出然后连接被掐断收尾');
    assert.ok(!result.error, '重试成功后无错误形状');
  } finally {
    server.close();
  }
});

test('④ 成功路径（开开关）零回归', async () => {
  const server = await startSseServer('ok');
  try {
    const result = await provider.chatStream('k', BODY, {}, () => {}, { baseUrl: server.url, errorsAsRejections: true });
    assert.equal(result.choices[0].message.content, '部分输出然后连接被掐断收尾');
    assert.equal(result.choices[0].finish_reason, 'stop');
  } finally {
    server.close();
  }
});

test('⑤ aborted 保持 resolve（取消语义不变）', async () => {
  const server = await startSseServer('ok');
  try {
    const controller = new AbortController();
    controller.abort();
    const result = await provider.chatStream('k', BODY, {}, () => {}, {
      baseUrl: server.url, errorsAsRejections: true, signal: controller.signal,
    });
    assert.equal(result.error, 'aborted');
  } finally {
    server.close();
  }
});
