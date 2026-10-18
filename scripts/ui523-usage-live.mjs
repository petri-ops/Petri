#!/usr/bin/env node
/**
 * UI-523 — 运行计量条后端实机腿（本地 mock provider + 隔离后端，零外网/零真实 key）。
 *
 * 证明链（缺一条就是假绿）：
 *  ① loop 每次模型调用结束真的发出 `usage` 事件（含 conversationId / cache 字段 / 耗时）；
 *  ② 事件与 ai_usage 落库同源：GET /api/ai/usage-conversation 的累计值对得上；
 *  ③ 路由口径：未知会话返回全 0（不 404）、缺 conversationId 返回 400。
 *
 * 为什么用 mock provider：本机无 Provider 凭据时，真实调用腿按 G0 纪律如实 defer；
 * 本脚本用本地 OpenAI 兼容 mock 证明代码链，证据明确标注 provider=mock，
 * 不得表述为「真实 Provider 已验」。
 *
 * 隔离：临时目录 + 独立端口 + PETRI_CREDENTIAL_BACKEND=file（不读写 keychain、
 * 不碰 .petri-dev-user-data），退出即清理。
 *
 * 用法：node scripts/ui523-usage-live.mjs [--evidence acceptance/ui-523/backend-live.json] [--keep]
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer as createNetServer } from 'node:net';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = join(ROOT, 'core', 'petri-server');
const Database = require(join(SERVER_DIR, 'node_modules', 'better-sqlite3'));

const args = process.argv.slice(2);
const evidencePath = args.includes('--evidence')
  ? resolve(ROOT, args[args.indexOf('--evidence') + 1])
  : resolve(ROOT, 'acceptance', 'ui-523', 'backend-live.json');
const keepTemp = args.includes('--keep');

const legs = [];
let failed = false;
function leg(name, ok, detail) {
  legs.push({ name, ok, detail });
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createNetServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolvePort(port));
    });
  });
}

// ── 隔离 data root + 迁移（后端依赖 src/migrations 建 projects 等基础表）──
const tempRoot = mkdtempSync(join(tmpdir(), 'ui523-live-'));
const dataDir = join(tempRoot, 'data');
mkdirSync(dataDir, { recursive: true });
const dbPath = join(dataDir, 'petri.db');
{
  const db = new Database(dbPath);
  const migDir = join(ROOT, 'src', 'migrations');
  for (const file of readdirSync(migDir).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(migDir, file), 'utf8'));
  }
  db.close();
}

// ── mock provider（本地回环；usage 带 cache 命中，验证 cache 字段真的进了聚合）──
const MOCK_USAGE = { prompt_tokens: 1200, completion_tokens: 80, prompt_cache_hit_tokens: 1000 };
const mock = createServer((req, res) => {
  const url = String(req.url || '');
  if (req.method === 'GET' && /\/models$/.test(url)) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'deepseek-chat', object: 'model' }] }));
    return;
  }
  if (req.method === 'POST' && /\/chat\/completions$/.test(url)) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (!/"stream"\s*:\s*true/.test(body)) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'mock-1',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
          usage: MOCK_USAGE,
        }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const sse = (payload) => res.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`);
      sse({ id: 'mock-1', choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] });
      setTimeout(() => {
        sse({ id: 'mock-1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: MOCK_USAGE });
        sse('[DONE]');
        res.end();
      }, 120);
    });
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});
const mockPort = await freePort();
await new Promise((r) => mock.listen(mockPort, '127.0.0.1', r));

// ── 设置：mock preset（baseUrl 指向本地 mock）+ file 凭据（不碰 keychain）──
const preset = {
  id: 'mock-deepseek',
  label: 'Mock DeepSeek',
  provider: 'deepseek',
  model: 'deepseek-chat',
  baseUrl: `http://127.0.0.1:${mockPort}/v1`,
};
writeFileSync(join(dataDir, 'ai-settings.json'), JSON.stringify({
  chat_model_presets: [preset],
  active_chat_model_id: preset.id,
  llm_provider: 'deepseek',
  model_profiles: [{
    schemaVersion: 1,
    id: preset.id,
    label: preset.label,
    provider: 'deepseek',
    protocol: 'openai-compatible',
    model: preset.model,
    defaultModel: preset.model,
    baseUrl: preset.baseUrl,
    credentialRef: 'provider:deepseek',
    capabilities: ['chat', 'streaming', 'tools'],
    roles: [],
    parameters: {},
  }],
  model_role_bindings: {},
  model_fallback_enabled: false,
  generation: {},
  reasoning: {},
}, null, 2));
writeFileSync(join(dataDir, 'ai-credentials.json'), JSON.stringify({ deepseek: 'mock-key' }, null, 2), { mode: 0o600 });

// ── 隔离后端 ──
const port = await freePort();
const backendLog = [];
const backend = spawn(process.execPath, ['server.js'], {
  cwd: SERVER_DIR,
  env: {
    ...process.env,
    R_SERVER_PORT: String(port),
    PETRI_DB_PATH: dbPath,
    PETRI_LOCAL_DATA_DIR: dataDir,
    PETRI_CREDENTIAL_BACKEND: 'file',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
backend.stdout.on('data', (chunk) => backendLog.push(String(chunk)));
backend.stderr.on('data', (chunk) => backendLog.push(String(chunk)));

const API = `http://127.0.0.1:${port}/api`;
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(maxMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    try {
      const resp = await fetch(`${API}/ai/health`);
      if (resp.ok) return true;
    } catch { /* 未起 */ }
    await sleep(300);
  }
  return false;
}


try {
  const healthy = await waitHealthy();
  leg('B0 隔离后端就绪', healthy, healthy ? `:${port}` : backendLog.join('').slice(-400));
  if (!healthy) throw new Error('backend not healthy');

  // ① 建会话 + 提交一次真实 agent 任务（mock 模型）
  const convResp = await fetch(`${API}/ai/conversations`, {
    method: 'POST', headers: AUTH, body: JSON.stringify({ title: 'UI-523 live check' }),
  });
  const convJson = await convResp.json();
  const conversationId = convJson && convJson.conversation && convJson.conversation.id;
  leg('B1 会话创建', Boolean(conversationId), conversationId || JSON.stringify(convJson).slice(0, 200));
  if (!conversationId) throw new Error('no conversation');

  const taskResp = await fetch(`${API}/ai/agent`, {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({
      messages: [{ role: 'user', content: '请只回复 OK' }],
      conversationId,
      modelPresetId: preset.id,
      context: { accessMode: 'read' },
    }),
  });
  const taskJson = await taskResp.json();
  const taskId = taskJson && taskJson.taskId;
  leg('B2 agent 任务派发', Boolean(taskId), taskId ? `task=${taskId}` : JSON.stringify(taskJson).slice(0, 300));
  if (!taskId) throw new Error('no task');

  // ② 订阅 SSE（从头重放），收集 usage 事件
  const usageEvents = [];
  const seen = new Set();
  let done = false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const resp = await fetch(`${API}/ai/agent/task/${taskId}?afterSeq=0`, {
      headers: { Authorization: 'Bearer desktop-local', accept: 'text/event-stream' },
      signal: controller.signal,
    });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
        if (!data) continue;
        if (data === '[DONE]') { done = true; break; }
        let evt;
        try { evt = JSON.parse(data); } catch { continue; }
        // SSE 回放/增量帧外层是 {seq, eventType, payload}；终态 done/error 是裸 {event}
        const core = evt && evt.payload && typeof evt.payload === 'object' ? evt.payload : evt;
        if (core && core.event === 'usage' && !seen.has(core.at)) {
          seen.add(core.at);
          usageEvents.push(core);
        }
        if (evt && (evt.event === 'done' || evt.event === 'agent_cancelled')) done = true;
      }
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }

  const usage = usageEvents[0];
  leg('B3 usage 事件到达', Boolean(usage), usage ? `iteration=${usage.iteration}` : 'no usage event');
  leg('B4 usage 归属本会话', Boolean(usage && usage.conversationId === conversationId),
    usage ? String(usage.conversationId) : 'n/a');
  leg('B5 usage token 与 mock 一致', Boolean(usage && usage.promptTokens === MOCK_USAGE.prompt_tokens
    && usage.completionTokens === MOCK_USAGE.completion_tokens),
  usage ? `${usage.promptTokens}/${usage.completionTokens}` : 'n/a');
  leg('B6 cache 字段未断链', Boolean(usage && usage.cacheReadTokens === MOCK_USAGE.prompt_cache_hit_tokens),
    usage ? `cacheRead=${usage.cacheReadTokens}` : 'n/a');
  leg('B7 耗时实测（tok/s 可算）', Boolean(usage && usage.durationMs > 0), usage ? `${usage.durationMs}ms` : 'n/a');

  // ③ 会话聚合路由
  const usageResp = await fetch(`${API}/ai/usage-conversation?conversationId=${encodeURIComponent(conversationId)}`, { headers: AUTH });
  const usageJson = await usageResp.json();
  leg('B8 聚合路由 200 + calls>=1', usageResp.status === 200 && Number(usageJson.calls) >= 1,
    `status=${usageResp.status} calls=${usageJson.calls}`);
  leg('B9 聚合 token 覆盖本次调用', Number(usageJson.inputTokens) >= MOCK_USAGE.prompt_tokens
    && Number(usageJson.outputTokens) >= MOCK_USAGE.completion_tokens,
  `in=${usageJson.inputTokens} out=${usageJson.outputTokens}`);
  const expectedHit = usageJson.inputTokens > 0 ? usageJson.cacheReadTokens / usageJson.inputTokens : 0;
  leg('B10 缓存命中率口径自洽', Math.abs(Number(usageJson.cacheHitRate) - expectedHit) < 1e-9,
    `hit=${usageJson.cacheHitRate}`);
  leg('B11 tokensPerSecond 可算', typeof usageJson.tokensPerSecond === 'number' && usageJson.tokensPerSecond > 0,
    String(usageJson.tokensPerSecond));

  const unknownResp = await fetch(`${API}/ai/usage-conversation?conversationId=conv_does_not_exist`, { headers: AUTH });
  const unknownJson = await unknownResp.json();
  leg('B12 未知会话返回全 0（不 404）', unknownResp.status === 200 && Number(unknownJson.calls) === 0
    && unknownJson.tokensPerSecond === null, `status=${unknownResp.status} calls=${unknownJson.calls}`);

  const missingResp = await fetch(`${API}/ai/usage-conversation`, { headers: AUTH });
  leg('B13 缺 conversationId 返回 400', missingResp.status === 400, `status=${missingResp.status}`);
} catch (e) {
  leg('B0 执行异常', false, e && e.message ? e.message : String(e));
} finally {
  try { backend.kill('SIGTERM'); } catch {}
  await new Promise((r) => mock.close(r));
  if (!keepTemp) {
    try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  }
}

const evidence = {
  gate: 'UI-523 composer run-stats backend live',
  provider: 'mock-openai-compatible (local loopback; 非真实 Provider — G0 开发期如实标注)',
  at: new Date().toISOString(),
  allPass: !failed,
  legs,
};
if (evidencePath) {
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`evidence → ${evidencePath}`);
}
console.log(failed ? 'RESULT: FAIL' : `RESULT: PASS (${legs.length}/${legs.length})`);
process.exit(failed ? 1 : 0);
