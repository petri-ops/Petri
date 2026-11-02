#!/usr/bin/env node
/**
 * BLOCK-338 P0 — stream stall 复现与证据（根因链实证，不依赖真上游）。
 *
 * 证两件事，缺一不可：
 *   A. Node http 的 socket idle timeout 会被「任意字节」重置——上游只发 SSE 心跳
 *      （`: keep-alive` 注释帧）时永不触发（所以 `timeout: 90000` 对「有心跳无 token」无效）。
 *   B. 真 `deepseek` provider 在「发心跳不发 token」的上游面前：onEvent 零 content_delta、
 *      请求长时间不结束（无看门狗时的静默挂住形态）。
 *
 * 用法：node scripts/block338-stall-repro.mjs
 * 证据：acceptance/block-338/stall-repro.json
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-338');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const assertions = [];
function assert(name, pass, detail) {
  assertions.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 240)}`);
}

/** SSE 上游：mode = 'heartbeat'（只发注释帧）| 'token_then_silence'（发一个 token 后静默） */
function startSseServer(mode) {
  const server = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const heartbeat = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch { /* closed */ } }, 100);
    if (mode === 'token_then_silence') {
      setTimeout(() => {
        try {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\n`);
        } catch { /* closed */ }
      }, 120);
    }
    // 注意：IncomingMessage 'close' 在请求体读完后即触发（Node ≥16），不能当连接关闭用；
    // 只认 socket / 响应的 close，否则心跳会被立刻清掉、A 场景变成「无数据」的假阳性。
    req.socket.on('close', () => clearInterval(heartbeat));
    res.on('close', () => clearInterval(heartbeat));
  });
  const stop = () => {
    try { if (typeof server.closeAllConnections === 'function') server.closeAllConnections(); } catch { /* older node */ }
    try { server.close(); } catch { /* already closed */ }
  };
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, stop }));
  });
}

// ---------- A：socket idle 被心跳续命（裸 http，Node 语义） ----------
async function proveSocketIdleReset() {
  const { port, stop } = await startSseServer('heartbeat');
  try {
    const result = await new Promise((resolve) => {
      const startedAt = Date.now();
      const req = http.request({ host: '127.0.0.1', port, path: '/chat/completions', method: 'POST', timeout: 400 }, (res) => {
        // 只需要「有字节到达」这个事实（续命 socket），内容无关
        res.on('data', () => {});
      });
      req.on('timeout', () => { req.destroy(); resolve({ timedOut: true, atMs: Date.now() - startedAt }); });
      req.on('error', () => resolve({ timedOut: true, atMs: Date.now() - startedAt, error: true }));
      // 1.2s 后主动收尾：若 timeout 在 400ms 触发则「心跳未续命」
      setTimeout(() => { req.destroy(); resolve({ timedOut: false, atMs: Date.now() - startedAt }); }, 1200);
      req.end();
    });
    assert('A_socket_idle_reset_by_heartbeat', result.timedOut === false,
      `timeout=400ms 且上游每 100ms 发心跳 → ${result.timedOut ? '触发' : '未触发'}（${result.atMs}ms）；未触发即证明心跳续命 socket`);
    return result;
  } finally {
    stop();
  }
}

// ---------- B：真 provider 在心跳上游面前零 token、长挂 ----------
async function proveProviderHangs() {
  const { DeepSeekProvider } = require(path.join(ROOT, 'core', 'shared-backend', 'llm-providers', 'deepseek.js'));
  const { port, stop } = await startSseServer('heartbeat');
  const events = [];
  let settled = false;
  try {
    const provider = new DeepSeekProvider();
    const promise = provider
      .chatStream('sk-test', { model: 'test-model', messages: [{ role: 'user', content: 'hi' }], stream: true }, {}, (event) => events.push(event), { baseUrl: `http://127.0.0.1:${port}` })
      .then((value) => { settled = true; return value; })
      .catch((error) => { settled = true; return { error: 'thrown', message: error.message }; });

    await sleep(2500);
    const tokenDeltas = events.filter((event) => event && (event.type === 'content_delta' || event.type === 'tool_call_delta'));
    assert('B_provider_zero_token_on_heartbeat_upstream', tokenDeltas.length === 0,
      `2.5s 内 content/tool delta=${tokenDeltas.length}（心跳帧不产生 token 事件）`);
    assert('B_provider_still_pending_after_2_5s', settled === false,
      `provider promise settled=${settled}（无看门狗时静默挂住，只能等 socket idle/外层兜底）`);

    // 收尾：断开连接让请求自然失败，避免句柄泄漏
    stop();
    await sleep(300);
    const finalValue = await Promise.race([promise, sleep(800).then(() => ({ error: 'still_pending' }))]);
    return { settled, finalError: finalValue && (finalValue.error || null) };
  } finally {
    stop();
  }
}

const startedAt = new Date().toISOString();
const socketEvidence = await proveSocketIdleReset();
const providerEvidence = await proveProviderHangs();

fs.mkdirSync(EVIDENCE, { recursive: true });
const report = {
  name: 'stall-repro',
  block: 'BLOCK-338',
  phase: 'P0',
  platform: process.platform,
  startedAt,
  finishedAt: new Date().toISOString(),
  socketIdle: socketEvidence,
  provider: providerEvidence,
  assertions,
  allPass: assertions.every((item) => item.pass),
  passed: assertions.filter((item) => item.pass).length,
  total: assertions.length,
};
const file = path.join(EVIDENCE, 'stall-repro.json');
fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
console.log(`\n[block338-p0] ${report.passed}/${report.total} allPass=${report.allPass} → ${path.relative(ROOT, file)}`);
// 显式退出：SSE 场景可能留下 keep-alive 句柄，不能靠事件循环自然收尾
process.exit(report.allPass ? 0 : 1);
