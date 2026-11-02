#!/usr/bin/env node
/**
 * BLOCK-338 P3 — stall 看门狗实机腿（真 provider + 真 ModelGateway + 真 HTTP mock 上游）。
 *
 * 三场景，全部走真实 SSE 解析与看门狗判定：
 *   1. 正常流：心跳 + 递增 token 后 end → 看门狗**零误杀**（结果无 error）。
 *   2. 首 token 迟到：只发心跳不发 token → ~阈值判死 `stream_stalled{phase:'first_token'}`。
 *   3. 中途静默：先出一个 token 再只发心跳 → 判死 `stream_stalled{phase:'idle'}`，已出 token 保留。
 *
 * 覆盖边界（如实）：本腿不经 Express 进程，覆盖 provider + gateway + HTTP 三层的真接线；
 * `/api/ai/chat` 只加注释（120s 兜底降为最后防线），其路由行为由既有 UI-638 兜底测试覆盖。
 *
 * 用法：node scripts/block338-stall-live.mjs
 * 证据：acceptance/block-338/stall-live.json
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-338');
const THRESHOLD_MS = 1000;

process.env.PETRI_STREAM_STALL_FIRST_MS = String(THRESHOLD_MS);
process.env.PETRI_STREAM_STALL_IDLE_MS = String(THRESHOLD_MS);

const assertions = [];
function assert(name, pass, detail) {
  assertions.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 260)}`);
}

/** mode: 'normal' | 'heartbeat_only' | 'token_then_silence' */
function startUpstream(mode) {
  const server = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = (payload) => { try { res.write(payload); } catch { /* closed */ } };
    const heartbeat = setInterval(() => write(': keep-alive\n\n'), 100);
    const cleanup = () => clearInterval(heartbeat);
    res.on('close', cleanup);
    req.socket.on('close', cleanup);

    if (mode === 'token_then_silence') {
      setTimeout(() => write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`), 150);
    }
    if (mode === 'normal') {
      let count = 0;
      const tokens = setInterval(() => {
        count += 1;
        write(`data: ${JSON.stringify({ choices: [{ delta: { content: `t${count}` } }] })}\n\n`);
        if (count >= 4) {
          clearInterval(tokens);
          clearInterval(heartbeat);
          write('data: [DONE]\n\n');
          res.end();
        }
      }, 120);
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      stop: () => {
        try { if (typeof server.closeAllConnections === 'function') server.closeAllConnections(); } catch { /* older */ }
        try { server.close(); } catch { /* closed */ }
      },
    }));
  });
}

function makeGateway(baseUrl) {
  const { ModelGateway } = require(path.join(ROOT, 'core', 'shared-backend', 'llm-providers', 'model-gateway.js'));
  const { DeepSeekProvider } = require(path.join(ROOT, 'core', 'shared-backend', 'llm-providers', 'deepseek.js'));
  const profile = { id: 'p_live', provider: 'deepseek', protocol: 'openai', model: 'stall-live', baseUrl, capabilities: {} };
  return new ModelGateway({
    getSettings: () => ({ model_role_bindings: { chat: profile.id }, model_profiles: [profile] }),
    getCredential: () => 'sk-test',
    getProvider: (name) => (name === 'deepseek' ? new DeepSeekProvider() : null),
    recordRouting() {},
    recordTranscript() {},
  });
}

async function runScenario(mode) {
  const upstream = await startUpstream(mode);
  const gateway = makeGateway(`http://127.0.0.1:${upstream.port}`);
  const events = [];
  const startedAt = Date.now();
  try {
    const result = await gateway.chat({
      role: 'chat',
      body: { messages: [{ role: 'user', content: 'hi' }], stream: true },
      onEvent: (event) => events.push(event),
    });
    return { result, events, elapsedMs: Date.now() - startedAt };
  } finally {
    upstream.stop();
  }
}

const startedAt = new Date().toISOString();

// ---- 场景 1：正常流零误杀 ----
{
  const { result, events, elapsedMs } = await runScenario('normal');
  const deltas = events.filter((event) => event.type === 'content_delta');
  assert('L1_normal_no_false_positive', !result.error && deltas.length >= 4,
    `elapsed=${elapsedMs}ms error=${result.error || '-'} deltas=${deltas.length}`);
}

// ---- 场景 2：首 token 迟到 ----
{
  const { result, events, elapsedMs } = await runScenario('heartbeat_only');
  const deltas = events.filter((event) => event.type === 'content_delta');
  assert('L2_first_token_stall', result.error === 'stream_stalled' && result.phase === 'first_token',
    `elapsed=${elapsedMs}ms error=${result.error} phase=${result.phase} elapsedMs=${result.elapsedMs}`);
  assert('L2_no_phantom_tokens', deltas.length === 0, `deltas=${deltas.length}（不得伪造 token）`);
  assert('L2_far_before_outer_timeout', elapsedMs < 10_000,
    `elapsed=${elapsedMs}ms << 外层 120s 兜底（看门狗先触发）`);
}

// ---- 场景 3：中途静默 ----
{
  const { result, events, elapsedMs } = await runScenario('token_then_silence');
  const deltas = events.filter((event) => event.type === 'content_delta');
  assert('L3_idle_stall', result.error === 'stream_stalled' && result.phase === 'idle',
    `elapsed=${elapsedMs}ms error=${result.error} phase=${result.phase} elapsedMs=${result.elapsedMs}`);
  assert('L3_partial_output_kept', deltas.length === 1 && deltas[0].content === 'partial',
    `deltas=${JSON.stringify(deltas.map((d) => d.content))}`);
}

fs.mkdirSync(EVIDENCE, { recursive: true });
const report = {
  name: 'stall-live',
  block: 'BLOCK-338',
  phase: 'P3',
  platform: process.platform,
  thresholdMs: THRESHOLD_MS,
  coverage: 'provider + ModelGateway + HTTP（未经 Express 进程）',
  startedAt,
  finishedAt: new Date().toISOString(),
  assertions,
  allPass: assertions.every((item) => item.pass),
  passed: assertions.filter((item) => item.pass).length,
  total: assertions.length,
};
const file = path.join(EVIDENCE, 'stall-live.json');
fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
console.log(`\n[block338-p3] ${report.passed}/${report.total} allPass=${report.allPass} → ${path.relative(ROOT, file)}`);
process.exit(report.allPass ? 0 : 1);
