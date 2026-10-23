#!/usr/bin/env node
/**
 * BLOCK-243 / UI-551 — 审批卡 v2 实机腿一键封装（隔离栈 + mock provider，零真实 key）。
 *
 * 与 UI-523 的差异：不触碰用户 dev 栈/数据；起一套完全隔离的 :3001 后端 +
 * :3000 Vite + :9223 Electron 测试实例（临时数据根/DB/userData），跑
 * dev-verify flow `ui551-approval-live`，收尾全部回收。
 *
 * 链路：真实 stdio MCP 夹具 many_destructive（destructiveHint）→ trust ask 审批卡
 * → 编辑参数 → 批准（scope=once）→ 模型重试原调用按生效参数执行 → 审计可查。
 *
 * 前置：端口 3000/3001/9223 空闲（有人占着就 fail-fast，绝不杀未知进程）。
 * 证据：acceptance/ui-551/（亮/暗截图 + 断言 JSON）+ acceptance/block-243/。
 */
import { spawn, execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_PORT = 3001;
const VITE_PORT = 3000;
const CDP_PORT = 9223;
const MOCK_PORT = Number(process.env.UI551_MOCK_PORT || 39051);
const MCP_FIXTURE = path.join(ROOT, 'test', 'fixtures', 'mcp-many-tools-server.cjs');
const FLOW_PATH = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'flows', 'ui551-approval-live.cjs');
const EVIDENCE_UI = path.join(ROOT, 'acceptance', 'ui-551');
const EVIDENCE_BLOCK = path.join(ROOT, 'acceptance', 'block-243');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(800, () => { socket.destroy(); resolve(false); });
  });
}

async function waitFor(fn, { timeoutMs, intervalMs = 500, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try { last = await fn(); } catch { last = null; }
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}: ${String(last).slice(0, 200)}`);
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
  } catch { /* already gone */ }
}

// ---------- mock OpenAI SSE provider（/release /stats） ----------
const FINAL_TEXT = '审批链路收口：编辑后的参数已按批准执行。';
let providerCalls = 0;
let releaseResolve = null;
let releaseSignal = new Promise((resolve) => { releaseResolve = resolve; });
const mockRequests = [];

function emitToolCall(res, id) {
  res.write(`data: ${JSON.stringify({
    choices: [{
      delta: {
        tool_calls: [{
          index: 0,
          id,
          type: 'function',
          function: { name: 'mcp_many_many_destructive', arguments: JSON.stringify({ target: 'db' }) },
        }],
      },
    }],
  })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
}

function startMockServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/release') {
      releaseResolve();
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === 'GET' && req.url === '/stats') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ calls: providerCalls, requests: mockRequests }));
      return;
    }
    if (req.method === 'POST' && req.url && req.url.includes('/chat/completions')) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        providerCalls += 1;
        let parsed = {};
        try { parsed = JSON.parse(body); } catch { /* ignore */ }
        const lastUser = [...(parsed.messages || [])].reverse().find((m) => m && m.role === 'user');
        mockRequests.push({ n: providerCalls, lastUser: String((lastUser && lastUser.content) || '').slice(0, 60) });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        if (providerCalls === 2) {
          await Promise.race([releaseSignal, new Promise((resolve) => setTimeout(resolve, 30_000))]);
        }
        if (providerCalls === 1 || providerCalls === 2) {
          emitToolCall(res, `call_ui551_${providerCalls}`);
        } else {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: FINAL_TEXT } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  return server;
}

async function waitHttp(url, timeoutMs, label) {
  return waitFor(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok ? true : null;
  }, { timeoutMs, label });
}

async function main() {
  const startedAt = new Date().toISOString();
  for (const [port, name] of [[BACKEND_PORT, 'backend'], [VITE_PORT, 'vite'], [CDP_PORT, 'cdp']]) {
    if (await portOpen(port)) throw new Error(`${name} 端口 :${port} 已被占用；请先停止现有 dev/测试实例（本脚本不杀未知进程）`);
  }
  if (await portOpen(MOCK_PORT)) throw new Error(`mock 端口 :${MOCK_PORT} 已被占用`);

  fs.mkdirSync(EVIDENCE_UI, { recursive: true });
  fs.mkdirSync(EVIDENCE_BLOCK, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-ui551-live-'));
  const dataDir = path.join(tempRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(tempRoot, 'petri.db');
  const userDataDir = path.join(tempRoot, 'electron-user-data');
  fs.mkdirSync(userDataDir, { recursive: true });

  const mockServer = startMockServer();
  await new Promise((resolve) => mockServer.listen(MOCK_PORT, '127.0.0.1', resolve));

  fs.writeFileSync(path.join(dataDir, 'ai-settings.json'), JSON.stringify({
    active_chat_model_id: 'ui551-mock',
    chat_model_presets: [{
      id: 'ui551-mock',
      label: 'UI-551 Mock',
      provider: 'openai-compatible',
      model: 'mock-1',
      baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
      contextWindow: 24000,
    }],
  }, null, 2));

  const bootDb = new Database(dbPath);
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    bootDb.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  bootDb.close();

  let backend = null;
  let vite = null;
  let electron = null;
  let flowResult = null;
  const assertions = [];
  const assert = (name, pass, detail = '') => {
    const ok = Boolean(pass);
    assertions.push({ name, pass: ok, detail: String(detail).slice(0, 600) });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 220)}`);
  };

  try {
    backend = spawn(process.execPath, [path.join(ROOT, 'core', 'petri-server', 'server.js')], {
      env: {
        ...process.env,
        PETRI_DB_PATH: dbPath,
        PETRI_LOCAL_DATA_DIR: dataDir,
        R_SERVER_PORT: String(BACKEND_PORT),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: ROOT,
    });
    backend.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [backend]', text.slice(0, 200));
    });
    backend.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [backend:ERR]', text.slice(0, 200));
    });
    await waitHttp(`http://127.0.0.1:${BACKEND_PORT}/api/health`, 30_000, 'backend health');

    const rest = async (method, endpoint, body) => {
      const response = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api${endpoint}`, {
        method,
        headers: { 'content-type': 'application/json', Authorization: 'Bearer desktop-local' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, data: await response.json().catch(() => null) };
    };
    const created = await rest('POST', '/mcp/servers', {
      id: 'many',
      transport: 'stdio',
      command: process.execPath,
      args: [MCP_FIXTURE],
      autoConnect: false,
    });
    const connected = await rest('POST', '/mcp/servers/many/connect');
    assert('E1_mcp_connected', created.status === 200 && connected.data?.toolCount === 6,
      JSON.stringify(connected.data || {}).slice(0, 200));

    let vite = null;
    vite = spawn(process.execPath, [
      path.join(ROOT, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'),
      '--port', String(VITE_PORT), '--strictPort',
    ], {
      cwd: path.join(ROOT, 'frontend'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    vite.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [vite:ERR]', text.slice(0, 200));
    });
    await waitHttp(`http://127.0.0.1:${VITE_PORT}/`, 60_000, 'vite');

    const electronEnv = {
      ...process.env,
      PETRI_TEST_INSTANCE: '1',
      PETRI_ELECTRON_USER_DATA_DIR: userDataDir,
      PETRI_DB_PATH: dbPath,
      PETRI_LOCAL_DATA_DIR: dataDir,
      R_SERVER_PORT: String(BACKEND_PORT),
      PETRI_ELECTRON_LOG_PATH: path.join(tempRoot, 'electron.log'),
    };
    delete electronEnv.ELECTRON_RUN_AS_NODE;
    electron = spawn(process.execPath, [
      path.join(ROOT, 'node_modules', 'electron', 'cli.js'),
      '.', '--dev', `--remote-debugging-port=${CDP_PORT}`,
    ], {
      cwd: ROOT,
      env: electronEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    electron.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [electron:ERR]', text.slice(0, 200));
    });
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(2000) });
      const targets = await response.json();
      const pages = Array.isArray(targets) ? targets.filter((target) => target.type === 'page' && String(target.url).includes('test=1')) : [];
      return pages.length > 0 ? true : null;
    }, { timeoutMs: 90_000, intervalMs: 1000, label: 'electron test target' });
    assert('E2_isolated_stack', true, `backend :${BACKEND_PORT} / vite :${VITE_PORT} / cdp :${CDP_PORT} / data=${tempRoot}`);

    const flow = require(FLOW_PATH);
    process.env.PETRI_B243_MOCK_RELEASE_URL = `http://127.0.0.1:${MOCK_PORT}/release`;
    process.env.PETRI_B243_MOCK_STATS_URL = `http://127.0.0.1:${MOCK_PORT}/stats`;
    await flow.run({ assert });
    const stats = await fetch(`http://127.0.0.1:${MOCK_PORT}/stats`).then((response) => response.json()).catch(() => null);
    assert('E3_mock_provider_used', Boolean(stats && stats.calls >= 2), JSON.stringify(stats || null).slice(0, 240));
    flowResult = { assertions, allPass: assertions.every((item) => item.pass), stats };
  } catch (error) {
    assertions.push({ name: 'FATAL', pass: false, detail: error && error.stack ? error.stack : String(error) });
    flowResult = { assertions, allPass: false };
    console.error(error);
    process.exitCode = 1;
  } finally {
    killTree(electron && electron.pid);
    killTree(backend && backend.pid);
    killTree(vite && vite.pid);
    try { mockServer.close(); } catch { /* ignore */ }
    await sleep(600);
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }
    const report = {
      name: 'ui551-approval-live',
      darkMode: process.env.PETRI_B243_DARK === '1',
      startedAt,
      finishedAt: new Date().toISOString(),
      providerCalls,
      assertions,
      allPass: Boolean(flowResult && flowResult.allPass),
    };
    const jsonName = report.darkMode ? 'ui551-approval-live-dark.json' : 'ui551-approval-live.json';
    fs.writeFileSync(path.join(EVIDENCE_UI, jsonName), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(EVIDENCE_BLOCK, jsonName), JSON.stringify(report, null, 2));
    console.log(`\n${report.allPass ? 'ALL PASS' : 'FAILED'} ${assertions.filter((item) => item.pass).length}/${assertions.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
